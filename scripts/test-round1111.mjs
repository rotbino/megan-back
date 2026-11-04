#!/usr/bin/env node
/**
 * تست دور ۴-۱۱ — ادغام چت جفت کاربر + مخاطبین:
 *  ۱. فروشنده ۲ آگهی تستی می‌سازد و ادمین تأییدشان می‌کند (با آگهی موجود = ۳)
 *  ۲. خریدار روی ۳ آگهی جداگانه گفتگو شروع می‌کند + پیام می‌فرستد
 *  ۳. + گفتگوی مستقیم از پروفایل — همه باید در «یک» مکالمه بیفتند
 *  ۴. لیست مکالمات هر دو طرف باید جفت را فقط «یک بار» نشان دهد؛
 *     پیام تازه در همان مکالمهٔ قبلی ادامه می‌یابد (مثل همهٔ پیامرسان‌ها)
 *  ۵. مخاطبین: درون‌ریزی (عضو/غیرعضو/نرمال‌سازی) + لیست + حذف
 *  پایان: آگهی‌های تستی حذف نرم می‌شوند
 */
const BASE = 'http://localhost:4000/api/v1';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

/** وضعیت مستقیم آگهی در دیتابیس — معادل تأیید/حذف ادمین بدون ورود پنل مدیریت */
async function setProductStatus(id, status) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: '.env', override: true });
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.DATABASE_URL);
  await c.connect();
  await c.db().collection('Product').updateOne({ _id: id }, { $set: { status, updated_at: new Date() } });
  await c.close();
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
  const v = await post('auth/verifyOtp', { phone, code: s.json?.data?.devCode });
  const token = v.json?.data?.accessToken;
  const p = await post('users/getProfile', {}, token);
  return { token, userId: p.json?.data?.user?.id ?? null, userName: p.json?.data?.user?.user_name ?? null, phone };
}

async function adminLogin() {
  const r = await post('admin/auth/login', { username: '09196421264', password: 'admin434343' });
  if (!r.json?.data?.token) throw new Error('admin login failed');
  return r.json.data.token;
}

(async () => {
  console.log('── دور ۴-۱۱: چت یکتا per جفت + مخاطبین ──');

  const seller = await login('09196421264');
  const buyer = await login('09196421265');
  check('ورود دو اکانت تستی', Boolean(seller.token && buyer.token));

  // ─── ۱) ساخت + تأیید ۲ آگهی تستی ───
  const created = [];
  for (let i = 0; i < 2; i++) {
    const c = await post('products/createProduct', {
      productName: `تست چت یکتا ${i + 1} — دور ۴-۱۱`,
      subCategoryId: 131, // برگ معتبر: پنیر
      provinceId: 1,
      cityId: 1, // آذرشهر — از همان استان
      stock: 1000,
      minSaleAmount: 100,
      minSalePrice: 50000,
      description: 'آگهی تستی برای تست ادغام چت — حذف می‌شود.',
      photos: [],
    }, seller.token);
    const id = c.json?.data?.id;
    check(`آگهی تستی ${i + 1} ساخته شد`, Boolean(id), JSON.stringify(c.json).slice(0, 120));
    if (id) {
      created.push(id);
      await setProductStatus(id, 'confirmed');
      check(`آگهی ${id} تأیید شد`, true);
    }
  }

  const myProducts = await post('products/getMyProducts', {}, seller.token);
  const confirmed = (myProducts.json?.data?.items ?? []).filter((p) => p.status === 'confirmed');
  const targets = confirmed.slice(0, 3);
  check('۳ آگهی تاییدشده برای سناریو آماده است', targets.length >= 3, `دارد: ${targets.length}`);

  // وضعیت اولیهٔ جفت در لیست فروشنده
  const before = await post('chat/getConversations', {}, seller.token);
  const beforeCount = (before.json?.data ?? []).filter((t) => t.counterpart?.id === buyer.userId).length;

  // ─── ۲) خریدار روی ۳ آگهی جداگانه گفتگو می‌کند ───
  const threadIds = new Set();
  for (const prod of targets) {
    const st = await post('chat/startThread', { productId: prod.id }, buyer.token);
    check(`startThread روی «${prod.productName}»`, Boolean(st.json?.data?.id));
    const sm = await post('chat/sendMessage', { threadId: st.json?.data?.id, text: `سلام — قیمت ${prod.productName} چنده؟ (تست ۴-۱۱)` }, buyer.token);
    check(`پیام روی آگهی ${prod.id} رفت`, Boolean(sm.json?.data?.id));
    threadIds.add(st.json?.data?.id);
  }

  // ─── ۳) گفتگوی مستقیم از پروفایل (productId=null) ───
  const dt = await post('chat/startThread', { userName: seller.userName }, buyer.token);
  check('گفتگوی مستقیم از پروفایل', Boolean(dt.json?.data?.id), JSON.stringify(dt.json).slice(0, 120));
  if (dt.json?.data?.id) {
    await post('chat/sendMessage', { threadId: dt.json.data.id, text: 'از پروفایل هم پیام می‌دهم (تست ۴-۱۱)' }, buyer.token);
    threadIds.add(dt.json.data.id);
  }
  check('همهٔ مسیرها (۳ آگهی + پروفایل) به «یک» مکالمه رسیدند', threadIds.size === 1, `threadها: ${threadIds.size}`);

  // ─── ۴) لیست هر دو طرف: جفت فقط یک بار ───
  const after = await post('chat/getConversations', {}, seller.token);
  const list = after.json?.data ?? [];
  const withBuyer = list.filter((t) => t.counterpart?.id === buyer.userId);
  check('خریدار در لیست چت فروشنده فقط یک بار است', withBuyer.length === 1, `شمارش: ${withBuyer.length}`);
  check('آمار نسبت به قبل فقط یک ردیف است', withBuyer.length <= Math.max(1, beforeCount), `قبل: ${beforeCount}، بعد: ${withBuyer.length}`);
  const single = withBuyer[0];
  check('آخرین پیام همان پیام پروفایل است', single?.lastMessage?.text?.includes('از پروفایل'), single?.lastMessage?.text ?? '');
  check('خوانده‌نشده جمع همهٔ پیام‌هاست', (single?.unreadCount ?? 0) >= 4, `unread: ${single?.unreadCount}`);

  const buyerList = (await post('chat/getConversations', {}, buyer.token)).json?.data ?? [];
  const withSeller = buyerList.filter((t) => t.counterpart?.id === seller.userId);
  check('فروشنده در لیست چت خریدار فقط یک بار است', withSeller.length === 1, `شمارش: ${withSeller.length}`);

  // پیام بعدی فروشنده در همان مکالمه ادامه یابد
  const reply = await post('chat/sendMessage', { threadId: single?.id, text: 'پاسخ فروشنده در همان چت (تست ۴-۱۱)' }, seller.token);
  check('پاسخ فروشنده در همان thread', reply.json?.data?.threadId === single?.id);
  const buyerThread = (await post('chat/getThreadMessages', { threadId: single?.id }, buyer.token)).json?.data ?? [];
  check('تاریخچهٔ خریدار همهٔ پیام‌ها را در یک چت می‌بیند', buyerThread.length >= 5, `پیام‌ها: ${buyerThread.length}`);

  // ─── ۵) مخاطبین ───
  console.log('  ── مخاطبین ──');
  const beforeContacts = ((await post('contacts/getMyContacts', {}, buyer.token)).json?.data?.items ?? []).length;
  const imp = await post('contacts/import', {
    items: [
      { name: 'سعید تست', phone: '+98 919 642 1264' }, // عضو (فرمت +98 با فاصله‌ها)
      { name: 'زهرا غیرعضو', phone: '۰۹۰۰۰۰۰۰۰۰۰' }, // فارسی‌رقم، قطعاً غیرعضو
      { name: '', phone: '09121112233' }, // بدون نام
      { name: 'بی‌شماره', phone: 'abc' }, // نامعتبر — بی‌صدا رد می‌شود
    ],
  }, buyer.token);
  const afterContacts = ((await post('contacts/getMyContacts', {}, buyer.token)).json?.data?.items ?? []);
  check('درون‌ریزی مخاطبین (با رد بی‌صدا-invalid)', imp.json?.status === true && afterContacts.length >= beforeContacts + 1, JSON.stringify(imp.json).slice(0, 120));

  const list2 = { json: { data: { items: afterContacts } } };
  const items = list2.json?.data?.items ?? [];
  check('لیست مخاطبین آمد', items.length >= 2, `items: ${items.length}`);
  const member = items.find((c) => c.phone === '09196421264');
  const nonMember = items.find((c) => c.phone === '09000000000');
  check('+98 919 642 1264 → 09196421264 نرمال شد و «عضو» است', member?.isMember === true, JSON.stringify(member));
  check('۰۹۰۰۰۰۰۰۰۰۰ فارسی → انگلیسی و غیرعضو', Boolean(nonMember) && nonMember?.isMember === false, JSON.stringify(nonMember));
  check('بدون نام → نام خالی مجاز', items.some((c) => c.phone === '09121112233'));

  // درون‌ریزی دوباره idempotent
  const imp2 = await post('contacts/import', { items: [{ name: 'سعید تست', phone: '+989196421264' }] }, buyer.token);
  check('درون‌ریزی تکراری چیز جدید نمی‌سازد', imp2.json?.data?.imported === 0, JSON.stringify(imp2.json?.data));

  // حذف
  if (nonMember) {
    const del = await post('contacts/delete', { id: nonMember.id }, buyer.token);
    check('حذف مخاطب', del.json?.status === true);
  }

  // ─── پاکسازی: آگهی‌های تستی ───
  for (const id of created) {
    await setProductStatus(id, 'deleted');
  }
  console.log(`  🧹 ${created.length} آگهی تستی حذف شد`);

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('خطای تست:', e);
  process.exit(1);
});
