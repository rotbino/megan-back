#!/usr/bin/env node
/**
 * مهاجرت واترمارک تصاویر موجود آگهی‌ها (خواسته مالک ۸-۱۱ دور ۲۷)
 *
 * تصاویر گالری محصولی که قبل از قابلیت واترمارکِ داخل-فایل ذخیره شده‌اند را
 * برمی‌دارد، همان الگوی قطری uploads.service را داخل پیکسل‌هایشان می‌نشاند و
 * با «کلید جدید» (پسوند -wm — کش immutable کلیدهای قدیمی را می‌بخشد) دوباره
 * ذخیره می‌کند؛ سپس ردیف File را به کلید/URL جدید می‌برد و metadata.watermarked
 * می‌زند (idempotent — دوبار اجرا = رد شدن از خوانده‌شده‌ها).
 *
 *   node scripts/watermark-product-images.mjs --dry     # فقط گزارش، بدون نوشتن
 *   node scripts/watermark-product-images.mjs            # اجرای کامل
 *   node scripts/watermark-product-images.mjs --limit 3 # فقط ۳ فایل اول
 *
 * اشیای قدیمی حذف نمی‌شوند (بهترین‌حال؛ عروسک دوره‌ای ادمین بعدها جمعشان
 * می‌کند) تا هیچ URL ذخیره‌شده‌ای ۴۰۴ نگیرد. کش محصولات سرور حداکثر ۶۰ثانیه
 * است و به‌طور طبیعی به URLهای جدید می‌رسد.
 */
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { effectiveDbUrl } from './lib/profile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sharp = (await import('sharp')).default;

const DRY = process.argv.includes('--dry');
const limitArg = Number((process.argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] || 0);
const LIMIT = process.argv.includes('--limit') && !limitArg ? 3 : limitArg;

// ─── .env (همان الگوی lib/profile.mjs — فقط ARVAN لازم است) ─────────────────
function readEnvFile(path) {
  const map = {};
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in map)) map[m[1]] = v;
  }
  return map;
}
const envMap = readEnvFile(join(root, '.env'));
const env = (k) => (k in envMap ? envMap[k] : process.env[k]);

// ─── S3 (عین src/uploads/storage.ts — ArvanStorage) ─────────────────────────
const ENDPOINT = env('ARVAN_ENDPOINT');
const BUCKET = env('ARVAN_BUCKET_NAME');
const s3url = new URL(ENDPOINT);
const bucketHosted = s3url.hostname.startsWith(`${BUCKET}.`);
const apiHost = bucketHosted ? s3url.hostname.slice(BUCKET.length + 1) : s3url.hostname;
const publicBase = bucketHosted
  ? `${s3url.protocol}//${s3url.hostname}`.replace(/\/$/, '')
  : `${s3url.protocol}//${s3url.hostname}/${BUCKET}`.replace(/\/+$/, '');
const s3 = new S3Client({
  endpoint: `${s3url.protocol}//${apiHost}`,
  region: env('ARVAN_REGION') || 'us-east-1',
  credentials: { accessKeyId: env('ARVAN_ACCESS_KEY'), secretAccessKey: env('ARVAN_SECRET_KEY') },
  forcePathStyle: true,
  requestHandler: { requestTimeout: 20_000, connectionTimeout: 8_000 },
  maxAttempts: 4,
});
async function put(key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${publicBase}/${key}`;
}

// ─── همان واترمارک uploads.service (ثابت‌ها و ساخت لایه) ────────────────────
const TILE_PNG = await readFile(join(root, 'assets', 'watermark-tile.png'));
const WM_TILE_W = 354;
const WM_TILE_H = 150;
const WM_OPACITY = 0.28;
const WM_ANGLE = -25;

async function watermarkLayer(w, h) {
  if (w < 160 || h < 120) return null;
  const tw = Math.max(76, Math.min(300, Math.round(w * 0.22)));
  const th = Math.round((tw * WM_TILE_H) / WM_TILE_W);
  const base = await sharp(TILE_PNG).resize(tw, th).png().toBuffer();
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">` +
      `<rect width="100%" height="100%" fill="#000" fill-opacity="${WM_OPACITY}"/></svg>`,
  );
  const tile = await sharp(base).composite([{ input: fade, blend: 'dest-in' }]).png().toBuffer();
  const cellW = Math.round(tw * 2);
  const cellH = Math.round(th * 2.5);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<defs><pattern id="wm" patternUnits="userSpaceOnUse" width="${cellW}" height="${cellH}" patternTransform="rotate(${WM_ANGLE})">` +
      `<image href="data:image/png;base64,${tile.toString('base64')}" x="0" y="0" width="${tw}" height="${th}"/>` +
      `</pattern></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#wm)"/></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function watermarkBytes(buffer) {
  const meta = await sharp(buffer).metadata();
  const layer = await watermarkLayer(meta.width, meta.height);
  if (!layer) return null;
  const isPng = meta.format === 'png';
  const out = await sharp(buffer)
    .composite([{ input: layer, left: 0, top: 0 }])
    .toFormat(isPng ? 'png' : 'jpeg', isPng ? { compressionLevel: 9 } : { quality: 88, mozjpeg: true })
    .toBuffer();
  return { out, width: meta.width, height: meta.height, mime: isPng ? 'image/png' : 'image/jpeg' };
}

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** کلید جدید = همان مسیر با پسوند -wm قبل از پسوند فایل (deterministic) */
function wmKey(key) {
  const i = key.lastIndexOf('.');
  return i > 0 ? `${key.slice(0, i)}-wm${key.slice(i)}` : `${key}-wm`;
}

// ─── اجرا ───────────────────────────────────────────────────────────────────
const client = new MongoClient(effectiveDbUrl());
await client.connect();
const files = client.db().collection('File');

const query = {
  related_model: 'Product',
  field_key: 'gallery',
  related_id: { $ne: null },
  'metadata.watermarked': { $ne: true },
};
const total = await files.countDocuments(query);
console.log(`تصاویر گالری محصول بدون واترمارک: ${total}${DRY ? ' (حالت خشک — فقط گزارش)' : ''}${LIMIT ? ` — سقف ${LIMIT}` : ''}`);

const docs = await files.find(query).sort({ created_at: 1 }).limit(LIMIT || 0).toArray();
let ok = 0;
let fail = 0;

for (const doc of docs) {
  const label = `${doc.related_id}/${(doc.storage_key || doc.url || '').slice(-42)}`;
  try {
    if (!doc.storage_key) throw new Error('بدون storage_key');
    const mainBytes = await fetchBytes(doc.url);
    const marked = await watermarkBytes(mainBytes);
    if (!marked) throw new Error('تصویر برای واترمارک کوچک/نامعتبر است');

    const newKey = wmKey(doc.storage_key);
    const newUrl = DRY ? `${publicBase}/${newKey}` : await put(newKey, marked.out, marked.mime);

    let newThumbUrl = null;
    if (doc.thumb_url && doc.thumb_storage_key) {
      const thumbBytes = await fetchBytes(doc.thumb_url);
      const markedThumb = await watermarkBytes(thumbBytes);
      if (markedThumb) {
        const newThumbKey = `${newKey}.thumb.jpg`;
        newThumbUrl = DRY ? `${publicBase}/${newThumbKey}` : await put(newThumbKey, markedThumb.out, 'image/jpeg');
      }
    }

    if (DRY) {
      console.log(`  [خشک] ${label} → ${newKey} (${mainBytes.length}→~${marked.out.length}B)`);
      ok++;
      continue;
    }

    await files.updateOne(
      { _id: doc._id },
      {
        $set: {
          url: newUrl,
          storage_key: newKey,
          ...(newThumbUrl ? { thumb_url: newThumbUrl, thumb_storage_key: `${newKey}.thumb.jpg` } : {}),
          size: marked.out.length,
          'metadata.watermarked': true,
          updated_at: new Date(),
        },
      },
    );
    console.log(`  ✓ ${label} → ${newKey} (${mainBytes.length}→${marked.out.length}B${newThumbUrl ? ' +thumb' : ''})`);
    ok++;
  } catch (err) {
    console.log(`  ✗ ${label}: ${err.message}`);
    fail++;
  }
}

console.log(`\nانجام‌شده: ${ok}، خطا: ${fail}، باقی: ${Math.max(0, total - ok - fail)}`);
await client.close();
