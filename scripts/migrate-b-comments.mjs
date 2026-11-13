#!/usr/bin/env node
/**
 * مهاجرت کامنت‌های باسکول به جدول‌های جدید (خواستهٔ مالک ۱۳-۱۱)
 * =============================================================
 *
 * مشکل: ایمپورتر قبلی برای هر نویسندهٔ کامنت باسکول یک User واقعی با شمارهٔ
 * موبایل ساختگی «09…» می‌ساخت (ensureStubReviewer) — هم جدول کاربران از
 * کاربران الکی پر می‌شد و هم ممکن بود شمارهٔ موبایل واقعی یک نفر را «اشغال»
 * کند (کاربر واقعی بعداً با همان شماره نمی‌توانست ثبت‌نام کند).
 *
 * این اسکریپت (idempotent — اجرای چندباره بی‌ضرر است):
 *   ۱) stub های نویسندهٔ کامنت را پیدا می‌کند (userName با الگوی «bk-c…»
 *      یا profile.importedFrom='buskool-comment').
 *   ۲) برای هر یک: ردیف user_for_b_comment می‌سازد (نام/نام‌خانوادگی/شهر از
 *      رکورد stub؛ شهر با نام از جدول locations).
 *   ۳) SellerReview های او را به b_comment منتقل می‌کند (متن/امتیاز/تاریخ).
 *   ۴) ردیف‌های SellerReview قدیمی و خود stub کاربر را حذف می‌کند — شمارهٔ
 *      موبایل ساختگی 09… آزاد می‌شود.
 *
 * بعد از این اسکریپت، ایمپورتر جدید کامنت‌ها را مستقیم در b_comment
 * می‌نویسد و دیگر هرگز User برای نویسندهٔ کامنت نمی‌سازد.
 *
 * اجرا: npm run migrate:b-comments
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

// همان منطق پروفایل db-push — env سندباکس ممکن است DATABASE_URL جعلی داشته باشد
if (existsSync(join(root, 'scripts', 'lib', 'profile.mjs'))) {
  const { applyProfile } = await import('./lib/profile.mjs');
  applyProfile();
}

const prisma = new PrismaClient();

/** آیا این کاربر stub نویسندهٔ کامنت باسکول است؟ */
function isCommentStub(u) {
  const p = (u.profile ?? {});
  return (
    (typeof u.userName === 'string' && u.userName.startsWith('bk-c')) ||
    p.importedFrom === 'buskool-comment'
  );
}

async function main() {
  console.log('── مهاجرت کامنت‌های باسکول به b_comment / user_for_b_comment ──\n');

  // فقط کاربرانی که stub نویسندهٔ کامنت‌اند (نه فروشنده‌های ایمپورت‌شده، نه ادمین)
  const candidates = await prisma.user.findMany({
    where: { OR: [{ userName: { startsWith: 'bk-c' } }] },
    select: {
      id: true, userName: true, firstName: true, lastName: true, cityId: true, phone: true, profile: true,
    },
  });
  const stubs = candidates.filter(isCommentStub);
  console.log(`کاربران کاندید: ${candidates.length} → stub نویسندهٔ کامنت: ${stubs.length}`);

  if (stubs.length === 0) {
    console.log('کاری نیست — همه چیز به‌روز است.');
    return;
  }

  // نام شهرها برای stubهایی که cityId دارند
  const cityIds = [...new Set(stubs.map((s) => s.cityId).filter((x) => x != null))];
  const cityNames = new Map();
  if (cityIds.length) {
    const locs = await prisma.location.findMany({
      where: { type: 'city', buskolId: { in: cityIds } },
      select: { buskolId: true, name: true },
    });
    for (const l of locs) cityNames.set(l.buskolId, l.name);
  }

  let authors = 0, comments = 0, deletedReviews = 0, deletedStubs = 0, kept = 0;

  for (const s of stubs) {
    const p = (s.profile ?? {});
    const bUserId = typeof p.bUserId === 'number' ? p.bUserId : null;
    const bCommentId = typeof p.bCommentId === 'number' ? p.bCommentId : null;
    const city = cityNames.get(s.cityId) ?? null;

    // ۱) نویسندهٔ ساختگی — findThenCreate (idempotent)
    let author = await prisma.userForBComment.findFirst({
      where: bUserId ? { bUserId } : bCommentId ? { bCommentId } : { firstName: s.firstName, lastName: s.lastName, city },
    });
    if (!author) {
      author = await prisma.userForBComment.create({
        data: {
          bUserId,
          bCommentId,
          firstName: s.firstName ?? '',
          lastName: s.lastName ?? '',
          city,
        },
      });
      authors++;
    }

    // ۲) انتقال SellerReview های این نویسنده به b_comment
    const reviews = await prisma.sellerReview.findMany({ where: { authorId: s.id } });
    for (const r of reviews) {
      const dup = await prisma.bComment.findUnique({
        where: { authorId_sellerId: { authorId: author.id, sellerId: r.sellerId } },
      });
      if (!dup) {
        await prisma.bComment.create({
          data: {
            sellerId: r.sellerId,
            authorId: author.id,
            rating: r.rating,
            text: r.text,
            createdAt: r.createdAt,
          },
        });
        comments++;
      }
      await prisma.sellerReview.delete({ where: { id: r.id } });
      deletedReviews++;
    }

    // ۳) حذف stub — فقط اگر دیگر SellerReview نویسنده‌اش ندارد و آگهی/فایل هم ندارد
    const [prodCount, fileCount, remaining] = await Promise.all([
      prisma.product.count({ where: { userId: s.id } }),
      prisma.file.count({ where: { ownerId: s.id } }),
      prisma.sellerReview.count({ where: { OR: [{ authorId: s.id }, { sellerId: s.id }] } }),
    ]);
    if (prodCount === 0 && fileCount === 0 && remaining === 0) {
      await prisma.user.delete({ where: { id: s.id } });
      deletedStubs++;
      console.log(`  ✓ @${s.userName} → author#${author.id.slice(-6)} — حذف شد (تلفن ساختگی ${s.phone} آزاد شد)`);
    } else {
      kept++;
      console.log(`  ⚠ @${s.userName} نگه داشته شد (آگهی/فایل/نظر دارد) — دستی بررسی شود`);
    }
  }

  console.log('\n── نتیجه ──');
  console.log(`نویسندهٔ ساختگی جدید: ${authors}`);
  console.log(`کامنت منتقل‌شده به b_comment: ${comments}`);
  console.log(`SellerReview حذف‌شده: ${deletedReviews}`);
  console.log(`stub کاربر حذف‌شده (شمارهٔ 09… آزاد شد): ${deletedStubs}`);
  if (kept > 0) console.log(`⚠ stub نگه‌داشته‌شده: ${kept}`);
  console.log('\n✓ تمام شد.');
}

main()
  .catch((e) => {
    console.error('خطا:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
