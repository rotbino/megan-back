/**
 * Backfill وضعیت نظرات فروشندگان (دور دهم — قانون انتشار مالک ۲-۱۱).
 * فیلد status تازه به SellerReview اضافه شد؛ نظرهای موجودِ پیش از این قانون
 * همیشه عمومی بوده‌اند → به «approved» مهاجرت می‌شوند تا ناپدید نشوند.
 * نظرات بدون فیلد (null/undefined) و رشتهٔ خالی پوشش داده می‌شوند.
 * اجرا: node scripts/backfill-review-status.mjs   (idempotent)
 */
import { PrismaClient } from '../node_modules/@prisma/client/default.js';
import { config } from '../node_modules/dotenv/dist/index.cjs';

config({ path: '.env', override: true });
const prisma = new PrismaClient();

async function main() {
  // فیلد تازه اضافه شده در Mongo ممکن است اصلاً روی سند نباشد — where پرایسما
  // «missing» را نمی‌بیند؛ با دستور خامِ مونگو همهٔ سدهای بدون مقدار معتبر پوشش داده می‌شوند.
  const raw = await prisma.$runCommandRaw({
    update: 'SellerReview',
    updates: [
      {
        q: { $or: [{ status: { $exists: false } }, { status: null }, { status: '' }] },
        u: { $set: { status: 'approved' } },
        multi: true,
      },
    ],
  });
  console.log('دستور خام مهاجرت:', JSON.stringify(raw));
  const total = await prisma.sellerReview.count();
  const byStatus = await prisma.sellerReview.groupBy({ by: ['status'], _count: { _all: true } });
  console.log('وضعیت فعلی:', byStatus.map((g) => `${g.status ?? 'null'}=${g._count._all}`).join('، ') || 'خالی');
  console.log(`کل نظرات: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
