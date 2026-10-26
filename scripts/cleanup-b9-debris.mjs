#!/usr/bin/env node
/**
 * پاک‌سازی نخاله‌های آزمایشِ قدیمیِ کامیت‌نشدهٔ B9 —
 * یک سشن گم‌شده قبلاً با طراحی دیگری (کالکشن WalletTransaction جدا، پوشه charges/،
 * بدون package_key) شارژ/نردبان را تست کرده بود و سندهایش در Atlas مانده؛
 * با اسکیمای جدید B9 ناسازگارند و prisma.findMany را می‌شکنند.
 *
 * کارها:
 *  ۱) حذف بایت‌های فیش‌ها از آروان (storage_key + thumb) + ردیف‌های File
 *  ۲) drop کالکشن‌های ChargeOrder / LadderOrder / WalletTransaction
 *  ۳) صفر کردن wallet_balance همه کاربران (هیچ موجودی مشروعی هنوز وجود ندارد)
 *  ۴) حذف نرم آگهی‌های تستی «آگهی تست*»
 *
 * اجرا: node scripts/cleanup-b9-debris.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const DATABASE_URL = process.env.DATABASE_URL;
const {
  ARVAN_ENDPOINT, ARVAN_REGION, ARVAN_ACCESS_KEY, ARVAN_SECRET_KEY, ARVAN_BUCKET_NAME,
} = process.env;

const url = new URL(ARVAN_ENDPOINT);
const bucketHosted = url.hostname.startsWith(`${ARVAN_BUCKET_NAME}.`);
const apiHost = bucketHosted ? url.hostname.slice(ARVAN_BUCKET_NAME.length + 1) : url.hostname;
const s3 = new S3Client({
  endpoint: `${url.protocol}//${apiHost}`,
  region: ARVAN_REGION || 'us-east-1',
  credentials: { accessKeyId: ARVAN_ACCESS_KEY, secretAccessKey: ARVAN_SECRET_KEY },
  forcePathStyle: true,
});

const client = new MongoClient(DATABASE_URL);
await client.connect();
const db = client.db();

// ۱) فایل‌های فیش (قدیمی charges/ + جدید charge-orders/) — بایت + ردیف
const files = await db.collection('File').find({ related_model: 'ChargeOrder' }).toArray();
console.log(`فایل‌های فیش: ${files.length}`);
for (const f of files) {
  for (const key of [f.storage_key, f.thumb_storage_key].filter(Boolean)) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: ARVAN_BUCKET_NAME, Key: key }));
    } catch (err) {
      console.warn(`  ⚠ حذف آرمان ناموفق: ${key} — ${err.message}`);
    }
  }
}
const delFiles = await db.collection('File').deleteMany({ related_model: 'ChargeOrder' });
console.log(`ردیف‌های File حذف شد: ${delFiles.deletedCount}`);

// ۲) کالکشن‌های آزمایش قدیمی
for (const name of ['ChargeOrder', 'LadderOrder', 'WalletTransaction']) {
  const dropped = await db.collection(name).drop().catch(() => false);
  console.log(`کالکشن ${name}: ${dropped ? 'drop شد' : 'وجود نداشت'}`);
}

// ۳) موجودی‌ها — هیچ موجودی مشروعی هنوز وجود ندارد (B9 تازه متولد می‌شود)
const reset = await db.collection('User').updateMany(
  { wallet_balance: { $gt: 0 } },
  { $set: { wallet_balance: 0, updated_at: new Date() } },
);
console.log(`کاربرانی که موجودی‌شان صفر شد: ${reset.modifiedCount}`);

// ۴) آگهی‌های تستی — حذف نرم (عین deleteMyProduct)
const softDel = await db.collection('Product').updateMany(
  { product_name: /^آگهی تست/, status: { $ne: 'deleted' } },
  { $set: { status: 'deleted', is_ladder: false, updated_at: new Date() } },
);
console.log(`آگهی‌های تستی حذف نرم شد: ${softDel.modifiedCount}`);

// نردبان فعال مانده روی آگهی‌های غیرحذفی؟ (باید هیچ نباشد)
const stillLaddered = await db.collection('Product').countDocuments({ is_ladder: true });
console.log(`آگهی با نردبان فعال (باید ۰ باشد): ${stillLaddered}`);

await client.close();
console.log('✅ پاک‌سازی کامل شد');
