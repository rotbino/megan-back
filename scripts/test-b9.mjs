#!/usr/bin/env node
/**
 * تست سرتاسری B9 — کیف پول و نردبان (شارژ کارت‌به‌کارت + نردبان ماهانه)
 * نیاز: سرور در حال اجرا روی :4000 (NODE_ENV=development → devCode)
 * پوشش:
 *  • OTP ثابت 1234 (چهاررقمی) + کد غلط
 *  • getWallet (موجودی/پکیج‌ها/کارت) + گارد
 *  • createChargeOrder (multipart فیش) — خطاهای پکیج/فیش + موفق
 *  • ادمین: صف + رد بدون دلیل + رد با دلیل + تأیید (شارژ اضافه می‌شود)
 *  • ladderProduct — قبل شارژ (کمبود موجودی) + آگهی pending + آگهی دیگران +
 *    موفق + تمدید + کمبود + صدر «مرتبط‌ترین» به‌رغم جدیدتربودن رقیب
 *  • انقضای نردبان (فیلتر زنده — آگهی از لیست حذف می‌شود)
 *  • getWalletTransactions — شارژ/رد/نردبان یکجا
 */
const BASE = 'http://localhost:4000/api/v1';

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

/** ورود OTP — کد ثابت 1234 */

async function adminLogin(username = process.env.ADMIN_USER || '09196421264', password = process.env.ADMIN_PASS || 'admin434343') {
  const r = await post('admin/auth/login', { username, password });
  if (!r.json?.data?.token) throw new Error('admin login failed: ' + JSON.stringify(r.json).slice(0, 200));
  return r.json.data.token;
}

async function login(phone, code = '1234') {
  const s = await post('auth/sendOtp', { phone });
  return { devCode: s.json?.data?.devCode, token: (await post('auth/verifyOtp', { phone, code })).json?.data?.accessToken };
}

/** تصویر تستی jpeg — بافت پرجزئیات > ۲۰KB (قاعده باسکول) */
async function makeJpeg(label) {
  const { default: sharp } = await import('sharp');
  const W = 1100, H = 750;
  const shapes = Array.from({ length: 140 }, (_, i) => {
    const x = (i * 137) % W, y = (i * 89) % H;
    return i % 3 === 0
      ? `<circle cx="${x}" cy="${y}" r="${8 + (i % 11) * 4}" fill="hsl(${(i * 13) % 360},72%,${35 + (i % 6) * 9}%)" opacity="0.85"/>`
      : `<rect x="${x}" cy="${y}" width="${30 + (i % 5) * 12}" height="${14 + (i % 4) * 8}" transform="rotate(${i * 7} ${x} ${y})" fill="hsl(${(i * 29) % 360},60%,${45 + (i % 4) * 10}%)" opacity="0.75"/>`;
  }).join('');
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e8e2d6"/>
      ${shapes}
      <text x="36" y="70" font-size="40" fill="#222">${label} — فیش تست</text>
    </svg>`,
  );
  const buf = await sharp(svg).jpeg({ quality: 88 }).toBuffer();
  if (buf.length < 20 * 1024) throw new Error('تصویر تستی خیلی کوچک شد: ' + buf.length);
  return buf;
}

/** ارسال فیش شارژ (multipart) */
async function sendReceipt(path, token, packageKey, jpegBuf, filename = 'receipt.jpg') {
  const fd = new FormData();
  if (packageKey) fd.append('packageKey', packageKey);
  if (jpegBuf) fd.append('receipt', new Blob([jpegBuf], { type: 'image/jpeg' }), filename);
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  console.log('── B9: کیف پول و نردبان ──');

  const USER_PHONE = '0912' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const OTHER_PHONE = '0935' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const ADMIN_PHONE = '09350001122';

  // ۰) OTP ثابت 1234 + ورود
  const { devCode, token: userToken } = await login(USER_PHONE);
  check('کد ثابت 1234 صادر می‌شود', devCode === '1234', `devCode=${devCode}`);
  check('ورود با کد 1234', !!userToken);

  // ۰.۵) کد غلط → OTP_WRONG و کد درست همچنان کار می‌کند
  {
    await post('auth/sendOtp', { phone: USER_PHONE });
    const w = await post('auth/verifyOtp', { phone: USER_PHONE, code: '9999' });
    check('کد غلط رد می‌شود', w.json?.status === false && w.json?.code === 'OTP_WRONG', JSON.stringify(w.json));
    const ok2 = await post('auth/verifyOtp', { phone: USER_PHONE, code: '1234' });
    check('پس از کد غلط، کد درست کار می‌کند', ok2.json?.status === true);
  }

  const adminToken = await adminLogin();
  const otherToken = (await login(OTHER_PHONE)).token;
  check('ورود ادمین و کاربر دوم', !!adminToken && !!otherToken);

  // ۱) دو آگهی تست (A برای نردبان، B رقیب جدیدتر) → pending
  const mk = (name) => post('products/createProduct', {
    subCategoryId: 44, // پسته
    productName: name,
    provinceId: 21,
    cityId: 230,
    stock: 100,
    minSaleAmount: 10,
    minSalePrice: 100000,
    description: 'تست کیف پول و نردبان — توضیحات بلندتر از سی نویسه برای اعتبارسنجی.',
  }, userToken);
  const cpA = await mk('آگهی تست B9-A نردبان');
  const cpB = await mk('آگهی تست B9-B رقیب');
  const productA = cpA.json?.data?.id;
  const productB = cpB.json?.data?.id;
  check('دو آگهی تست ساخته شد', !!productA && !!productB, JSON.stringify(cpA.json).slice(0, 200));

  // ۲) getWallet — موجودی صفر + ۳ پکیج + کارت
  let r = await post('wallet/getWallet', {}, userToken);
  check('موجودی اولیه صفر', r.json?.data?.balance === 0, JSON.stringify(r.json));
  check('۳ پکیج شارژ', (r.json?.data?.packages ?? []).length === 3);
  check('پکیج p200 با ۱۰٪ اضافه', r.json?.data?.packages?.find?.((p) => p.key === 'p200')?.charge === 220_000);
  check('کارت واریز موجود', !!r.json?.data?.cardNumber && !!r.json?.data?.cardOwner);
  check('قیمت نردبان ۱۰۰هزار', r.json?.data?.ladderMonthlyPrice === 100_000);

  // ۳) گارد — بدون توکن 401 / کاربر عادی به صف ادمین 403
  const res401 = await fetch(`${BASE}/wallet/getWallet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('بدون توکن 401', res401.status === 401);
  r = await post('admin/wallet/getChargeOrders', {}, userToken);
  check('کاربر عادی روی مسیر ادمین 401', r.status === 401);

  // ۴) نردبان با آگهی pending → PRODUCT_NOT_CONFIRMED
  r = await post('wallet/ladderProduct', { productId: productA }, userToken);
  check('نردبان روی آگهی pending رد می‌شود', r.json?.code === 'PRODUCT_NOT_CONFIRMED', JSON.stringify(r.json));

  // ۵) نردبان آگهی دیگران → forbidden
  await post('admin/products/reviewProduct', { id: productA, approve: true }, adminToken); // A تأیید
  r = await post('wallet/ladderProduct', { productId: productA }, otherToken);
  check('نردبان آگهی دیگران 403', r.status === 403, JSON.stringify(r.json));

  // ۶) نردبان بدون موجودی → WALLET_INSUFFICIENT
  r = await post('wallet/ladderProduct', { productId: productA }, userToken);
  check('نردبان بدون موجودی رد می‌شود', r.json?.code === 'WALLET_INSUFFICIENT', JSON.stringify(r.json));

  // ۷) سفارش شارژ — پکیج نامعتبر / بدون فیش
  const jpeg = await makeJpeg('p200');
  let j = await sendReceipt('wallet/createChargeOrder', userToken, 'p999', jpeg);
  check('پکیج نامعتبر رد می‌شود', j.json?.code === 'PACKAGE_INVALID', JSON.stringify(j.json));
  j = await sendReceipt('wallet/createChargeOrder', userToken, 'p100', null);
  check('بدون فیش رد می‌شود', j.json?.code === 'RECEIPT_MISSING', JSON.stringify(j.json));

  // ۸) سفارش p200 با فیش → pending؛ طبق TEST-D6 در تراکنش‌ها «نمی‌آید» —
  //    فیش‌های در انتظار فقط در تب «کارت به کارت» (getMyChargeOrders) زندگی می‌کنند
  j = await sendReceipt('wallet/createChargeOrder', userToken, 'p200', jpeg);
  check('سفارش شارژ pending', j.json?.status === true && j.json?.data?.status === 'pending', JSON.stringify(j.json).slice(0, 300));
  r = await post('wallet/getWalletTransactions', {}, userToken);
  check('تراکنش در انتظار در تاریخچه نمی‌آید (TEST-D6)', !(r.json?.data?.items ?? []).some((t) => t.amount === 220_000));
  r = await post('wallet/getMyChargeOrders', {}, userToken);
  check('فیش در انتظار در تب «کارت به کارت»', (r.json?.data?.items ?? []).some((t) => t.status === 'pending' && t.amount === 200_000));
  check('موجودی هنوز صفر', (await post('wallet/getWallet', {}, userToken)).json?.data?.balance === 0);

  // ۹) ادمین — صف + فیش آروان + رد بدون دلیل
  r = await post('admin/wallet/getChargeOrders', { status: 'pending' }, adminToken);
  const mine = (r.json?.data?.items ?? []).find((it) => it.user?.phone === USER_PHONE);
  check('ادمین سفارش را با فیش می‌بیند', !!mine?.receipt?.url && mine.receipt.url.includes('arvanstorage.ir'), JSON.stringify(r.json).slice(0, 300));
  r = await post('admin/wallet/reviewChargeOrder', { orderId: mine?.id, approve: false }, adminToken);
  check('رد بدون دلیل رد می‌شود', r.json?.code === 'REASON_REQUIRED', JSON.stringify(r.json));

  // ۱۰) سفارش دوم p100 → رد با دلیل (موجودی نمی‌رود بالا)
  j = await sendReceipt('wallet/createChargeOrder', userToken, 'p100', await makeJpeg('p100'));
  const order2 = j.json?.data?.orderId;
  r = await post('admin/wallet/reviewChargeOrder', { orderId: order2, approve: false, rejectionReason: 'فیش ناخواناست — دوباره بفرستید.' }, adminToken);
  check('رد با دلیل موفق', r.json?.status === true && r.json?.data?.status === 'rejected', JSON.stringify(r.json));
  check('موجودی پس از رد صفر ماند', (await post('wallet/getWallet', {}, userToken)).json?.data?.balance === 0);

  // ۱۱) تأیید p200 → موجودی ۲۲۰هزار + بررسی دوباره → ALREADY_REVIEWED
  r = await post('admin/wallet/reviewChargeOrder', { orderId: mine?.id, approve: true }, adminToken);
  check('تأیید شارژ موفق', r.json?.status === true && r.json?.data?.charged === 220_000, JSON.stringify(r.json));
  check('موجودی ۲۲۰هزار شد', (await post('wallet/getWallet', {}, userToken)).json?.data?.balance === 220_000);
  r = await post('admin/wallet/reviewChargeOrder', { orderId: mine?.id, approve: true }, adminToken);
  check('بررسی دوباره رد می‌شود', r.json?.code === 'ALREADY_REVIEWED', JSON.stringify(r.json));

  // ۱۲) نردبان A → موجودی ۱۲۰هزار + انقضای ~۳۰ روز
  r = await post('wallet/ladderProduct', { productId: productA }, userToken);
  const exp1 = new Date(r.json?.data?.ladderExpiresAt ?? 0);
  check('نردبان موفق', r.json?.status === true && r.json?.data?.isLadder === true, JSON.stringify(r.json).slice(0, 300));
  check('موجودی ۱۲۰هزار شد', (await post('wallet/getWallet', {}, userToken)).json?.data?.balance === 120_000);
  const days = (exp1 - Date.now()) / 86_400_000;
  check('انقضای ~۳۰ روز', days > 29.9 && days < 30.1, `days=${days.toFixed(2)}`);

  // ۱۳) B را بعد از نردبانِ A تأیید می‌کنیم → B جدیدترین است؛ نردبان A باید صدر بگیرد
  await post('admin/products/reviewProduct', { id: productB, approve: true }, adminToken);
  r = await post('products/getProductList', { sort: 'related', perPage: 20 });
  const listIds = (r.json?.data?.items ?? []).map((it) => it.id);
  check('نردبان صدر «مرتبط‌ترین» به‌رغم جدیدتربودن B', listIds[0] === productA, JSON.stringify(listIds.slice(0, 5)));
  check('B نیز در لیست است', listIds.includes(productB));

  // ۱۴) تمدید → انقضا +۳۰ روز دیگر، موجودی ۲۰هزار
  r = await post('wallet/ladderProduct', { productId: productA }, userToken);
  const exp2 = new Date(r.json?.data?.ladderExpiresAt ?? 0);
  const days2 = (exp2 - exp1) / 86_400_000;
  check('تمدید = امتداد انقضا', days2 > 29.9 && days2 < 30.2, `days2=${days2.toFixed(2)}`);
  check('موجودی ۲۰هزار شد', (await post('wallet/getWallet', {}, userToken)).json?.data?.balance === 20_000);

  // ۱۵) نردبان سوم → کمبود موجودی
  r = await post('wallet/ladderProduct', { productId: productA }, userToken);
  check('نردبان سوم رد می‌شود', r.json?.code === 'WALLET_INSUFFICIENT', JSON.stringify(r.json));

  // ۱۶) تاریخچه — شارژ تأییدشده + ۲ نردبان (TEST-D6: در انتظار/ردشده اینجا نیستند)
  r = await post('wallet/getWalletTransactions', {}, userToken);
  const items = r.json?.data?.items ?? [];
  check('۳ تراکنش', items.length === 3, JSON.stringify(items));
  check('شارژ تأییدشده (+220هزار)', items.some((t) => t.incoming && !t.pendingAdmin && t.amount === 220_000));
  check('شارژ ردشده', items.some((t) => !t.incoming && t.amount === 100_000 && /رد/.test(t.title)));
  check('۲ نردبان کسرشده', items.filter((t) => !t.incoming && /نردبان/.test(t.title) && t.amount === 100_000).length === 2);

  // ۱۷) انقضای نردبان — دستکاری مستقیم DB → فیلتر زنده لیست (کلید کش متفاوت: perPage 21)
  {
    const { readFileSync } = await import('node:fs');
    const { MongoClient } = await import('mongodb');
    const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const url = envText.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
    const client = new MongoClient(url);
    await client.connect();
    await client.db().collection('Product').updateOne(
      { _id: productA },
      { $set: { ladder_expires_at: new Date(Date.now() - 86_400_000) } },
    );
    await client.close();
  }
  r = await post('products/getProductList', { sort: 'related', perPage: 21 });
  const listIds2 = (r.json?.data?.items ?? []).map((it) => it.id);
  check('نردبان منقضی از لیست حذف می‌شود', !listIds2.includes(productA), JSON.stringify(listIds2.slice(0, 5)));
  check('B همچنان در لیست است', listIds2.includes(productB));
  check('آگهی همچنان با getProductById قابل دسترسی', (await post('products/getProductById', { id: productA })).json?.status === true);

  // ۱۸) پاک‌سازی خود آزمایش — حذف نرم آگهی‌های تست
  await post('products/deleteMyProduct', { id: productA }, userToken);
  await post('products/deleteMyProduct', { id: productB }, userToken);
  r = await post('products/getProductList', { s: 'آگهی تست B9', perPage: 22 });
  check('آگهی‌های تست پاک شدند', (r.json?.data?.items ?? []).length === 0, JSON.stringify(r.json?.data?.items?.length));

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
