#!/usr/bin/env node
/**
 * بک‌فیل ۱۹-۱۱ — سه فیلد بولین که Prisma db push روی سندهای قدیمی نمی‌نویسد
 * (الگوی backfill-user-active.mjs):
 *   1) Product.owner_paused  = false  (فیلد جدید «عدم نمایش» — بدون این، فیلتر
 *      ownerPaused:false در کوئری‌های عمومی سندهای قدیمی را حذف می‌کرد!)
 *   2) Product.owner_hidden  = false  (ترمیم باگ خاموش: ۹۰۸ آگهیِ بدون این فیلد
 *      در getMyProducts دیده نمی‌شدند چون {owner_hidden:false} سند بدون فیلد
 *      را مچ نمی‌کند)
 *   3) File.has_watermark    = false  (فیلد جدید تیک واترمارک — برای فیلتر
 *      «بدون واترمارک» لازم است روی همهٔ فایل‌ها مقدار صریح باشد)
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const prisma = new PrismaClient();

async function main() {
  const r1 = await prisma.$runCommandRaw({
    update: 'Product',
    updates: [{ q: { owner_paused: { $exists: false } }, u: { $set: { owner_paused: false } }, multi: true }],
  });
  console.log('Product.owner_paused backfill:', JSON.stringify(r1));

  const r2 = await prisma.$runCommandRaw({
    update: 'Product',
    updates: [{ q: { owner_hidden: { $exists: false } }, u: { $set: { owner_hidden: false } }, multi: true }],
  });
  console.log('Product.owner_hidden backfill:', JSON.stringify(r2));

  const r3 = await prisma.$runCommandRaw({
    update: 'File',
    updates: [{ q: { has_watermark: { $exists: false } }, u: { $set: { has_watermark: false } }, multi: true }],
  });
  console.log('File.has_watermark backfill:', JSON.stringify(r3));

  // راستی‌آزمایی — دیگر سند بدون فیلد نباشد
  const check = await prisma.$runCommandRaw({
    aggregate: 'Product',
    pipeline: [
      {
        $facet: {
          noPaused: [{ $match: { owner_paused: { $exists: false } } }, { $count: 'n' }],
          noHidden: [{ $match: { owner_hidden: { $exists: false } } }, { $count: 'n' }],
        },
      },
    ],
    cursor: {},
  });
  const f = check?.cursor?.firstBatch?.[0] ?? {};
  console.log('remaining missing owner_paused:', JSON.stringify(f.noPaused ?? []));
  console.log('remaining missing owner_hidden:', JSON.stringify(f.noHidden ?? []));
}

main()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
