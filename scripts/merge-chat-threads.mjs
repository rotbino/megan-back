#!/usr/bin/env node
/**
 * ادغام مکالمات تکراری هر جفت کاربر (خواسته مالک ۴-۱۱):
 * «اگر سعید در سه روز سه بار پیام بدهد، سعید باید فقط یک بار در لیست چت
 *  علی بیاید — پیام جدید در ادامهٔ همان چت قبلی.»
 *
 * مدل قدیمی: یک thread به‌ازای (فروشنده، خریدار، آگهی) → همان جفت کاربر
 * چند ردیف در لیست چت می‌شد. مدل جدید: یک thread به‌ازای جفت کاربر.
 *
 * این اسکریپت یک‌بارِ تاریخ است:
 *  ۱. تردها را گروه‌بندی جفتِ بی‌ترتیب (min/max دو شناسه) می‌کند
 *  ۲. جدیدترین thread هر گروه (بیشترین lastMessageAt / createdAt) می‌ماند
 *  ۳. پیام‌های بقیه با updateMany به thread نگه‌دارنده منتقل می‌شوند
 *  ۴. lastMessageAt نگه‌دارنده از آخرین پیام بازمحاسبه می‌شود
 *  ۵. تردهای خالی‌شده حذف می‌شوند
 *
 * اجرا: node scripts/merge-chat-threads.mjs [--dry]
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

const DRY = process.argv.includes('--dry');
const p = new PrismaClient();

async function main() {
  const threads = await p.chatThread.findMany({
    select: { id: true, sellerId: true, buyerId: true, productId: true, lastMessageAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // گروه‌بندی جفت بی‌ترتیب
  const groups = new Map();
  for (const t of threads) {
    const key = [t.sellerId, t.buyerId].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  let merged = 0;
  let moved = 0;
  let deleted = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;

    // نگه‌دارنده: تازه‌ترین فعالیت (lastMessageAt برتر، سپس createdAt)
    const activity = (t) => t.lastMessageAt?.getTime() ?? 0;
    const keeper = [...list].sort((a, b) => activity(b) - activity(a) || b.createdAt - a.createdAt)[0];

    for (const t of list) {
      if (t.id === keeper.id) continue;
      if (!DRY) {
        // ۱) انتقال پیام‌ها به نگه‌دارنده
        const r = await p.chatMessage.updateMany({
          where: { threadId: t.id },
          data: { threadId: keeper.id },
        });
        moved += r.count;
        // ۲) حذف thread خالی‌شده
        await p.chatThread.delete({ where: { id: t.id } });
      }
      merged++;
      deleted++;
    }

    // ۳) بازمحاسبهٔ lastMessageAt نگه‌دارنده از آخرین پیام
    if (!DRY) {
      const last = await p.chatMessage.findFirst({
        where: { threadId: keeper.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      await p.chatThread.update({
        where: { id: keeper.id },
        data: { lastMessageAt: last?.createdAt ?? null },
      });
    }
  }

  console.log(
    DRY
      ? `[dry] جفت‌های دارای تکرار: ${[...groups.values()].filter((g) => g.length > 1).length} — ${merged} thread ادغام می‌شد`
      : `✔ انجام شد — ${merged} thread ادغام، ${moved} پیام منتقل، ${deleted} thread حذف`,
  );
}

main()
  .catch((e) => {
    console.error('✖ خطا:', e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
