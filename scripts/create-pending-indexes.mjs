#!/usr/bin/env node
/**
 * بررسی/ساخت ایندکس‌های PendingImportUser روی Atlas (۲۲-۱۱).
 * prisma db push روی drift نامرتبط User (referral_code با nullهای تکراری)
 * می‌افتد؛ ایندکس‌های مدل جدید را مستقیم با درایور رسمی می‌سازیم —
 * همان الگوی تسک ۲۸ (createIndexes مستقیم).
 *
 * اجرا: node scripts/mongotool/../create-pending-indexes.mjs
 * idempotent — ایندکس هم‌نام موجود خطا نمی‌دهد.
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const root = new URL('../', import.meta.url).pathname;
dotenv.config({ path: `${root}.env`, override: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✖ DATABASE_URL نیست');
  process.exit(1);
}

const client = new MongoClient(url, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db();

// ۱) کالکشن — createCollection روی موجود بودن خطا می‌دهد، عمداً نادیده
try {
  await db.createCollection('PendingImportUser');
  console.log('✓ کالکشن PendingImportUser ساخته شد');
} catch (e) {
  if (String(e.code) === '48') console.log('• کالکشن از قبل هست');
  else throw e;
}

// ۲) ایندکس‌ها — هم‌نامِ موجود: بدون خطا (idempotent)
const cols = await db.collection('PendingImportUser').listIndexes().toArray();
console.log('ایندکس‌های فعلی:', cols.map((i) => i.name).join(', '));

await db.collection('PendingImportUser').createIndex(
  { b_user_id: 1 },
  { unique: true, name: 'PendingImportUser_b_user_id_key' },
);
console.log('✓ unique b_user_id');

await db.collection('PendingImportUser').createIndex(
  { b_created_at: -1 },
  { name: 'PendingImportUser_b_created_at_idx' },
);
console.log('✓ b_created_at desc');

const after = await db.collection('PendingImportUser').listIndexes().toArray();
console.log('نهایی:', after.map((i) => `${i.name}${i.unique ? ' (unique)' : ''}`).join(', '));
await client.close();
