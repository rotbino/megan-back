#!/usr/bin/env node
/**
 * مهاجرت یک‌بارهٔ نام‌ها روی دیتابیس (بعد از تغییر نام پاسکال) — idempotent.
 * اجرا:  node scripts/rename-to-pascal.mjs   (یا: bun run rename:pascal)
 *
 * کاری که می‌کند (هیچ داده‌ای حذف نمی‌شود — فقط نام‌ها عوض می‌شوند):
 *   ۱) کالکشن منبع:               user-buskool → user-pascal
 *   ۲) User.import_source:          'buskool' → 'pascal'
 *   ۳) User/Product.d.source:       'buskool' → 'pascal'
 *   ۴) File.metadata.importedFrom:  'buskool' → 'pascal' و 'buskool-failed' → 'pascal-failed'
 *   ۵) Location: فیلد buskool_id → pascal_id
 *
 * فقط یک‌بار بعد از این کامیت لازم است؛ اجرای مکرر بی‌ضرر است.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { applyProfile } from './lib/profile.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });
applyProfile();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

async function renameCollection(db, from, to) {
  const names = await db.listCollections({ name: from }).toArray();
  if (!names.length) {
    console.log(`• کالکشن «${from}» وجود ندارد (احتمالاً قبلاً تغییر نام یافته) — رد شد`);
    return;
  }
  const toExists = (await db.listCollections({ name: to }).toArray()).length > 0;
  if (toExists) {
    console.log(`• کالکشن «${to}» از قبل هست — «${from}» دست‌نخورده ماند (بررسی دستی توصیه می‌شود)`);
    return;
  }
  await db.collection(from).rename(to);
  console.log(`✓ کالکشن «${from}» → «${to}»`);
}

async function updateMany(db, coll, filter, update, label) {
  const res = await db.collection(coll).updateMany(filter, update);
  console.log(`✓ ${coll}: ${label} — ${res.modifiedCount} سند`);
}

async function main() {
  console.log('▶ اتصال به دیتابیس…');
  const client = new MongoClient(DATABASE_URL, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  try {
    const db = client.db();

    // ۱) کالکشن منبع ایمپورت
    await renameCollection(db, 'user-buskool', 'user-pascal');

    // ۲) User.import_source
    await updateMany(db, 'User', { import_source: 'buskool' },
      { $set: { import_source: 'pascal' } }, "import_source: 'buskool' → 'pascal'");

    // ۳) d.source (JSON منبع روی User و Product)
    for (const coll of ['User', 'Product']) {
      await updateMany(db, coll, { 'd.source': 'buskool' },
        { $set: { 'd.source': 'pascal' } }, "d.source: 'buskool' → 'pascal'");
    }

    // ۴) File.metadata.importedFrom
    await updateMany(db, 'File', { 'metadata.importedFrom': 'buskool' },
      { $set: { 'metadata.importedFrom': 'pascal' } }, "importedFrom: 'buskool' → 'pascal'");
    await updateMany(db, 'File', { 'metadata.importedFrom': 'buskool-failed' },
      { $set: { 'metadata.importedFrom': 'pascal-failed' } }, "importedFrom: 'buskool-failed' → 'pascal-failed'");

    // ۵) Location: buskool_id → pascal_id
    await updateMany(db, 'Location', { buskool_id: { $exists: true } },
      { $rename: { buskool_id: 'pascal_id' } }, 'فیلد buskool_id → pascal_id');

    console.log('✔ تمام شد — دیتابیس با کد فعلی هم‌نام است.');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('✖ خطا:', e.message);
  process.exit(1);
});
