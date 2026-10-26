#!/usr/bin/env node
/**
 * ارتقای یک کاربر به ADMIN — بوت‌استرپ دستی ادمین:
 *   node scripts/make-admin.mjs 09350001122
 * (کاربر باید یک‌بار با OTP وارد شده باشد تا ردیفش ساخته شده باشد)
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const phone = process.argv[2];
if (!phone || !/^09\d{9}$/.test(phone)) {
  console.error('استفاده: node scripts/make-admin.mjs 09xxxxxxxxx');
  process.exit(1);
}

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
if (!url) {
  console.error('DATABASE_URL در .env یافت نشد');
  process.exit(1);
}

const client = new MongoClient(url);
await client.connect();
const db = client.db();

// کالکشن‌های Prisma نام مدل هستند (User) — snake_case فقط روی فیلدهاست
const res = await db.collection('User').updateOne(
  { phone },
  { $set: { role: 'ADMIN', updated_at: new Date() } },
);
if (res.matchedCount === 0) {
  console.error(`کاربر ${phone} یافت نشد — ابتدا یک‌بار با OTP واردش شوید.`);
  process.exit(1);
}
console.log(`✅ ${phone} → ADMIN`);
await client.close();
