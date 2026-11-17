// ترمیم ردیف‌های «تعویض‌شدهٔ قدیمی» (رفع ۱۷-۱۱ — «سایت هنوز واترمارک دارد»)
//
// پس‌زمینه: تعویض تصویر آگهی (replaceInPlace) تا ۱۷-۱۱ بایت‌های تازه را روی
// «همان کلید» ابری می‌نوشت؛ اما کلیدها با Cache-Control: immutable (یک‌ساله)
// سرو می‌شوند ⇒ مرورگر/CDN آروان/بهینه‌ساز next/image نسخهٔ قدیمی
// (واترمارک‌دار) را تا یک سال زنده نگه می‌داشتند. فیکس سرویس از این به بعد
// کلید نسخه‌دار تازه می‌سازد؛ این اسکریپت ردیف‌هایی که «قبلاً» تعویض شده‌اند
// و هنوز روی کلید قدیمی‌اند را به همان الگو منتقل می‌کند:
//
//   بایت‌های فعلیِ تمیز را از URL عمومی می‌گیرد → در کلید تازهٔ
//   «name.r<epoch-ms>.ext» با هدر immutable می‌نویسد (هم main هم thumb) →
//   ردیف File را به کلیدهای تازه به‌روز می‌کند (metadata.replacedFromKey =
//   کلید قدیمی) → کلیدهای قدیمی را حذف می‌کند. URL جدید ⇒ کش‌ها فوری
//   می‌شکنند.
//
// فقط ردیف‌هایی با metadata.replacedAt که کلیدشان هنوز نسخه‌دار نشده
// (الگوی «.r<digits>.» قبل از پسوند ندارد) — پس اجرای مکرر بی‌اثر است.
//
//   node scripts/rekey-replaced-images.mjs            # dry-run (پیش‌فرض)
//   node scripts/rekey-replaced-images.mjs --apply    # اجرای واقعی
//   node scripts/rekey-replaced-images.mjs --apply --limit=3
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { effectiveDbUrl } from './lib/profile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const APPLY = process.argv.includes('--apply');
const limitArg = Number((process.argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] || 0);
const LIMIT = process.argv.includes('--limit') && !limitArg ? 3 : limitArg;

// ─── .env (همان الگوی lib/profile.mjs — فقط ARVAN لازم است) ─────────────────
function readEnvFile(path) {
  const map = {};
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
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
const env = (k) => (k in envMap ? envMap[k] : process.env[k]);

// ─── S3 (عین src/uploads/storage.ts — ArvanStorage) ─────────────────────────
const ENDPOINT = env('ARVAN_ENDPOINT');
const BUCKET = env('ARVAN_BUCKET_NAME');
if (!ENDPOINT || !BUCKET) {
  console.error('ARVAN_ENDPOINT / ARVAN_BUCKET_NAME تنظیم نشده‌اند (.env)');
  process.exit(1);
}
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
async function del(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── کلید نسخه‌دار — عین UploadsService.versionedKey ────────────────────────
function versionedKey(key) {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  if (dot > slash) return `${key.slice(0, dot)}.r${Date.now()}.${key.slice(dot + 1)}`;
  return `${key}.r${Date.now()}`;
}
/** کلید از قبل نسخه‌دار است؟ «.r<digits>.» چسبیده به نام، قبل از پسوند */
const isVersioned = (key) => /\.r\d+\.[A-Za-z0-9]+$/.test(key);

// ─── اجرا ───────────────────────────────────────────────────────────────────
const client = new MongoClient(effectiveDbUrl());
await client.connect();
const files = client.db().collection('File');

const query = {
  related_model: 'Product',
  field_key: 'gallery',
  'metadata.replacedAt': { $ne: null },
  storage_key: { $ne: null },
};
const total = await files.countDocuments(query);
console.log(`ردیف‌های تعویض‌شدهٔ گالری: ${total}${APPLY ? '' : ' (dry-run — بدون --apply چیزی تغییر نمی‌کند)'}${LIMIT ? ` — سقف ${LIMIT}` : ''}`);

const docs = await files.find(query).sort({ updated_at: 1 }).limit(LIMIT || 0).toArray();
let migrated = 0;
let skipped = 0;
let failed = 0;

for (const doc of docs) {
  const label = `${doc.related_id}/${(doc.storage_key || '').slice(-46)}`;
  try {
    if (!doc.storage_key) throw new Error('بدون storage_key');
    if (isVersioned(doc.storage_key)) {
      console.log(`  · ${label} — از قبل نسخه‌دار است، رد شد`);
      skipped++;
      continue;
    }

    const oldMainKey = doc.storage_key;
    const oldThumbKey = doc.thumb_storage_key ?? null;
    const mainBytes = await fetchBytes(doc.url);
    const newKey = versionedKey(oldMainKey);
    const newUrl = APPLY ? await put(newKey, mainBytes, doc.mime_type || 'image/jpeg') : `${publicBase}/${newKey}`;

    let newThumbUrl = null;
    let newThumbKey = null;
    if (doc.thumb_url) {
      const thumbBytes = await fetchBytes(doc.thumb_url);
      newThumbKey = `${newKey}.thumb.jpg`;
      newThumbUrl = APPLY
        ? await put(newThumbKey, thumbBytes, 'image/jpeg')
        : `${publicBase}/${newThumbKey}`;
    }

    if (APPLY) {
      await files.updateOne(
        { _id: new ObjectId(doc._id) },
        {
          $set: {
            url: newUrl,
            storage_key: newKey,
            ...(newThumbUrl ? { thumb_url: newThumbUrl, thumb_storage_key: newThumbKey } : {}),
            'metadata.replacedFromKey': oldMainKey,
            updated_at: new Date(),
          },
        },
      );
      // بایت‌های تازه + DB امن شدند — کلیدهای قدیمی را بهترین‌حال حذف کن
      await del(oldMainKey).catch(() => {});
      if (oldThumbKey && oldThumbKey !== newThumbKey) await del(oldThumbKey).catch(() => {});
    }
    console.log(`  ${APPLY ? '✓' : '[خشک]'} ${label} → ${newKey.split('/').pop()} (${mainBytes.length}B${newThumbUrl ? ' +thumb' : ''})`);
    migrated++;
  } catch (err) {
    console.log(`  ✗ ${label}: ${err.message}`);
    failed++;
  }
}

console.log(`\nنتایج: منتقل‌شده ${migrated}، ردشده ${skipped}، خطا ${failed}`);
if (!APPLY && migrated > 0) console.log('برای اجرای واقعی: node scripts/rekey-replaced-images.mjs --apply');
await client.close();
