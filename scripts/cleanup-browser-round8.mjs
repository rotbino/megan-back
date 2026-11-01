#!/usr/bin/env node
/** پاک‌سازی نهایی تست مرورگر دور هشتم:
 *  • حساب تست اصلی 09150000002 که در تست شماره‌اش 09150000066 شد و رمز گرفت
 *    → بازگرداندن شماره + حذف رمز (کاربر مالک با همین شماره بدون رمز تست می‌کند)
 *  • حذف حساب رمزدار 09150000077 (هدف خطای تست) */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const DB_URL = envText.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
const client = new MongoClient(DB_URL);
await client.connect();
const db = client.db();

// ۱) بازیابی حساب اصلی
const main = await db.collection('User').findOneAndUpdate(
  { phone: '09150000066' },
  { $set: { phone: '09150000002', password_hash: null, sessions_revoked_at: null } },
  { returnDocument: 'after', projection: { _id: 1, phone: 1, password_hash: 1 } },
);
console.log('حساب اصلی بازیابی شد:', main?.phone, '| رمز:', main?.password_hash === null ? 'حذف شد' : '؟');

// ۲) حذف حساب رمزدار تست
const b = await db.collection('User').findOne({ phone: '09150000077' });
if (b) {
  await db.collection('RefreshToken').deleteMany({ user_id: b._id });
  await db.collection('User').deleteOne({ _id: b._id });
  console.log('09150000077 حذف شد');
}

// ۳) توکن‌های نشست بازیابی‌شده هم پاک باشند
if (main?._id) await db.collection('RefreshToken').deleteMany({ user_id: main._id });

await client.close();
