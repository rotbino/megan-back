#!/usr/bin/env node
/**
 * seed داده‌های پایه در MongoDB Atlas — upsert (اجرای مکرر ایمن است).
 * `_id` هر سند همان عدد باسکول است (پسته=44، اصفهان=4) تا فرانت بدون تغییر سوییچ کند.
 * نکته: نام شهرها در API باسکول فاصله ابتدایی دارد → اینجا trim می‌شود.
 * اجرا: node scripts/seed-base-data.mjs   (یا bun run seed:base-data)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// override: در برخی محیط‌ها DATABASE_URL از قبل تعریف شده (مثل سندباکس) — .env باید برنده شود
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const DATA_DIR = join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

const readJson = (name) => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));

async function upsertAll(db, collection, docs, mapFn) {
  if (!docs.length) return 0;
  const ops = docs.map((d) => ({
    replaceOne: { filter: { _id: d.id }, replacement: mapFn(d), upsert: true },
  }));
  const res = await db.collection(collection).bulkWrite(ops, { ordered: false });
  return res.upsertedCount ?? 0;
}

async function main() {
  console.log('▶ اتصال به MongoDB Atlas…');
  const client = new MongoClient(DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db();

  // ── دسته‌ها ──
  const categories = readJson('categories.json');
  const catNew = await upsertAll(db, 'Category', categories, (c) => ({
    _id: c.id,
    category_name: (c.category_name ?? '').trim(),
    slug: (c.category_name ?? '').trim(), // اسلاگ فارسی مثل خود باسکول
    kind: 'CATEGORY',
    unit: c.unit ?? 'کیلوگرم',
    min: c.min ?? 100,
    example: c.example ?? null,
    parent_id: c.parent_id ?? null,
    score: c.score ?? 0,
  }));
  console.log(`✔ categories: ${categories.length} سند (${catNew} جدید)`);

  // ── استان‌ها ──
  const provinces = readJson('provinces.json');
  const provNew = await upsertAll(db, 'Province', provinces, (p) => ({
    _id: p.id,
    province_name: (p.province_name ?? '').trim(),
    province_en_name: p.province_en_name ?? null,
    country_id: p.country_id ?? 1,
    latitude: p.latitude != null ? Number(p.latitude) : null,
    longitude: p.longitude != null ? Number(p.longitude) : null,
  }));
  console.log(`✔ provinces: ${provinces.length} سند (${provNew} جدید)`);

  // ── شهرها (trim نام‌ها) ──
  const cities = readJson('cities.json');
  const cityNew = await upsertAll(db, 'City', cities, (c) => ({
    _id: c.id,
    province_id: c.province_id,
    city_name: (c.city_name ?? '').trim(),
    city_en_name: c.city_en_name ?? null,
    latitude: c.latitude != null ? Number(c.latitude) : null,
    longitude: c.longitude != null ? Number(c.longitude) : null,
  }));
  console.log(`✔ cities: ${cities.length} سند (${cityNew} جدید)`);

  await client.close();
  console.log('✅ seed داده‌های پایه کامل شد.');
}

main().catch((err) => {
  console.error('✖ خطای seed:', err.message);
  process.exit(1);
});
