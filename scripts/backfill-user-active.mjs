#!/usr/bin/env node
/**
 * فاز A3 — بک‌فیل is_active برای کاربران موجود مونگو.
 * Prisma db push مقدار پیش‌فرض را روی سندهای قدیمی نمی‌نویسد؛ این اسکریپت
 * با $runCommandRaw برای همه‌ی سندهای بدون is_active مقدار true می‌گذارد.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// override — env سندباکس (postgres) بر .env مونگو اولویت دارد؛ مثل db-push.mjs
dotenv.config({ override: true });

const prisma = new PrismaClient();

async function main() {
  // only users missing is_active — multi:true وگرنه فقط اولین سند آپدیت می‌شود!
  const res = await prisma.$runCommandRaw({
    update: 'User',
    updates: [
      {
        q: { is_active: { $exists: false } },
        u: { $set: { is_active: true } },
        multi: true,
      },
    ],
  });
  console.log('backfill is_active:', JSON.stringify(res));

  // sample check — first user before/after
  const sample = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, phone: true, isActive: true, lastLoginAt: true },
  });
  console.log('sample user:', JSON.stringify(sample));

  // مجموع کاربران و شمار غیرفعال
  const [total, inactive] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: false } }),
  ]);
  console.log(`users total=${total} inactive=${inactive}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
