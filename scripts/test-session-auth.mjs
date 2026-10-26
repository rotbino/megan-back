#!/usr/bin/env node
/**
 * تست دستی جریان ورود روش سشن (بدون پیامک):
 *  ۱) ورود با شماره جدید → ثبت‌نام خودکار + توکن‌ها
 *  ۲) پروفایل → has_password=false (بنر قرمز فعال)
 *  ۳) setPassword → تعیین رمز
 *  ۴) پروفایل → has_password=true (بنر برداشته می‌شود)
 *  ۵) ورود بدون رمز → PASSWORD_REQUIRED
 *  ۶) ورود رمز غلط → PASSWORD_WRONG
 *  ۷) ورود رمز درست → موفق
 *
 * اجرا: node scripts/test-session-auth.mjs [شماره-تست]
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const phone = process.argv[2] || `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const PASSWORD = 'imach123';

let failures = 0;
function check(name, cond, extra = '') {
  const mark = cond ? '✅' : '❌';
  if (!cond) failures++;
  console.log(`${mark} ${name}${extra ? ` — ${extra}` : ''}`);
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ۱) ورود با شماره جدید
const login1 = await post('/auth/login', { phone });
check('ورود شماره جدید (ثبت‌نام خودکار)', login1.json?.status === true && login1.json?.data?.isNewUser === true);
const accessToken = login1.json?.data?.accessToken;
check('توکن دسترسی صادر شد', Boolean(accessToken));

// ۲) پروفایل → has_password=false
const profile1 = await post('/users/getProfile', {}, accessToken);
check('پروفایل: has_password=false (بنر قرمز فعال)', profile1.json?.data?.user?.has_password === false);

// ۳) تعیین رمز
const setPassword = await post('/auth/setPassword', { password: PASSWORD }, accessToken);
check('تعیین رمز پنل', setPassword.json?.status === true);

// ۳-ب) رمز کوتاه باید رد شود
const tooShort = await post('/auth/setPassword', { password: '123' }, accessToken);
check('رمز کوتاه رد شد', tooShort.status === 400);

// ۴) پروفایل → has_password=true
const profile2 = await post('/users/getProfile', {}, accessToken);
check('پروفایل: has_password=true (بنر برداشته می‌شود)', profile2.json?.data?.user?.has_password === true);

// ۵) ورود بدون رمز → PASSWORD_REQUIRED
const login2 = await post('/auth/login', { phone });
check(
  'ورود بدون رمز → PASSWORD_REQUIRED',
  login2.json?.code === 'PASSWORD_REQUIRED' || login2.json?.status === false,
  login2.json?.message ?? '',
);

// ۶) ورود رمز غلط → PASSWORD_WRONG
const login3 = await post('/auth/login', { phone, password: 'wrong-pass' });
check('ورود رمز غلط → PASSWORD_WRONG', login3.json?.code === 'PASSWORD_WRONG' || login3.status === 400);

// ۷) ورود رمز درست → موفق
const login4 = await post('/auth/login', { phone, password: PASSWORD });
check('ورود با رمز درست', login4.json?.status === true && login4.json?.data?.hasPassword === true);

// ۸) کاربر بدون رمز دوم — ورود بدون رمز مثل دفعه اول
const phone2 = `0935${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const login5 = await post('/auth/login', { phone: phone2 });
const login5again = await post('/auth/login', { phone: phone2 });
check('کاربر بدون رمز: ورود دوباره بدون رمز مجاز است', login5again.json?.status === true);

console.log(`\nشماره تست: ${phone}`);
console.log(failures === 0 ? '\n🎉 همه تست‌ها موفق' : `\n💥 ${failures} تست شکست خورد`);
process.exit(failures === 0 ? 0 : 1);
