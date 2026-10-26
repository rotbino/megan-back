#!/usr/bin/env node
/**
 * تست سرتاسری B6 — احراز هویت اسناد (کارت ملی + سلفی → تأیید ادمین)
 * نیاز: سرور در حال اجرا روی :4000 (NODE_ENV=development → devCode)
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

/** ورود OTP → توکن */
async function login(phone) {
  const s = await post('auth/sendOtp', { phone });
  const code = s.json?.data?.devCode;
  if (!code) throw new Error('devCode نیامد: ' + JSON.stringify(s.json));
  const v = await post('auth/verifyOtp', { phone, code });
  return v.json?.data?.accessToken;
}

/** تصویر تستی jpeg — بافت پرجزئیات > ۲۰KB (قاعده باسکول) */
async function makeJpeg(label) {
  const { default: sharp } = await import('sharp');
  const W = 1100, H = 750;
  const shapes = Array.from({ length: 140 }, (_, i) => {
    const x = (i * 137) % W, y = (i * 89) % H;
    return i % 3 === 0
      ? `<circle cx="${x}" cy="${y}" r="${8 + (i % 11) * 4}" fill="hsl(${(i * 13) % 360},72%,${35 + (i % 6) * 9}%)" opacity="0.85"/>`
      : `<rect x="${x}" y="${y}" width="${30 + (i % 5) * 12}" height="${14 + (i % 4) * 8}" transform="rotate(${i * 7} ${x} ${y})" fill="hsl(${(i * 29) % 360},60%,${45 + (i % 4) * 10}%)" opacity="0.75"/>`;
  }).join('');
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e8e2d6"/>
      ${shapes}
      <text x="36" y="70" font-size="40" fill="#222">${label} — تصویر تست</text>
    </svg>`,
  );
  const buf = await sharp(svg).jpeg({ quality: 88 }).toBuffer();
  if (buf.length < 20 * 1024) throw new Error('تصویر تستی خیلی کوچک شد: ' + buf.length);
  return buf;
}

(async () => {
  console.log('── B6: احراز هویت اسناد ──');

  // شماره تصادفی — هر اجرای تست مستقل و idempotent
  const USER_PHONE = '0912' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const ADMIN_PHONE = '09350001122';

  // ۰) ورود کاربر عادی + ادمین (ادمین با make-admin ساخته شده)
  const userToken = await login(USER_PHONE);
  const adminToken = await login(ADMIN_PHONE);
  check('ورود کاربر و ادمین', !!userToken && !!adminToken);

  // ۰.۵) یک آگهی برای تست denorm نشان احراز هویت (کرمان/شهر بابک — زوج واقعی باسکول)
  const cp = await post('products/createProduct', {
    subCategoryId: 44, // پسته
    productName: 'آگهی تست B6',
    provinceId: 21,
    cityId: 230,
    stock: 100,
    minSaleAmount: 10,
    minSalePrice: 100000,
    description: 'تست denorm احراز هویت پس از تأیید ادمین — توضیحات بلندتر از سی نویسه.',
  }, userToken);
  check('آگهی تست ساخته شد', cp.json?.status === true, JSON.stringify(cp.json).slice(0, 200));

  // ۱) وضعیت اولیه — none
  let r = await post('verification/getMyVerification', {}, userToken);
  check('وضعیت اولیه none', r.json?.data?.status === 'none', JSON.stringify(r.json));

  // ۲) مدارک ناقص → خطای فارسی
  const fd1 = new FormData();
  fd1.append('nationalCard', new Blob([await makeJpeg('card')], { type: 'image/jpeg' }), 'card.jpg');
  const res1 = await fetch(`${BASE}/verification/submitVerification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd1,
  });
  const j1 = await res1.json();
  check('مدارک ناقص رد می‌شود', j1.status === false && /الزامی/.test(j1.message ?? ''), JSON.stringify(j1));

  // ۳) ارسال کامل → pending
  const fd = new FormData();
  fd.append('nationalCard', new Blob([await makeJpeg('card')], { type: 'image/jpeg' }), 'card.jpg');
  fd.append('selfie', new Blob([await makeJpeg('selfie')], { type: 'image/jpeg' }), 'selfie.jpg');
  const res2 = await fetch(`${BASE}/verification/submitVerification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd,
  });
  const j2 = await res2.json();
  check('ارسال کامل → pending', j2.status === true && j2.data?.status === 'pending', JSON.stringify(j2));
  check('هر دو مدرک برگشت', !!j2.data?.docs?.nationalCard?.url && !!j2.data?.docs?.selfie?.url);
  check('آروان URL', (j2.data?.docs?.nationalCard?.url ?? '').includes('arvanstorage.ir'));
  const orderId = j2.data?.docs ? undefined : undefined; // id از صف ادمین

  // ۴) تکرار در حال بررسی → خطا
  const fd3 = new FormData();
  fd3.append('nationalCard', new Blob([await makeJpeg('card2')], { type: 'image/jpeg' }), 'card.jpg');
  fd3.append('selfie', new Blob([await makeJpeg('selfie2')], { type: 'image/jpeg' }), 'selfie.jpg');
  const res3 = await fetch(`${BASE}/verification/submitVerification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd3,
  });
  const j3 = await res3.json();
  check('تکرار رد می‌شود', j3.status === false && j3.code === 'VERIFICATION_PENDING', JSON.stringify(j3));

  // ۵) گارد — بدون توکن 401
  const res4 = await fetch(`${BASE}/verification/getMyVerification`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('بدون توکن 401', res4.status === 401);

  // ۶) ادمین صف را می‌بیند
  r = await post('verification/getVerificationOrders', { status: 'pending' }, adminToken);
  const items = r.json?.data?.items ?? [];
  check('ادمین سفارش را می‌بیند', items.length === 1, JSON.stringify(r.json).slice(0, 300));
  check('مدارک در صف ادمین', !!items[0]?.docs?.nationalCard?.url && !!items[0]?.docs?.selfie?.url);
  const id = items[0]?.id;

  // ۷) کاربر عادی به صف ادمین دست ندارد
  r = await post('verification/getVerificationOrders', {}, userToken);
  check('کاربر عادی 403', r.status === 403);

  // ۸) رد بدون دلیل → خطا
  r = await post('verification/reviewVerification', { orderId: id, approve: false }, adminToken);
  check('رد بدون دلیل خطا', r.json?.status === false && r.json?.code === 'REASON_REQUIRED');

  // ۹) تأیید ادمین → approved + isVerified کاربر
  r = await post('verification/reviewVerification', { orderId: id, approve: true }, adminToken);
  check('تأیید موفق', r.json?.status === true, JSON.stringify(r.json));

  // ۱۰) وضعیت کاربر → approved
  r = await post('verification/getMyVerification', {}, userToken);
  check('وضعیت نهایی approved', r.json?.data?.status === 'approved');

  // ۱۱) is_verified در پروفایل
  r = await post('users/getProfile', {}, userToken);
  check('پروفایل is_verified=true', r.json?.data?.user?.is_verified === true);

  // ۱۱.۵) denorm آگهی — seller.isVerified روی محصولات کاربر
  r = await post('products/getMyProducts', {}, userToken);
  const mine = r.json?.data?.items ?? [];
  check('denorm آگهی‌ها seller.isVerified', mine.length > 0 && mine.every((p) => p.seller?.isVerified === true), JSON.stringify(mine[0]?.seller ?? {}).slice(0, 200));

  // ۱۲) تأیید دوباره → خطا
  const fd5 = new FormData();
  fd5.append('nationalCard', new Blob([await makeJpeg('c3')], { type: 'image/jpeg' }), 'c.jpg');
  fd5.append('selfie', new Blob([await makeJpeg('s3')], { type: 'image/jpeg' }), 's.jpg');
  const res5 = await fetch(`${BASE}/verification/submitVerification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: fd5,
  });
  const j5 = await res5.json();
  check('ارسال پس از تأیید رد می‌شود', j5.status === false && j5.code === 'ALREADY_VERIFIED', JSON.stringify(j5));

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
