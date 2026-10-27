#!/usr/bin/env node
/**
 * تست دستی فاز A1 پنل ادمین:
 *  ۱) login با ادمین پیش‌فرض (09196421264/admin434343 از بوت‌استرپ)
 *  ۲) me → اطلاعات ادمین بدون داده حساس
 *  ۳) getStats → شمارنده‌های داشبورد
 *  ۴) توکن کاربر عادی روی API ادمین → رد (تست منفی امنیتی)
 *  ۵) بدون توکن → 401
 *  ۶) رمز غلط → 401
 *  ۷) changePassword → تغییر رمز + ورود با رمز جدید + برگشت به رمز اصلی
 *
 * اجرا: node scripts/test-admin-a1.mjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const ADMIN_USER = process.env.ADMIN_USER || '09196421264';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin434343';

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

// ۱) ورود ادمین پیش‌فرض
const login = await post('/admin/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
check('ورود ادمین پیش‌فرض', login.json?.status === true && Boolean(login.json?.data?.token));
const token = login.json?.data?.token;
check('نقش SUPER_ADMIN', login.json?.data?.admin?.role === 'SUPER_ADMIN');
check('هش رمز در پاسخ نیست', !JSON.stringify(login.json).includes('passwordHash'));

// ۲) me
const me = await post('/admin/auth/me', {}, token);
check('me — نام کاربری درست', me.json?.data?.username === ADMIN_USER);
check('me — بدون داده حساس', !JSON.stringify(me.json).includes('passwordHash'));

// ۳) getStats
const stats = await post('/admin/dashboard/getStats', {}, token);
check(
  'getStats — ساختار کامل',
  stats.json?.data?.users?.total >= 0 && stats.json?.data?.products !== undefined && stats.json?.data?.queues !== undefined,
  `users=${stats.json?.data?.users?.total} products=${stats.json?.data?.products?.total}`,
);

// ۴) توکن کاربر عادی → رد (تست منفی)
const userLogin = await post('/auth/login', { phone: `0936${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` });
const userToken = userLogin.json?.data?.accessToken;
const negative = await post('/admin/dashboard/getStats', {}, userToken);
check('توکن کاربر عادی روی admin/* رد شد', negative.status === 401, `status=${negative.status}`);

// ۵) بدون توکن → 401
const noToken = await post('/admin/dashboard/getStats', {});
check('بدون توکن → 401', noToken.status === 401);

// ۶) رمز غلط → 401
const wrong = await post('/admin/auth/login', { username: ADMIN_USER, password: 'wrong-pass' });
check('رمز غلط → 401', wrong.status === 401);

// ۷) changePassword + ورود با رمز جدید + برگشت
const change = await post('/admin/auth/changePassword', { currentPassword: ADMIN_PASS, newPassword: 'temp-pass-123' }, token);
check('تغییر رمز', change.json?.status === true);
const loginNew = await post('/admin/auth/login', { username: ADMIN_USER, password: 'temp-pass-123' });
check('ورود با رمز جدید', loginNew.json?.status === true);
const back = await post('/admin/auth/changePassword', { currentPassword: 'temp-pass-123', newPassword: ADMIN_PASS }, loginNew.json?.data?.token);
check('برگشت به رمز اصلی', back.json?.status === true);

console.log(failures === 0 ? '\n🎉 همه تست‌های A1 موفق' : `\n💥 ${failures} تست شکست خورد`);
process.exit(failures === 0 ? 0 : 1);
