/**
 * Backfill اسلاگ آگهی‌های فروش (دور یازدهم — خواسته مالک ۲-۱۱:
 * «در عنوان آگهی های فروش زدی خرید، باید بزنی فروش»).
 * پیشوند «خرید-عمده-» اسلاگ‌های موجود به «فروش-عمده-» مهاجرت می‌کند.
 * idempotent — دوباره اجرا چیزی نمی‌شکند؛ URLهای قدیمی هم می‌مانند کارمی‌کنند
 * چون صفحهٔ محصول با id حل می‌شود (اسلاگ تزئینی است).
 * اجرا: node scripts/fix-ad-slugs.mjs
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../node_modules/@prisma/client/default.js';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const prisma = new PrismaClient();

async function main() {
  const old = await prisma.product.findMany({
    where: { slug: { startsWith: 'خرید-عمده-' } },
    select: { id: true, productName: true, slug: true },
    orderBy: { id: 'asc' },
  });
  console.log(`آگهی‌های با پیشوند قدیمی: ${old.length}`);
  for (const p of old) {
    const slug = `فروش-عمده-${p.productName.trim()}-${p.id}`;
    await prisma.product.update({ where: { id: p.id }, data: { slug } });
    console.log(`  #${p.id}: ${p.slug} ← ${slug}`);
  }
  const remain = await prisma.product.count({ where: { slug: { startsWith: 'خرید-عمده-' } } });
  console.log(`باقی‌مانده: ${remain}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
