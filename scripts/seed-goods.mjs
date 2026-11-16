/**
 * seed-goods.mjs — انواع کالای مرجع برای برگ‌های پایلوت (خواستهٔ مالک ۱۶-۱۱ شب):
 * «نوع کالا در جدول دیگه باشه که کاربر بر اساس اینها هم بتونه فیلتر داشته باشه».
 *
 * جدول Good از قبل در اسکیما هست (نوع کالا = ورودی آزاد کاربران، جداشده از درخت
 * Category — خواستهٔ مالک ۳۰-۱۰). این اسکریپت صرفاً انواع پرکاربرد سه برگ پایلوت
 * را idempotent می‌کارد تا:
 *  • در فرم ثبت/ویرایش به‌صورت پیشنهاد بیاید؛
 *  • در فیلتر /product-filter (برای دسته‌هایی که ctype اتریبیوت دارند) مرجع باشد؛
 *  • تطبیق «خریداران پیشنهادی» دقیق‌تر شود.
 *
 *   node scripts/seed-goods.mjs
 *
 * idempotent: ردیف موجود (categoryId+name) دست نمی‌خورد؛ id تازه از Counter('good').
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// DATABASE_URL از .env ترَک‌شدهٔ گیت (نسخهٔ ابری — بدون چاپ مقدار)
const envTxt = execSync('git show HEAD:.env', { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const m = /^DATABASE_URL=(.+)$/m.exec(envTxt);
if (!m) throw new Error('DATABASE_URL not found');
const databaseUrl = m[1].trim().replace(/^"|"$/g, '');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

/** انواع کالای مرجع — دستهٔ برگ باسکول ← انواع پرکاربرد بازار ایران */
const GOODS = [
  // برنج (باسکول id=43) — agri.grains.rice / ctype
  { categoryId: 43, names: ['شیرودی', 'هاشمی', 'طارم', 'فجر', 'صدری', 'عنبربو', 'دم‌سیاه', 'گرده', 'کوهسار'] },
  // نخود (باسکول id=74) — agri.pulses.chickpea / ctype
  { categoryId: 74, names: ['کابل', 'ممبلی', 'لک', 'سفید ریز'] },
  // تن ماهی (باسکول id=93) — food.canned.tuna / ctype
  { categoryId: 93, names: ['آلباکور', 'زردبال', 'پارو'] },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const { categoryId, names } of GOODS) {
    const existing = await prisma.good.findMany({
      where: { categoryId },
      select: { name: true },
    });
    const have = new Set(existing.map((g) => g.name));

    for (const name of names) {
      if (have.has(name)) {
        skipped++;
        continue;
      }
      // id تازه از Counter('good') — همان الگوی buy-requests.service
      const counter = await prisma.counter.upsert({
        where: { id: 'good' },
        create: { id: 'good', seq: 1 },
        update: { seq: { increment: 1 } },
      });
      await prisma.good.create({
        data: { id: counter.seq, categoryId, name },
      });
      created++;
      console.log(`  + [${categoryId}] ${name} (id=${counter.seq})`);
    }
  }

  console.log(`\n✅ انواع کالا: ${created} ایجاد، ${skipped} از قبل موجود`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
