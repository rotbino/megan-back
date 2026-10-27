#!/usr/bin/env node
/**
 * تست دستی فاز A6 پنل ادمین — چت‌های کاربران + گزارش تماس‌ها:
 *  ۱) ورود ادمین بوت‌استرپ + دو کاربر تست (خریدار/فروشنده) با آگهی تأییدشده
 *  ۲) گزارش تماس: reportCall ثبت + ضد-تکرار ۶۰ دقیقه + خودتماسی رد + getCallReport ادمین
 *  ۳) چت: خریدار پیام می‌فرستد → ادمین لیست را با unread badge و awaitingSellerReply می‌بیند
 *  ۴) نمای ادمین فقط-خواندنی: باز کردن مکالمه توسط ادمین readAt را عوض نمی‌کند
 *  ۵) فروشنده پیام می‌دهد و می‌خواند → آمار/وضعیت‌ها درست تازه می‌شوند
 *  ۶) فیلترهای لیست چت: unread / awaiting + جستجو
 *  ۷) getChatStats + آمار تماس در getStats داشبورد
 *  ۸) تست منفی: توکن کاربر عادی روی admin/calls + admin/chats → 401
 *
 * اجرا: node scripts/test-admin-a6.mjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const ADMIN_USER = process.env.ADMIN_USER || '09196421264';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin434343';

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

async function login(phone) {
  const s = await post('auth/sendOtp', { phone });
  const code = s.json?.data?.devCode;
  if (!code) throw new Error('devCode نیامد');
  const v = await post('auth/verifyOtp', { phone, code });
  const token = v.json?.data?.accessToken;
  const me = await post('users/getProfile', {}, token);
  const id = me.json?.data?.user?.id ?? me.json?.data?.id;
  return { token, id, phone };
}

async function adminLogin(username, password) {
  const r = await post('admin/auth/login', { username, password });
  return { status: r.status, token: r.json?.data?.token, admin: r.json?.data?.admin };
}

const rnd = String(Date.now()).slice(-7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('── A6: چت‌های کاربران (نمای ادمین) + گزارش تماس‌ها ──');

  // ── ۰) ورود ادمین + خریدار/فروشنده تست + آگهی تأییدشده ──────────────
  const boot = await adminLogin(ADMIN_USER, ADMIN_PASS);
  check('ورود ادمین بوت‌استرپ', !!boot.token);
  const token = boot.token;

  const buyer = await login('0915' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  const seller = await login('0912' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  check('ورود خریدار/فروشنده تست', !!buyer.token && !!seller.token);

  const prod = await post('products/createProduct', {
    subCategoryId: 44,
    productName: `پسته تست A6 ${rnd}`,
    provinceId: 21, cityId: 230,
    stock: 100, minSaleAmount: 10, minSalePrice: 500000,
    description: `تست A6 — چت و تماس ${rnd} — توضیحات بلندتر از سی نویسه برای ولیدیشن.`,
    features: [{ key: 'بسته بندی', value: 'کیلویی' }],
  }, seller.token);
  const productId = prod.json?.data?.id;
  check('ثبت آگهی', Boolean(productId));

  // آگهی را تأیید می‌کنیم تا مثل واقعی «تأییدشده» باشد
  await post('admin/products/setProductStatus', { id: productId, status: 'confirmed' }, token);

  // ── ۱) گزارش تماس ──────────────────────────────────────────────────────
  const c1 = await post('calls/reportCall', { calleeId: seller.id, productId, source: 'product' }, buyer.token);
  check('reportCall ثبت شد', c1.json?.status === true && c1.json?.data?.repeated === false);

  const c2 = await post('calls/reportCall', { calleeId: seller.id, productId }, buyer.token);
  check('reportCall ضد-تکرار (۶۰ دقیقه)', c2.json?.status === true && c2.json?.data?.repeated === true && c2.json?.data?.id === c1.json?.data?.id);

  const cSelf = await post('calls/reportCall', { calleeId: buyer.id }, buyer.token);
  check('خودتماسی رد', cSelf.json?.status === false);

  const cBad = await post('calls/reportCall', { calleeId: '000000000000000000000000' }, buyer.token);
  check('کاربر ناموجود رد', cBad.json?.status === false);

  // بدون محصول — از پروفایل: همان زوج در پنجره ۶۰ دقیقه → ضد-تکرار (شماره به کاربر تعلق دارد نه آگهی)
  const c3 = await post('calls/reportCall', { calleeId: seller.id, source: 'profile' }, buyer.token);
  check('reportCall از پروفایل → همان رکورد قبلی (ضد-تکرار جفتی)', c3.json?.status === true && c3.json?.data?.repeated === true && c3.json?.data?.id === c1.json?.data?.id);

  // زوج دیگر (خریدار دوم) — رکورد جدید
  const buyer2 = await login('0913' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  const c4 = await post('calls/reportCall', { calleeId: seller.id, productId }, buyer2.token);
  check('reportCall زوج دیگر → رکورد جدید', c4.json?.status === true && c4.json?.data?.repeated === false);

  const rep = await post('admin/calls/getCallReport', { range: 'today' }, token);
  const myCalls = (rep.json?.data?.items ?? []).filter((c) => c.caller?.id === buyer.id || c.caller?.id === buyer2.id);
  check('getCallReport — تماس‌ها دیده می‌شوند', myCalls.length >= 2 && myCalls.every((c) => c.callee?.id === seller.id));
  check('getCallReport — نام نمایشی/موبایل طرف‌ها', !!myCalls[0].caller?.displayName && !!myCalls[0].callee?.phone);
  check('getCallReport — محصول زمینه', myCalls.some((c) => c.product?.id === productId));
  check('getCallReport — stats کامل', rep.json?.data?.stats?.total >= 2 && rep.json?.data?.stats?.today >= 2);

  const repSearch = await post('admin/calls/getCallReport', { search: seller.phone }, token);
  check('getCallReport — جستجو با موبایل فروشنده', (repSearch.json?.data?.items ?? []).length >= 2);

  // ── ۲) چت: خریدار پیام می‌دهد ──────────────────────────────────────────
  const th = await post('chat/startThread', { productId }, buyer.token);
  const threadId = th.json?.data?.thread?.id ?? th.json?.data?.id;
  check('startThread خریدار', Boolean(threadId));

  await post('chat/sendMessage', { threadId, text: `سلام، قیمت پسته تست A6-${rnd} چنده؟` }, buyer.token);
  await sleep(200);
  await post('chat/sendMessage', { threadId, text: 'برای ۵۰۰ کیلو عمده می‌خوام.' }, buyer.token);
  check('دو پیام خریدار ارسال', true);

  // ── ۳) نمای ادمین — لیست ──────────────────────────────────────────────
  const list = await post('admin/chats/getThreadList', { filter: 'all' }, token);
  const row = (list.json?.data?.items ?? []).find((t) => t.id === threadId);
  check('getThreadList — مکالمه دیده می‌شود', !!row);
  check('لیست تازه‌ترین-بالا', row && list.json.data.items[0]?.lastMessageAt != null && new Date(row.lastMessageAt) <= new Date(list.json.data.items[0].lastMessageAt));
  check('unread badge = ۲ (فروشنده نخوانده)', row?.unreadCount === 2, `unread=${row?.unreadCount}`);
  check('awaitingSellerReply روشن', row?.awaitingSellerReply === true);
  check('طرف‌ها: خریدار/فروشنده مشخص', row?.buyer?.id === buyer.id && row?.seller?.id === seller.id);
  check('آخرین پیام: فرستنده = خریدار', row?.lastMessage?.senderRole === 'buyer' && row?.lastMessage?.senderName?.length > 0);

  const listUnread = await post('admin/chats/getThreadList', { filter: 'unread', search: `پسته تست A6 ${rnd}` }, token);
  check('فیلتر unread + جستجو', (listUnread.json?.data?.items ?? []).some((t) => t.id === threadId));

  // ── ۴) نمای ادمین فقط-خواندنی — کلیدی‌ترین خواسته مالک ────────────────
  const before = await post('admin/chats/getThreadMessages', { threadId }, token);
  const msgsBefore = before.json?.data?.messages ?? [];
  check('getThreadMessages — دو پیام با نقش', msgsBefore.length === 2 && msgsBefore.every((m) => m.senderRole === 'buyer'));
  check('پیام‌ها هنوز خوانده‌نشده‌اند (readAt=null)', msgsBefore.every((m) => m.readAt == null));
  check('thread.unreadCount از نگاه ادمین = ۲', before.json?.data?.thread?.unreadCount === 2);

  // یک بار دیگر ادمین باز می‌کند — باز هم نباید خوانده شود
  await post('admin/chats/getThreadMessages', { threadId }, token);
  const list2 = await post('admin/chats/getThreadList', { filter: 'unread' }, token);
  const row2 = (list2.json?.data?.items ?? []).find((t) => t.id === threadId);
  check('باز کردن مکرر ادمین → همچنان خوانده‌نشده', row2?.unreadCount === 2, `unread=${row2?.unreadCount}`);

  // ── ۵) فروشنده جواب می‌دهد و می‌خواند ──────────────────────────────────
  await post('chat/markThreadRead', { threadId }, seller.token);
  await post('chat/sendMessage', { threadId, text: 'سلام، هر کیلو ۳٬۵۰۰٬۰۰۰ تومان — عمده قابل گفتگو.' }, seller.token);

  const after = await post('admin/chats/getThreadMessages', { threadId }, token);
  const msgsAfter = after.json?.data?.messages ?? [];
  check('پیام فروشنده با نقش seller', msgsAfter.length === 3 && msgsAfter[2]?.senderRole === 'seller');
  check('پیام‌های خریدار حالا خوانده‌شده', msgsAfter[0]?.readAt != null && msgsAfter[1]?.readAt != null);
  check('پیام فروشنده هنوز خوانده‌نشده (خریدار نخوانده)', msgsAfter[2]?.readAt == null);
  check('awaitingSellerReply خاموش (آخرین از فروشنده)', after.json?.data?.thread?.awaitingSellerReply === false);

  const list3 = await post('admin/chats/getThreadList', { filter: 'awaiting' }, token);
  check('فیلتر awaiting — مکالمه ما دیگر نیست', !(list3.json?.data?.items ?? []).some((t) => t.id === threadId));

  // ── ۶) آمار ────────────────────────────────────────────────────────────
  const stats = await post('admin/chats/getChatStats', {}, token);
  check('getChatStats', stats.json?.data?.threads >= 1 && stats.json?.data?.messagesToday >= 3);

  const dash = await post('admin/dashboard/getStats', {}, token);
  check('داشبورد: chats.awaitingSellerReply آمده', typeof dash.json?.data?.chats?.awaitingSellerReply === 'number');
  check('داشبورد: calls.today آمده', typeof dash.json?.data?.calls?.today === 'number' && dash.json.data.calls.today >= 2);

  // ── ۷) تست منفی امنیتی ────────────────────────────────────────────────
  const r1 = await post('admin/calls/getCallReport', {}, buyer.token);
  check('کاربر عادی → admin/calls رد', r1.status === 401);
  const r2 = await post('admin/chats/getThreadList', {}, buyer.token);
  check('کاربر عادی → admin/chats رد', r2.status === 401);
  const r3 = await post('admin/calls/getCallReport', {});
  check('بدون توکن → 401', r3.status === 401);

  console.log(`\n── نتیجه: ${pass}✅ / ${fail}❌ ──`);
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
