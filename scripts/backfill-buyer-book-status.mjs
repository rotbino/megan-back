#!/usr/bin/env node
/**
 * backfill:buyer-book-status — پرکردن فیلد status ردیف‌های موجود دفتر خرید
 * (خواستهٔ مالک ۸-۱۱). ردیف‌های قدیمی بدون status → 'confirmed' چون تا دیروز
 * بدون بازبینی در دایرکتوری دیده می‌شدند؛ ردیف‌های تازه از این پس 'pending'
 * می‌شوند و تا تأیید ادمین برای فروشندگان نامرئی‌اند.
 *
 * اجرا: node scripts/backfill-buyer-book-status.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

const p = new PrismaClient();

const res = await p.$runCommandRaw({
  update: 'BuyerCategory',
  updates: [
    {
      q: { status: { $exists: false } },
      u: { $set: { status: 'confirmed', rejection_reasons: [] } },
      multi: true,
    },
  ],
});
console.log('✔ backfill BuyerCategory.status →', JSON.stringify(res));

const count = await p.buyerCategory.count();
const byStatus = await p.buyerCategory.groupBy({ by: ['status'], _count: { _all: true } });
console.log('total:', count, '| byStatus:', JSON.stringify(byStatus));
await p.$disconnect();
