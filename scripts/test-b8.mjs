#!/usr/bin/env node
/**
 * تست سرتاسری B8 — چت و پیام‌ها (REST + WebSocket)
 * نیاز: سرور :4000 (dev) — socket.io-client از node_modules بک‌اند
 */
import { io } from 'socket.io-client';

const BASE = 'http://localhost:4000/api/v1';
const WS_URL = 'http://localhost:4000';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function adminLogin(username = process.env.ADMIN_USER || '09196421264', password = process.env.ADMIN_PASS || 'admin434343') {
  const r = await post('admin/auth/login', { username, password });
  if (!r.json?.data?.token) throw new Error('admin login failed: ' + JSON.stringify(r.json).slice(0, 200));
  return r.json.data.token;
}

async function login(phone) {
  const s = await post('auth/sendOtp', { phone });
  const v = await post('auth/verifyOtp', { phone, code: s.json?.data?.devCode });
  const token = v.json?.data?.accessToken;
  const p = await post('users/getProfile', {}, token);
  return { token, userId: p.json?.data?.user?.id ?? null };
}

(async () => {
  console.log('── B8: چت و پیام‌ها ──');

  const BUYER = '0916' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const SELLER = '0917' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const STRANGER = '0918' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const ADMIN = '09350001122';

  const buyer = await login(BUYER);
  const seller = await login(SELLER);
  const stranger = await login(STRANGER);
  const admin = await login(ADMIN);
  check('ورود چهار کاربر', !!buyer.token && !!seller.token && !!stranger.token && !!admin.token);

  // آگهی فروشنده + تأیید ادمین
  const cp = await post('products/createProduct', {
    subCategoryId: 44,
    productName: 'پسته چت تست',
    provinceId: 21,
    cityId: 230,
    stock: 300,
    minSaleAmount: 20,
    minSalePrice: 400000,
    description: 'تست چت B8 — توضیحات بلندتر از سی نویسه.',
  }, seller.token);
  const productId = cp.json?.data?.id;
  await post('admin/products/reviewProduct', { id: productId, approve: true }, await adminLogin());
  check('آگهی تأیید شد', !!productId);

  // ── ۱) شروع مکالمه ──
  let r = await post('chat/startThread', { productId }, buyer.token);
  check('startThread', !!r.json?.data?.id, JSON.stringify(r.json).slice(0, 200));
  const threadId = r.json?.data?.id;
  check('myRole=buyer + counterpart فروشنده', r.json?.data?.myRole === 'buyer' && !!r.json?.data?.counterpart?.id);

  // خود-چت مسدود
  r = await post('chat/startThread', { productId }, seller.token);
  check('چت با خودش مسدود', r.json?.code === 'SELF_CHAT', JSON.stringify(r.json).slice(0, 120));

  // تکرار → همان مکالمه
  r = await post('chat/startThread', { productId }, buyer.token);
  check('idempotent — همان threadId', r.json?.data?.id === threadId);

  // ── ۲) WS فروشنده وصل می‌شود ──
  const sellerSocket = io(WS_URL, { auth: { token: seller.token }, transports: ['websocket', 'polling'] });
  const buyerSocket = io(WS_URL, { auth: { token: buyer.token }, transports: ['websocket', 'polling'] });
  await new Promise((res) => sellerSocket.on('connect', res));
  await new Promise((res) => buyerSocket.on('connect', res));
  check('هر دو سوکت وصل شدند', sellerSocket.connected && buyerSocket.connected);

  // رویداد incoming را گوش می‌دهیم
  const sellerGot = new Promise((res) => sellerSocket.on('chat:newMessage', (p) => res(p)));
  const buyerGot = new Promise((res) => buyerSocket.on('chat:newMessage', (p) => res(p)));
  const buyerRead = new Promise((res) => buyerSocket.on('chat:read', (p) => res(p)));

  // توکن نامعتبر → قطع
  const badSocket = io(WS_URL, { auth: { token: 'junk' } });
  const badDisconnected = await new Promise((res) => {
    badSocket.on('connect', () => res(false));
    badSocket.on('connect_error', () => res(true));
    setTimeout(() => res(badSocket.connected === false), 3000);
  });
  check('توکن نامعتبر سوکت را می‌بُرد', badDisconnected === true || badSocket.connected === false);

  // ── ۳) پیام خریدار → فروشنده WS می‌گیرد ──
  r = await post('chat/sendMessage', { threadId, text: 'سلام، قیمت هر کیلو چند می‌شود؟' }, buyer.token);
  check('sendMessage خریدار', !!r.json?.data?.id && r.json?.data?.senderId === buyer.userId);
  const pushed = await Promise.race([sellerGot, new Promise((res) => setTimeout(() => res(null), 5000))]);
  check('WS push به فروشنده رسید', !!pushed && pushed?.message?.text?.includes('قیمت'), JSON.stringify(pushed ?? '').slice(0, 150));

  // پیام دوم (هنوز خوانده‌نشده)
  await post('chat/sendMessage', { threadId, text: 'ارسال به تهران دارید؟' }, buyer.token);

  // ── ۴) لیست مکالمات فروشنده ──
  r = await post('chat/getConversations', {}, seller.token);
  const conv = (r.json?.data ?? [])[0];
  check('گفتوگوی فروشنده با unread=2', conv?.unreadCount === 2, JSON.stringify(conv ?? {}).slice(0, 200));
  check('آخرین پیام در لیست', conv?.lastMessage?.text?.includes('تهران'));

  // ── ۵) فروشنده باز می‌کند → خواندن + رویداد به خریدار ──
  r = await post('chat/getThreadMessages', { threadId }, seller.token);
  const msgs = r.json?.data ?? [];
  check('پیام‌ها صعودی', msgs.length === 2 && msgs[0]?.text?.includes('سلام'));
  check('readAt زده شد', msgs.every((m) => m.readAt != null));
  const readEvent = await Promise.race([buyerRead, new Promise((res) => setTimeout(() => res(null), 4000))]);
  check('رویداد chat:read به خریدار', !!readEvent, JSON.stringify(readEvent ?? ''));

  // بعد از خواندن → unread صفر
  r = await post('chat/getConversations', {}, seller.token);
  check('unread فروشنده = 0', (r.json?.data ?? [])[0]?.unreadCount === 0);

  // ── ۶) پاسخ فروشنده → خریدار WS می‌گیرد ──
  r = await post('chat/sendMessage', { threadId, text: 'سلام؛ هر کیلو ۴۵۰ هزار تومان — ارسال تهران داریم.' }, seller.token);
  check('پاسخ فروشنده', !!r.json?.data?.id);
  const buyerPushed = await Promise.race([buyerGot, new Promise((res) => setTimeout(() => res(null), 5000))]);
  check('WS push به خریدار رسید', !!buyerPushed && buyerPushed?.message?.text?.includes('۴۵۰'), JSON.stringify(buyerPushed ?? '').slice(0, 150));

  // ── ۷) گاردها ──
  r = await post('chat/getThreadMessages', { threadId }, stranger.token);
  check('غریبه 403', r.status === 403);
  r = await post('chat/sendMessage', { threadId, text: 'سلام' }, stranger.token);
  check('ارسال غریبه 403', r.status === 403);
  r = await post('chat/getThreadMessages', { threadId: '626262626262626262626262' }, buyer.token);
  check('thread ناموجود 404', r.status === 404);
  r = await post('chat/sendMessage', { threadId, text: '' }, buyer.token);
  check('متن خالی رد', r.json?.status === false);
  let res2 = await fetch(`${BASE}/chat/getConversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('بدون توکن 401', res2.status === 401);

  // ── ۸) لیست خریدار هم مکالمه دارد ──
  r = await post('chat/getConversations', {}, buyer.token);
  const bconv = (r.json?.data ?? [])[0];
  check('گفتوگوی خریدار myRole=buyer', bconv?.myRole === 'buyer' && bconv?.counterpart?.id === seller.userId);
  check('آخرین پیام فروشنده در لیست خریدار', bconv?.lastMessage?.senderId === seller.userId);

  sellerSocket.close();
  buyerSocket.close();
  badSocket.close();

  // پاک‌سازی خود آزمایش — آگهی تست حذف نرم (شمارش‌های سوئیت R دست‌نخورده می‌ماند)
  await post('products/deleteMyProduct', { id: productId }, seller.token);

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
