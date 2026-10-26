#!/usr/bin/env node
/**
 * seed درخواست‌های خرید واقعی باسکول در MongoDB Atlas (B7):
 *  • خریداران واقعی (myuser_id باسکول → کاربر مگان با user_name یکتا)
 *  • ۶۰ درخواست واقعی (id باسکول، status=confirmed — همان‌هایی که در باسکول زنده‌اند)
 *  • نگاشت نام شهر → City ما (نام شهر در باسکول بدون استان؛ اولین تطبیق)
 *  • Counter درخواست خرید روی max(id)+1000
 *
 * اجرا: node scripts/seed-buy-requests.mjs  (idempotent — upsert)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const SOURCE = '/home/z/my-project/scripts/buskool-data/buyads.json';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

const client = new MongoClient(DATABASE_URL);
await client.connect();
const db = client.db();

// ── نقشه شهرها (نام → City با استان) ────────────────────────────────────────
const buyads = JSON.parse(readFileSync(SOURCE, 'utf8'));
const cityNames = [...new Set(buyads.map((b) => b.city).filter(Boolean))];
const cityRows = await db
  .collection('City')
  .find({ city_name: { $in: cityNames } })
  .project({ city_name: 1, province_id: 1 })
  .toArray();
// نام تکراری بین استان‌ها → اولین استان (دقت seed کافی است)
const cityByName = new Map();
for (const row of cityRows) {
  if (!cityByName.has(row.city_name)) cityByName.set(row.city_name, row);
}
const provinceIds = [...new Set(cityRows.map((r) => r.province_id))];
const provinceRows = await db
  .collection('Province')
  .find({ _id: { $in: provinceIds } })
  .project({ province_name: 1 })
  .toArray();
const provinceName = new Map(provinceRows.map((p) => [p._id, p.province_name]));

// ── نام دسته‌ها برای denorm ────────────────────────────────────────────────
const categoryIds = [...new Set(buyads.map((b) => b.category_id))];
const categoryRows = await db
  .collection('Category')
  .find({ _id: { $in: categoryIds } })
  .project({ category_name: 1 })
  .toArray();
const categoryName = new Map(categoryRows.map((c) => [c._id, c.category_name]));

// ── خریداران: upsert با user_name یکتا ─────────────────────────────────────
const usersById = new Map(); // buskool myuser_id → ObjectId
const seenNames = new Set();
let userUpserts = 0;
for (const b of buyads) {
  if (usersById.has(b.myuser_id)) continue;
  const userName = `bk${b.myuser_id}`;
  if (seenNames.has(userName)) continue;
  seenNames.add(userName);

  const filter = { user_name: userName };
  const update = {
    $set: {
      user_name: userName,
      first_name: b.first_name ?? '',
      last_name: b.last_name ?? '',
      is_verified: !!b.is_verified,
      is_buyer: true,
      updated_at: new Date(),
    },
    $setOnInsert: {
      phone: `0990${String(1_000_000 + b.myuser_id).slice(-7)}`, // ساختگی یکتا
      role: 'USER',
      is_seller: false,
      wallet_balance: 0,
      created_at: new Date(),
    },
  };
  const res = await db.collection('User').updateOne(filter, update, { upsert: true });
  const doc = await db.collection('User').findOne(filter, { projection: { _id: 1 } });
  usersById.set(b.myuser_id, doc._id); // ObjectId واقعی
  userUpserts += res.upsertedCount ? 1 : 0;
}
console.log(`✔ buyers: ${usersById.size} کاربر (${userUpserts} جدید)`);

// ── درخواست‌ها: upsert با id باسکول ─────────────────────────────────────────
let inserted = 0;
for (const b of buyads) {
  const city = b.city ? cityByName.get(b.city) : null;
  const cat = categoryName.get(b.category_id) ?? '';
  const doc = {
    _id: b.id,
    name: b.name ?? null,
    description: null,
    category_id: b.category_id,
    product_type_id: null,
    requirement_amount: b.requirement_amount,
    unit: b.unit ?? 'کیلوگرم',
    province_id: city?.province_id ?? null,
    city_id: city?._id ?? null,
    goal: 'price_and_buy',
    has_history: false,
    status: 'confirmed', // روی باسکول زنده است
    rejection_reason: null,
    user_id: usersById.get(b.myuser_id),
    category_name: cat,
    province_name: city ? provinceName.get(city.province_id) ?? null : null,
    city_name: b.city ?? null,
    buyer_first_name: b.first_name ?? '',
    buyer_last_name: b.last_name ?? '',
    buyer_is_verified: !!b.is_verified,
    created_at: new Date(b.created_at?.replace(' ', 'T') ?? Date.now()),
    updated_at: new Date(b.updated_at?.replace(' ', 'T') ?? Date.now()),
  };
  const res = await db.collection('BuyRequest').updateOne({ _id: b.id }, { $set: doc }, { upsert: true });
  inserted += res.upsertedCount ? 1 : 0;
}
console.log(`✔ buy requests: ${buyads.length} (${inserted} جدید)`);

// ── Counter: شروع id های جدید بالاتر از max باسکول ─────────────────────────
const maxId = Math.max(...buyads.map((b) => b.id));
await db.collection('Counter').updateOne(
  { _id: 'buy_request' },
  { $setOnInsert: { seq: maxId + 1000 } },
  { upsert: true },
);
console.log(`✔ Counter buy_request → ${maxId + 1000}+`);

await client.close();
console.log('✅ seed-buy-requests تمام');
