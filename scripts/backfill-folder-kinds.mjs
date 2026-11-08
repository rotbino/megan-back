#!/usr/bin/env node
/**
 * Backfill دور ۲۸ — برچسب kind برای پرونده‌های پیگیری موجود:
 *   • پرونده‌ای که درخواست خرید (buy_request) دارد → sell (سرنخ فروش — دید فروشنده)
 *   • پرونده‌ای که فقط آگهی (product) دارد یا خالی است → buy (سرنخ خرید)
 * یکتایی جدید (userId, kind, name) پس از این برچسب‌گذاری برقرار می‌ماند چون
 * هر کاربر قبلاً فقط یکتایی (userId, name) داشته — split به دو kind تکراری نمی‌سازد.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });
const { applyProfile } = await import(join(root, 'scripts', 'lib', 'profile.mjs'));
applyProfile();

const require = createRequire(import.meta.url);
const { PrismaClient } = require(join(root, 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient();

async function main() {
  const folders = await prisma.followFolder.findMany({
    select: { id: true, name: true, kind: true },
  });
  const items = await prisma.followItem.findMany({
    select: { folderId: true, targetType: true },
  });

  const sellFolders = new Set(items.filter((i) => i.targetType === 'buy_request').map((i) => i.folderId));
  let tagged = 0;
  for (const f of folders) {
    if (f.kind) continue; // قبلاً برچسب خورده
    const kind = sellFolders.has(f.id) ? 'sell' : 'buy';
    await prisma.followFolder.update({ where: { id: f.id }, data: { kind } });
    tagged++;
    console.log(`  ${kind === 'sell' ? '🟠' : '🔵'} «${f.name}» → ${kind}`);
  }
  console.log(`\n✓ ${tagged} پرونده برچسب خورد از ${folders.length} پرونده (بقیه از قبل kind داشتند).`);

  // گزارش شمار
  const after = await prisma.followFolder.groupBy({ by: ['kind'], _count: { _all: true } });
  console.log('  خلاصه:', after.map((g) => `${g.kind ?? 'null'}: ${g._count._all}`).join(' | '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
