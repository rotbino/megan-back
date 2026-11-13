#!/usr/bin/env node
/**
 * پرکردن آینهٔ لوکال برای فایل‌های موجود (خواستهٔ مالک ۱۳-۱۱).
 *
 * از ۱۳-۱۱ درایور ذخیره‌سازی هر بایت را هم‌زمان روی آروان «و» دیسک محلی
 * (فولدر uploads بک‌اند، همان مسیر/نام) می‌نویسد (MirroredStorage). این
 * اسکریپت یک‌بار برای فایل‌هایی که «قبل از» این قابلیت نوشته شده‌اند اجرا
 * می‌شود: همهٔ ردیف‌های جدول File که storageKey دارند را می‌گیرد و اگر نسخهٔ
 * لوکال‌شان نیست، از URL عمومی آروان دانلود و با همان کلید زیر UPLOAD_PATH
 * می‌نویسد (اصلی + تامبنیل).
 *
 *   node scripts/mirror-backfill.mjs --dry     # فقط گزارش، بدون نوشتن
 *   node scripts/mirror-backfill.mjs           # اجرای کامل
 *
 * idempotent — دوبار اجرا یعنی رد شدن از فایل‌هایی که الان هستند؛ ردیف DB
 * و آبجکت آروان دست نمی‌خورند (فقط خواندن + نوشتن روی دیسک خودمان).
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { effectiveDbUrl } from './lib/profile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DRY = process.argv.includes('--dry');

// ── .env (فقط UPLOAD_PATH لازم است — پیش‌فرض ./uploads) ─────────────────────
function readEnvFile(path) {
  const map = {};
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in map)) map[m[1]] = v;
  }
  return map;
}
const envMap = readEnvFile(join(root, '.env'));
const UPLOAD_PATH = envMap.UPLOAD_PATH || './uploads';

/** دانلود با چند تلاش — مسیر اینترنت به آروان می‌تواند لرزان باشد */
async function fetchBytes(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

const client = new MongoClient(effectiveDbUrl());
await client.connect();
const files = client.db().collection('File');

// فیلدها با @map در مونگو snake_case هستند (storage_key، thumb_url، …)
const query = { storage_key: { $exists: true, $ne: null } };
const total = await files.countDocuments(query);
console.log(`${total} ردیف File با storage_key — شروع${DRY ? ' (حالت خشک)' : ''}…`);

let copied = 0;
let skipped = 0;
let failed = 0;

for await (const doc of files.find(query)) {
  const targets = [
    { key: doc.storage_key, url: doc.url },
    doc.thumb_storage_key && doc.thumb_url ? { key: doc.thumb_storage_key, url: doc.thumb_url } : null,
  ].filter(Boolean);

  for (const t of targets) {
    if (t.key.includes('..')) {
      console.warn(`  ! کلید مشکوک رد شد: ${t.key}`);
      continue;
    }
    const dest = join(root, UPLOAD_PATH, t.key);
    if (existsSync(dest)) {
      skipped++;
      continue;
    }
    if (DRY) {
      console.log(`  [خشک] می‌نوشت: ${t.key}`);
      copied++;
      continue;
    }
    try {
      const bytes = await fetchBytes(t.url);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      copied++;
      if (copied % 10 === 0) console.log(`  … ${copied} فایل نوشته شد`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${t.key}: ${err.message}`);
    }
  }
}

await client.close();
console.log(`\nنتیجه: ${copied} کپی / ${skipped} از قبل موجود / ${failed} خطا`);
process.exit(failed > 0 && !DRY ? 1 : 0);
