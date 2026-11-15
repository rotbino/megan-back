// سنجش ساختار تصاویر: آیا همهٔ عکس‌های هر آگهی در File با field_key=gallery هستند؟
// و چند عکس هر آگهی در دیتابیس دارد؟ (برای خواستهٔ مالک ۱۶-۱۱ عصر)
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const run = async (pipeline) =>
  (await prisma.$runCommandRaw({ aggregate: 'File', pipeline, cursor: {} }))
    .cursor?.firstBatch ?? [];

// ۱) توزیع field_key برای فایل‌های Product
const groups = await run([
  { $match: { related_model: 'Product' } },
  { $group: { _id: '$field_key', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('field_key groups:', JSON.stringify(groups));

// ۲) توزیع تعداد عکس در هر آگهی
const perProduct = await run([
  { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $ne: null } } },
  { $group: { _id: '$related_id', count: { $sum: 1 } } },
  { $group: { _id: '$count', products: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]);
console.log('photos-per-product distribution (count -> products):');
for (const r of perProduct) console.log(`  ${r._id} عکس: ${r.products} آگهی`);

// ۳) چند آگهی در Product اصلاً عکس دارند؟ (مقایسه با تعداد آگهی)
const totalProducts = await prisma.product.count();
const productsWithPhotos = await run([
  { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $ne: null } } },
  { $group: { _id: '$related_id' } },
  { $count: 'n' },
]);
console.log(`آگهی‌ها: ${totalProducts} کل | ${productsWithPhotos[0]?.n ?? 0} آگهی دارای عکس`);

// ۴) نمونهٔ آگهی با چند عکس — URLها برای تست بصری
const multi = await run([
  { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $ne: null } } },
  { $group: { _id: '$related_id', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 3 },
]);
for (const m of multi) {
  const prod = await prisma.product.findUnique({ where: { id: Number(m._id) }, select: { id: true, productName: true } });
  console.log(`نمونه: #${prod?.id} ${prod?.productName?.slice(0, 30)} → ${m.count} عکس`);
}

await prisma.$disconnect();
