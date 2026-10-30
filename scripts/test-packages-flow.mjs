#!/usr/bin/env node
/**
 * تست E2E کامل بسته اشتراک:
 *  ۱) کاربر آزاد → وضعیت رایگان (۱۰ محصول، بدون خریداران)
 *  ۲) ثبت سفارش بسته (multipart: planKey + فیش) → pending
 *  ۳) ادمین موقت → reviewPackageOrder تأیید → بسته فعال
 *  ۴) کاربر → pakageType=۱، canSeeBuyers=true، capacity=-۱ (نامحدود)
 *  ۵) پاک‌سازی کامل: سفارش + بسته کاربر + ادمین موقت حذف
 *
 * اجرا: node scripts/test-packages-flow.mjs
 */
import { readFileSync } from 'node:fs';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000/api/v1';
const PHONE = process.env.TEST_PHONE || '09120000001';
const TMP_ADMIN = `pkg_test_${Date.now()}`;
const TMP_ADMIN_PASS = randomBytes(9).toString('base64url');

const scryptAsync = promisify(scrypt);
async function hashPassword(plain) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function loginSession(phone) {
  const s = await post('auth/sendOtp', { phone });
  const code = s.json?.data?.devCode;
  const v = await post('auth/verifyOtp', { phone, code });
  return v.json?.data?.accessToken;
}

/** فیش ساختگی — JPEG نویزدار ۶۰۰×۴۰۰ (بزرگ‌تر از کف ۴KB) */
async function makeReceipt() {
  const sharp = (await import('sharp')).default;
  const noise = Buffer.alloc(600 * 400 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  return sharp(noise, { raw: { width: 600, height: 400, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function db() {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const url = env.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
  const client = new MongoClient(url);
  await client.connect();
  return { client, d: client.db() };
}

(async () => {
  console.log('— ۱) وضعیت اولیه (رایگان) —');
  const token = await loginSession(PHONE);
  check('لاگین کاربر', Boolean(token));

  let mine = await post('packages/getMyPackage', {}, token);
  check('رایگان: pakageType=0', mine.json?.data?.pakageType === 0);
  check('رایگان: ظرفیت ۱۰', mine.json?.data?.features?.productCapacity === 10);

  console.log('— ۲) ثبت سفارش بسته با فیش —');
  const receipt = await makeReceipt();
  check('فیش ساختگی > ۵KB', receipt.length > 4096, `${receipt.length}B`);
  const form = new FormData();
  form.append('planKey', 'p2m');
  form.append('receipt', new Blob([receipt], { type: 'image/jpeg' }), 'receipt.jpg');
  const orderRes = await fetch(`${BASE}/packages/createPackageOrder`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const orderJson = await orderRes.json().catch(() => null);
  check('سفارش ثبت شد (pending)', orderJson?.status === true && orderJson?.data?.status === 'pending', orderJson?.message ?? '');
  const orderId = orderJson?.data?.orderId;

  const orders = await post('packages/getMyPackageOrders', {}, token);
  check('سفارش در تاریخچه', (orders.json?.data?.items ?? []).some((o) => o.id === orderId));

  console.log('— ۳) ادمین موقت: تأیید سفارش —');
  const { client, d } = await db();
  await d.collection('AdminUser').insertOne({
    username: TMP_ADMIN,
    password_hash: await hashPassword(TMP_ADMIN_PASS),
    name: 'تست موقت بسته‌ها',
    role: 'SUPER_ADMIN',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const adminLogin = await post('admin/auth/login', { username: TMP_ADMIN, password: TMP_ADMIN_PASS });
  const adminToken = adminLogin.json?.data?.token;
  check('لاگین ادمین موقت', Boolean(adminToken), adminLogin.json?.message ?? '');

  const review = await post('admin/packages/reviewPackageOrder', { orderId, approve: true }, adminToken);
  check('تأیید و فعال‌سازی', review.json?.status === true, review.json?.message ?? '');

  console.log('— ۴) وضعیت پس از تأیید (بسته فعال) —');
  mine = await post('packages/getMyPackage', {}, token);
  check('pakageType=1 (دوماهه)', mine.json?.data?.pakageType === 1, String(mine.json?.data?.pakageType));
  check('canSeeBuyers=true', mine.json?.data?.features?.canSeeBuyers === true);
  check('capacity=-۱ (نامحدود)', mine.json?.data?.features?.productCapacity === -1);
  check('daysLeft ~۶۰', Math.abs((mine.json?.data?.daysLeft ?? 0) - 60) <= 1, String(mine.json?.data?.daysLeft));

  const products = await post('products/getMyProducts', {}, token);
  check('getMyProducts capacity=-۱', products.json?.data?.capacity === -1, String(products.json?.data?.capacity));

  const approved = await post('admin/packages/getPackageOrders', { status: 'approved' }, adminToken);
  check('ردیف در صف تأییدشده‌ها', (approved.json?.data?.items ?? []).some((o) => o.id === orderId));

  console.log('— ۵) دوبار بررسی = خطا —');
  const again = await post('admin/packages/reviewPackageOrder', { orderId, approve: true }, adminToken);
  check('بررسی مجدد رد می‌شود (409)', again.status === 409, String(again.status));

  console.log('— ۶) پاک‌سازی کامل —');
  const u = await d.collection('User').findOne({ phone: PHONE });
  if (u) {
    await d.collection('User').updateOne({ _id: u._id }, { $set: { active_pakage_type: 0, package_expires_at: null, updated_at: new Date() } });
    await d.collection('PackageOrder').deleteMany({ user_id: u._id, plan_key: 'p2m' });
    await d.collection('File').deleteMany({ related_model: 'PackageOrder' });
    console.log('  🧹 کاربر تست → رایگان؛ سفارش و فیش تست پاک شد');
  }
  await d.collection('AdminUser').deleteOne({ username: TMP_ADMIN });
  console.log('  🧹 ادمین موقت حذف شد');
  await client.close();

  console.log(`\n${fail === 0 ? '🎉 همه پاس شدند' : '⚠️ ناموفق: ' + fail} (${pass} موفق)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
