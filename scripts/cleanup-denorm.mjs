#!/usr/bin/env node
/**
 * پاک‌سازی فیلدهای denorm قدیمی از سندهای موجود Atlas —
 * پس از اصلاح ساختار داده (رابطه یک‌به‌چند User↔Product فقط با user_id؛
 * نام فروشنده/خریدار/دسته/مکان دیگر در رکوردها ذخیره نمی‌شوند و join می‌شوند).
 *
 * اجرا: node scripts/cleanup-denorm.mjs
 * idempotent است — اجرای چندباره بی‌ضرر است.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

const PRODUCT_DENORM = [
  'category_name', 'sub_category_name', 'province_name', 'city_name',
  'seller_user_name', 'seller_first_name', 'seller_last_name', 'seller_is_verified',
];
const BUY_REQUEST_DENORM = [
  'category_name', 'province_name', 'city_name',
  'buyer_first_name', 'buyer_last_name', 'buyer_is_verified',
];

const client = new MongoClient(DATABASE_URL);
await client.connect();
const db = client.db();

const unset = (fields) => Object.fromEntries(fields.map((f) => [f, '']));

const pRes = await db.collection('Product').updateMany({}, { $unset: unset(PRODUCT_DENORM) });
console.log(`✔ Product: ${pRes.modifiedCount} سند پاک‌سازی شد (${PRODUCT_DENORM.join(', ')})`);

const bRes = await db.collection('BuyRequest').updateMany({}, { $unset: unset(BUY_REQUEST_DENORM) });
console.log(`✔ BuyRequest: ${bRes.modifiedCount} سند پاک‌سازی شد (${BUY_REQUEST_DENORM.join(', ')})`);

// مکان‌های بدون is_active → فعال (پیش‌فرض اسکیمای جدید)
const lRes = await db.collection('Location').updateMany(
  { is_active: { $exists: false } },
  { $set: { is_active: true } },
);
console.log(`✔ Location: ${lRes.modifiedCount} سند is_active=true شد`);

await client.close();
console.log('✅ پاک‌سازی denorm کامل شد — داده اکنون کاملاً نرمال است.');
process.exit(0);
