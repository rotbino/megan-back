#!/usr/bin/env node
/** پاک‌سازی یک‌بارهٔ کاربران باقی‌مانده از دو اجرای اول تست setPassword */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const PHONES = [
  '09158031364', '09157095568', '09152880805', // اجرای اول
  '09156096671', '09153068365', '09155993794', // اجرای دوم
];

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const DB_URL = envText.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
const client = new MongoClient(DB_URL);
await client.connect();
const db = client.db();
const users = await db
  .collection('User')
  .find({ phone: { $in: PHONES } }, { projection: { _id: 1, phone: 1 } })
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
console.log(`🧹 ${ids.length} کاربر تست پاک شد:`, users.map((u) => u.phone).join(', '));
