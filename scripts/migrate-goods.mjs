/**
 * مهاجرت «نوع کالا» از جدول Category به جدول Good (خواسته مالک ۳۰-۱۰)
 * ─────────────────────────────────────────────────────────────────────────
 * قبلاً انواع کالا نود PRODUCT_TYPE در همان کالکشن Category بودند و در
 * سایدبار/فیلتر لیست محصولات ظاهر می‌شدند. حالا جدول جدا دارند.
 *
 * اجرای دومرحله‌ای (db push ستون product_type_id را می‌اندازد → اول اسنپ‌شات):
 *   ۱) node scripts/migrate-goods.mjs snapshot   ← قبل از prisma db push
 *   ۲) npx prisma generate && npx prisma db push
 *   ۳) node scripts/migrate-goods.mjs apply      ← بعد از db push
 *
 * apply:
 *  • ردیف Good برای هر نود PRODUCT_TYPE (همان id حفظ می‌شود تا ارجاع‌ها سالم بمانند)
 *  • BuyRequest.goodId از اسنپ‌شات productTypeId بازیابی می‌شود
 *  • نودهای PRODUCT_TYPE از Category حذف می‌شوند
 *  • Counter('good') روی بیشینه id تنظیم می‌شود
 */
import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

dotenv.config({ path: '.env', override: true });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const SNAP_FILE = path.join(process.cwd(), 'scripts/data/goods-snapshot.json');

async function snapshot() {
  const types = await prisma.category.findMany({ where: { kind: 'PRODUCT_TYPE' } });
  const requests = await prisma.buyRequest.findMany({
    where: { productTypeId: { not: null } },
    select: { id: true, productTypeId: true },
  });
  await mkdir(path.dirname(SNAP_FILE), { recursive: true });
  await writeFile(
    SNAP_FILE,
    JSON.stringify({
      types: types.map((t) => ({ id: t.id, name: t.categoryName, categoryId: t.parentId, createdAt: t.createdAt })),
      requests: requests.map((r) => ({ id: r.id, productTypeId: r.productTypeId })),
    }, null, 2),
    'utf8',
  );
  console.log(`snapshot: ${types.length} نوع کالا + ${requests.length} ارجاع درخواست → ${SNAP_FILE}`);
}

async function apply() {
  let snap;
  try {
    snap = JSON.parse(await readFile(SNAP_FILE, 'utf8'));
  } catch {
    console.error('اسنپ‌شات پیدا نشد — اول مرحله snapshot را قبل از db push اجرا کنید.');
    process.exit(1);
  }

  // ۱) ردیف‌های Good — همان id نود قدیمی + شمارش استفاده از ارجاع‌ها
  const usageByGood = new Map();
  for (const r of snap.requests) {
    if (r.productTypeId != null) usageByGood.set(r.productTypeId, (usageByGood.get(r.productTypeId) ?? 0) + 1);
  }
  let created = 0;
  for (const t of snap.types) {
    await prisma.good.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        categoryId: t.categoryId,
        usageCount: usageByGood.get(t.id) ?? 0,
        ...(t.createdAt ? { createdAt: new Date(t.createdAt) } : {}),
      },
      update: {}, // idempotent
    });
    created++;
  }
  console.log(`Good rows: ${created}`);

  // ۲و۳) عملیات روی فیلدهای قدیمی — با درایور خام (کلاینت جدید پرایسما
  // فیلدهای kind/product_type_id را نمی‌شناسد؛ مونگو اسکیما-less است)
  const { MongoClient } = await import('mongodb');
  const mongo = new MongoClient(process.env.DATABASE_URL);
  await mongo.connect();
  const db = mongo.db();

  // ۲) بازیابی ارجاع درخواست‌ها: product_type_id → good_id (+ unset قدیمی)
  let relinked = 0;
  for (const r of snap.requests) {
    if (r.productTypeId == null) continue;
    const res = await db.collection('BuyRequest').updateOne(
      { _id: r.id, product_type_id: r.productTypeId },
      { $set: { good_id: r.productTypeId }, $unset: { product_type_id: '' } },
    );
    relinked += res.modifiedCount;
  }
  console.log(`BuyRequest.good_id relinked: ${relinked}`);

  // ۳) حذف نودهای PRODUCT_TYPE از Category (اگر مانده باشد)
  const del = await db.collection('Category').deleteMany({ kind: 'PRODUCT_TYPE' });
  console.log(`PRODUCT_TYPE categories deleted: ${del.deletedCount}`);

  // ۳-ب) پاک‌سازی فیلد kind از بقیه اسناد Category (دیگر در اسکیمای جدید نیست)
  const unset = await db.collection('Category').updateMany(
    { kind: { $exists: true } },
    { $unset: { kind: '' } },
  );
  console.log(`Category.kind field unset from ${unset.modifiedCount} docs`);

  await mongo.close();

  // ۴) Counter('good') روی بیشینه id
  const maxId = snap.types.reduce((m, t) => Math.max(m, t.id), 900_000);
  await prisma.counter.upsert({
    where: { id: 'good' },
    create: { id: 'good', seq: maxId },
    update: {},
  });
  const counter = await prisma.counter.findUnique({ where: { id: 'good' } });
  if ((counter?.seq ?? 0) < maxId) {
    await prisma.counter.update({ where: { id: 'good' }, data: { seq: maxId } });
  }
  console.log(`Counter('good') → ${maxId}`);

  // صحت‌سنجی
  const goods = await prisma.good.count();
  console.log(`✓ goods=${goods}`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'snapshot') await snapshot();
  else if (cmd === 'apply') await apply();
  else {
    console.log('راهنما: node scripts/migrate-goods.mjs snapshot|apply');
    process.exit(1);
  }
} catch (e) {
  console.error('FAILED:', e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
