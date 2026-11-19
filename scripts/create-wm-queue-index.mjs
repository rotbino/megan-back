/**
 * ایندکس ترکیبی صف بررسی واترمارک (۲۱-۱۱): پوشش کامل فیلتر «باقی‌مانده»
 * (related_model, field_key, watermark_fixed_at, watermark_reviewed_at,
 * has_watermark, related_id) — شمارش/تجمیعِ ۶۰هزار فایلِ نیازمند بررسی از
 * ~۴ ثانیه به کسری از ثانیه می‌رسد. مثل ایندکس‌های قبلی، مستقیم با
 * createIndexes چون prisma db-push روی drift گیر دارد.
 * اجرا: node scripts/create-wm-queue-index.mjs
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ path: '.env', override: true });
const prisma = new PrismaClient();

const KEY = {
  related_model: 1,
  field_key: 1,
  watermark_fixed_at: 1,
  watermark_reviewed_at: 1,
  has_watermark: 1,
  related_id: 1,
};
const NAME = 'File_wm_review_queue_idx';

// idempotent: اگر هست، skip
const cur = await prisma.$runCommandRaw({ listIndexes: 'File' });
if ((cur?.cursor?.firstBatch ?? []).some((i) => i.name === NAME)) {
  console.log('ALREADY_EXISTS');
} else {
  const t0 = Date.now();
  await prisma.$runCommandRaw({
    createIndexes: 'File',
    indexes: [{ key: KEY, name: NAME }],
  });
  console.log(`CREATED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await prisma.$disconnect();
