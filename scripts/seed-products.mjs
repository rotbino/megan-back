#!/usr/bin/env node
/**
 * seed محصولات واقعی باسکول در MongoDB Atlas:
 *  • ۲۶ فروشنده واقعی (user_name/نام/احراز) → کالکشن User (شماره موبایل ساختگی یکتا)
 *  • ۶۰ آگهی واقعی → کالکشن Product (همان id عددی باسکول، فیلدهای snake_case)
 *  • عکس‌ها از CDN باسکول دانلود → پاین‌لاین sharp (اصلی ۱۶۰۰ + تامبنیل ۴۰۰)
 *    → آپلود به باکت آروان ما → ردیف File (relatedModel=Product, fieldKey=gallery)
 *  • Counter محصول روی max(id)+1000 ست می‌شود
 *
 * اجرا: node scripts/seed-products.mjs [--skip-photos]
 *   --skip-photos → عکس‌ها همان URL باسکول می‌مانند (بدون rehost)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const SKIP_PHOTOS = process.argv.includes('--skip-photos');
const SOURCE = '/home/z/my-project/scripts/buskool-data/products.json';

const DATABASE_URL = process.env.DATABASE_URL;
const {
  ARVAN_ENDPOINT, ARVAN_REGION, ARVAN_ACCESS_KEY, ARVAN_SECRET_KEY, ARVAN_BUCKET_NAME,
} = process.env;
if (!DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

// ─── درایور آروان (مثل src/uploads/storage.ts) ───────────────────────────────
const url = new URL(ARVAN_ENDPOINT);
const bucketHosted = url.hostname.startsWith(`${ARVAN_BUCKET_NAME}.`);
const apiHost = bucketHosted ? url.hostname.slice(ARVAN_BUCKET_NAME.length + 1) : url.hostname;
const publicBase = bucketHosted
  ? `${url.protocol}//${url.hostname}`
  : `${url.protocol}//${url.hostname}/${ARVAN_BUCKET_NAME}`;
const s3 = new S3Client({
  endpoint: `${url.protocol}//${apiHost}`,
  region: ARVAN_REGION || 'us-east-1',
  credentials: { accessKeyId: ARVAN_ACCESS_KEY, secretAccessKey: ARVAN_SECRET_KEY },
  forcePathStyle: true,
});

const sharp = async () => (await import('sharp')).default;

/** پاین‌لاین تصویر: اصلی ۱۶۰۰ + تامبنیل ۴۰۰ (عین سرویس uploads) */
async function processImage(buffer) {
  try {
    const sh = await sharp();
    const hasAlpha = !!(await sh(buffer).metadata()).hasAlpha;
    const main = await sh(buffer).rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .toFormat(hasAlpha ? 'png' : 'jpeg', hasAlpha ? { compressionLevel: 9 } : { quality: 82, mozjpeg: true })
      .toBuffer();
    const thumb = await sh(buffer).rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .toFormat('jpeg', { quality: 78, mozjpeg: true })
      .toBuffer();
    return { main, thumb, mime: hasAlpha ? 'image/png' : 'image/jpeg', ext: hasAlpha ? 'png' : 'jpg' };
  } catch {
    return null; // تصویر خراب — رد می‌شود
  }
}

async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: ARVAN_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${publicBase}/${key}`;
}

/** دانلود امن از URL (SSRF-گارد ساده مثل ingestUrl) — اعتبارسنجی نهایی با امضای بایت‌ها */
async function fetchImage(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || /^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return null;
    const res = await fetch(u.toString(), {
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': 'Megan-seed/1.0', accept: 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    // CDN باسکول «binary/octet-stream» می‌فرستد — نوع واقعی را امضای بایت‌ها می‌گوید
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/') && !mime.startsWith('binary/') && !mime.startsWith('application/octet-stream')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    // امضای واقعی تصویر؟ (jpeg/png/webp/gif)
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e;
    const isWebp = buf.slice(8, 12).toString('ascii') === 'WEBP';
    const isGif = buf.slice(0, 3).toString('ascii') === 'GIF';
    if (!isJpeg && !isPng && !isWebp && !isGif) return null;
    const realMime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/gif';
    return { buf, mime: realMime };
  } catch {
    return null;
  }
}

/** شماره موبایل ساختگی یکتا برای فروشندگان seed — «09» + ۹ رقم از id */
const fakePhone = (id) => `09${String(100000000 + id).slice(-9)}`;

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`✖ فایل داده باسکول پیدا نشد: ${SOURCE}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));

  console.log('▶ اتصال به MongoDB Atlas…');
  const client = new MongoClient(DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db();

  // ── ۱. فروشنده‌ها (upsert با user_name یکتا) ─────────────────────────────
  const usersById = new Map(); // buskool user id → ObjectId مگان (نه رشته!)
  const seenUserNames = new Set();
  let userUpserts = 0;
  for (const term of Object.keys(raw)) {
    for (const item of raw[term]) {
      const u = item.user_info;
      if (usersById.has(u.id)) continue;
      let userName = u.user_name || `bk${u.id}`;
      while (seenUserNames.has(userName)) userName = `${userName}x`;
      seenUserNames.add(userName);
      const oid = new ObjectId();
      const existing = await db.collection('User').findOne({ user_name: userName });
      const doc = {
        _id: existing ? existing._id : oid,
        phone: existing ? existing.phone : fakePhone(u.id),
        user_name: userName,
        first_name: u.first_name ?? '',
        last_name: u.last_name ?? '',
        role: 'USER',
        is_verified: !!u.is_verified,
        is_buyer: false,
        is_seller: true,
        wallet_balance: 0,
        avatar_url: null,
        business_desc: null,
        profile: {},
        created_at: u.created_at ? new Date(u.created_at.replace(' ', 'T') + 'Z') : new Date(),
        updated_at: new Date(),
      };
      await db.collection('User').updateOne(
        { _id: doc._id },
        { $set: doc },
        { upsert: true },
      );
      usersById.set(u.id, doc._id); // ObjectId واقعی — پرایسما با ObjectId کوئری می‌کند
      userUpserts++;
    }
  }
  console.log(`✔ sellers: ${userUpserts} کاربر (upsert)`);

  // ── ۲. محصولات (همان id باسکول) ─────────────────────────────────────────
  let productUpserts = 0;
  let maxId = 0;
  const productRows = [];
  for (const term of Object.keys(raw)) {
    for (const item of raw[term]) {
      const m = item.main;
      const u = item.user_info;
      maxId = Math.max(maxId, m.id);
      const userId = usersById.get(u.id);
      const row = {
        _id: m.id,
        product_name: (m.product_name ?? '').trim(),
        slug: `خرید-عمده-${(m.product_name ?? '').trim()}-${m.id}`,
        description: (m.description ?? '').trim(),
        category_id: m.category_id,
        category_name: m.category_name,
        sub_category_id: m.sub_category_id,
        sub_category_name: m.sub_category_name,
        unit: m.unit ?? 'کیلوگرم',
        province_id: m.province_id,
        province_name: (m.province_name ?? '').trim(),
        city_id: m.city_id,
        city_name: (m.city_name ?? '').trim(),
        stock: m.stock ?? 0,
        min_sale_amount: m.min_sale_amount ?? 0,
        min_sale_price: m.min_sale_price ?? 0,
        features: [],
        status: 'confirmed',
        rejection_reasons: [],
        is_ladder: false,
        ladder_expires_at: null,
        has_video: !!m.has_video,
        is_old: !!m.is_old,
        view_count: Math.floor(Math.random() * 900) + 100,
        user_id: userId,
        seller_user_name: u.user_name,
        seller_first_name: u.first_name ?? '',
        seller_last_name: u.last_name ?? '',
        seller_is_verified: !!u.is_verified,
        created_at: new Date(),
        updated_at: m.updated_at ? new Date(m.updated_at.replace(' ', 'T') + 'Z') : new Date(),
      };
      productRows.push({ row, photos: item.photos ?? [] });
      productUpserts++;
    }
  }

  // پرکردن دسته پدر برای آگهی‌هایی که مستقیم زیر ریشه‌اند
  const catById = new Map();
  (await db.collection('Category').find({}).project({ _id: 1, parent_id: 1, category_name: 1 }).toArray())
    .forEach((c) => catById.set(c._id, c));

  for (const { row } of productRows) {
    if (catById.has(row.sub_category_id) && catById.get(row.sub_category_id).parent_id != null) {
      row.category_id = catById.get(row.sub_category_id).parent_id;
      row.category_name = catById.get(row.category_id)?.category_name ?? row.category_name;
    }
    await db.collection('Product').updateOne({ _id: row._id }, { $set: row }, { upsert: true });
  }
  console.log(`✔ products: ${productUpserts} آگهی (upsert)`);

  // ── ۳. Counter روی max+1000 ───────────────────────────────────────────────
  await db.collection('Counter').updateOne(
    { _id: 'product' },
    { $set: { seq: Math.max(maxId + 1000, 3_000_000) } },
    { upsert: true },
  );
  console.log(`✔ counter: product → ${Math.max(maxId + 1000, 3_000_000)}`);

  // ── ۴. عکس‌ها → آروان + ردیف File ────────────────────────────────────────
  if (SKIP_PHOTOS) {
    console.log('⏭ --skip-photos → عکس‌ها با URL باسکول ثبت می‌شوند (بدون rehost)');
    let fileRows = 0;
    for (const { row, photos } of productRows) {
      for (const [i, ph] of photos.slice(0, 4).entries()) {
        const url = ph.file_path;
        if (!url) continue;
        await db.collection('File').updateOne(
          { related_id: String(row._id), field_key: 'gallery', url },
          {
            $set: {
              owner_id: row.user_id,
              related_model: 'Product',
              related_id: String(row._id),
              field_key: 'gallery',
              description: null,
              name: url.split('/').pop() ?? `photo-${i}`,
              mime_type: 'image/jpeg',
              size: 0,
              url,
              thumb_url: null,
              storage_key: null,
              thumb_storage_key: null,
              metadata: { external: true },
              created_at: new Date(),
              updated_at: new Date(),
            },
          },
          { upsert: true },
        );
        fileRows++;
      }
    }
    console.log(`✔ files (external): ${fileRows} ردیف`);
  } else {
    console.log('▶ rehost عکس‌ها از CDN باسکول به آروان…');
    let ok = 0;
    let failed = 0;
    for (const { row, photos } of productRows) {
      // اگر قبلاً rehost شده (ردیف غیر-external موجود) → رد شو
      const rehosted = await db.collection('File').findOne({
        related_model: 'Product',
        related_id: String(row._id),
        field_key: 'gallery',
        metadata: { $ne: { external: true } },
      });
      if (rehosted) { ok++; continue; }

      const newRows = [];
      for (const [i, ph] of photos.slice(0, 4).entries()) {
        const url = ph.file_path;
        if (!url) continue;
        const fetched = await fetchImage(url);
        if (!fetched) { failed++; continue; }
        const processed = await processImage(fetched.buf);
        if (!processed) { failed++; continue; }

        const stamp = Date.now().toString(36);
        const key = `products/${row._id}/gallery/${stamp}-${i}.${processed.ext}`;
        try {
          const mainUrl = await putObject(key, processed.main, processed.mime);
          const thumbKey = `${key}.thumb.jpg`;
          const thumbUrl = await putObject(thumbKey, processed.thumb, 'image/jpeg');
          newRows.push({
            owner_id: row.user_id,
            related_model: 'Product',
            related_id: String(row._id),
            field_key: 'gallery',
            description: null,
            name: url.split('/').pop() ?? `photo-${i}`,
            mime_type: processed.mime,
            size: processed.main.length,
            url: mainUrl,
            thumb_url: thumbUrl,
            storage_key: key,
            thumb_storage_key: thumbKey,
            metadata: { originalSize: fetched.buf.length },
            created_at: new Date(),
            updated_at: new Date(),
          });
          ok++;
        } catch (err) {
          console.warn(`  ⚠ عکس ${row._id}/${i}: ${err.message}`);
          failed++;
        }
      }

      if (newRows.length > 0) {
        // ردیف‌های rehost‌شده جدید را درج کن و ردیف‌های external قبلی را حذف کن
        await db.collection('File').insertMany(newRows);
        await db.collection('File').deleteMany({
          related_model: 'Product',
          related_id: String(row._id),
          field_key: 'gallery',
          metadata: { external: true },
        });
      }
    }
    console.log(`✔ files (rehost): ${ok} موفق، ${failed} ناموفق`);
  }

  // ── ۵. تبدیل idهای رشته‌ای به ObjectId (پرایسما با ObjectId کوئری می‌کند) ──
  await fixObjectIds(db);

  await client.close();
  console.log('✅ seed محصولات باسکول کامل شد.');
}

/** تبدیل user_id (Product) و owner_id (File) رشته‌ای به ObjectId — idempotent */
async function fixObjectIds(db) {
  const toOid = (v) => (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) ? new ObjectId(v) : null);
  // محصولات
  const badProducts = await db.collection('Product').find({ user_id: { $type: 'string' } })
    .project({ _id: 1, user_id: 1 }).toArray();
  if (badProducts.length) {
    await db.collection('Product').bulkWrite(badProducts.map((p) => ({
      updateOne: { filter: { _id: p._id }, update: { $set: { user_id: toOid(p.user_id) } } },
    })));
  }
  console.log(`✔ fix user_id: ${badProducts.length} محصول تبدیل شد`);
  // فایل‌ها
  const badFiles = await db.collection('File').find({ owner_id: { $type: 'string' } })
    .project({ _id: 1, owner_id: 1 }).toArray();
  if (badFiles.length) {
    await db.collection('File').bulkWrite(badFiles.map((f) => ({
      updateOne: { filter: { _id: f._id }, update: { $set: { owner_id: toOid(f.owner_id) } } },
    })));
  }
  console.log(`✔ fix owner_id: ${badFiles.length} فایل تبدیل شد`);
}

main().catch((err) => {
  console.error('✖ خطای seed:', err.message);
  process.exit(1);
});
