#!/usr/bin/env
/**
 * تست E2E جریان setPassword با ویرایش موبایل (خواسته مالک ۱-۱۱ دور هشتم):
 *  ۱) شمارهٔ هدف رمزدار → خطای PHONE_HAS_PASSWORD با پیام پشتیبانی
 *  ۲) شمارهٔ هدف بی‌رمز (آرتیفکت ورود سشن) → جذب کامل حساب:
 *     لیست/داده‌ها منتقل، ردیف قدیمی حذف، شمارهٔ قدیف آزاد
 *  ۳) پس از تعیین رمز: توکن قبلی 401 (نشست‌ها باطل) + ورود با رمز جدید
 *
 * اجرا: node scripts/test-setpassword-phone.mjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const PWD = 'imach-test-1';

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
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

const rnd = () => `0915${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

// ─── آماده‌سازی ──────────────────────────────────────────────────────────
// B: حساب رمزدار (هدف خطا)
const phoneB = rnd();
const loginB = await post('/auth/login', { phone: phoneB });
await post('/auth/setPassword', { password: PWD }, loginB.json?.data?.accessToken);
console.log(`B (رمزدار) = ${phoneB}`);

// A: کاربر اصلی بدون رمز
const phoneA = rnd();
const loginA = await post('/auth/login', { phone: phoneA });
const tokenA = loginA.json?.data?.accessToken;
const profileA = await post('/users/getProfile', {}, tokenA);
const idA = profileA.json?.data?.user?.id;
console.log(`A (بدون رمز) = ${phoneA}`);

// C: حساب بی‌رمز با داده (لیست نشان‌شده) — آرتیفکت ورود سشن
const phoneC = rnd();
const loginC = await post('/auth/login', { phone: phoneC });
const tokenC = loginC.json?.data?.accessToken;
await post('/saved/createSavedList', { name: 'مشتریان تست جذب' }, tokenC);
console.log(`C (بی‌رمز + لیست) = ${phoneC}`);

// ─── ۱) شمارهٔ رمزدار → خطای دقیق پشتیبانی ──────────────────────────────
const err = await post('/auth/setPassword', { password: PWD, newPhone: phoneB }, tokenA);
const errMsg = err.json?.message ?? '';
check(
  'شمارهٔ رمزدار → PHONE_HAS_PASSWORD',
  err.json?.status === false && err.json?.code === 'PHONE_HAS_PASSWORD',
  errMsg,
);
check(
  'پیام شامل شماره پشتیبانی 09196421264',
  errMsg.includes('09196421264') && errMsg.includes('قبلاً رمز تعیین شده'),
);
check('خطا قبل از هر تغییری رد می‌شود (401/400 نه 500)', err.status === 400 || err.status === 403);

// ─── ۲) شمارهٔ بی‌رمز → جذب حساب C ───────────────────────────────────────
const ok = await post('/auth/setPassword', { password: PWD, newPhone: phoneC }, tokenA);
check('تعیین رمز با شمارهٔ جدید (جذب C)', ok.json?.status === true && ok.json?.data?.phone === phoneC);

// توکن قبلی باید مرده باشد (نشست‌ها باطل شدند)
const deadProfile = await post('/users/getProfile', {}, tokenA);
check('توکن قدیمی بعد از تعیین رمز 401 می‌شود', deadProfile.status === 401);

// ورود با شمارهٔ جدید + رمز جدید → همان حساب A (ادغام، نه حساب تازه)
const relogin = await post('/auth/login', { phone: phoneC, password: PWD });
const tokenNew = relogin.json?.data?.accessToken;
check('ورود با شمارهٔ جدید + رمز جدید', relogin.json?.status === true && relogin.json?.data?.hasPassword === true);
const profileNew = await post('/users/getProfile', {}, tokenNew);
check('حساب همان A است (C در A جذب شد)', profileNew.json?.data?.user?.id === idA);

// لیست C به مالک جدید رسیده است (پاسخ: data خودش آرایه است)
const lists = await post('/saved/getSavedLists', {}, tokenNew);
const names = (lists.json?.data ?? []).map((l) => l.name);
check("لیست نشان‌شدهٔ C به حساب ادغام‌شده منتقل شد", names.includes('مشتریان تست جذب'), JSON.stringify(names));

// شمارهٔ قدیمی A آزاد شده است (ورود با آن = ثبت‌نام تازه)
const oldPhone = await post('/auth/login', { phone: phoneA });
check('شمارهٔ قدیمی آزاد شد (isNewUser=true)', oldPhone.json?.data?.isNewUser === true);

// شمارهٔ C بدون رمز دیگر ورود‌پذیر نیست
const cNoPwd = await post('/auth/login', { phone: phoneC });
check('شمارهٔ ادغام‌شده بدون رمز → PASSWORD_REQUIRED', cNoPwd.json?.code === 'PASSWORD_REQUIRED');

console.log(failures === 0 ? '\n🎉 همهٔ تست‌ها پاس شد' : `\n⚠️ ${failures} تست خراب`);

// ─── پاک‌سازی دیتای تست ─────────────────────────────────────────────────
// B + حساب ادغام‌شده (شمارهٔ C) + کاربر تازه‌ای که با شمارهٔ قدیمی A ساخته شد
try {
  const { readFileSync } = await import('node:fs');
  const { MongoClient } = await import('mongodb');
  const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const DB_URL = envText.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
  const phones = [phoneB, phoneC, phoneA];
  const client = new MongoClient(DB_URL);
  await client.connect();
  const db = client.db();
  const users = await db
    .collection('User')
    .find({ phone: { $in: phones } }, { projection: { _id: 1 } })
    .toArray();
  const ids = users.map((u) => u._id);
  if (ids.length) {
    const listIds = await db.collection('SavedList').distinct('_id', { user_id: { $in: ids } });
    const markIds = await db.collection('SavedUser').distinct('_id', { saved_list_id: { $in: listIds } });
    await db.collection('SavedUserNote').deleteMany({ saved_user_id: { $in: markIds } });
    await db.collection('SavedUser').deleteMany({ saved_list_id: { $in: listIds } });
    await db.collection('SavedUser').deleteMany({ target_user_id: { $in: ids } });
    await db.collection('SavedList').deleteMany({ user_id: { $in: ids } });
    await db.collection('RefreshToken').deleteMany({ user_id: { $in: ids } });
    await db.collection('User').deleteMany({ _id: { $in: ids } });
  }
  await client.close();
  console.log(`🧹 ${ids.length} کاربر تست پاک شد`);
} catch (e) {
  console.log('⚠️ پاک‌سازی خودکار نشد — دستی:', e.message);
}

process.exit(failures === 0 ? 0 : 1);
