#!/usr/bin/env node
/**
 * تکمیل متن کامنت‌های باسکول (خواستهٔ مالک ۱۵-۱۱) — «متن کامنت‌ها مهمه»
 * ===================================================================
 *
 * ماجرا (سنجش زندهٔ ۱۵-۱۱ عصر، کاربر baker): متن کامنت‌های confirmed=1
 * باسکول کاملاً عمومی است — بدون هیچ کوکی‌ای هم برمی‌گردد. متنِ
 * confirmed=0 (اکثریت قاطع) فقط برای سشنِ لاگین‌شده باز می‌شود؛ کوکی
 * مهمان پذیرفته می‌شود ولی چیزی باز نمی‌کند. بخشی از کامنت‌های خالی هم
 * «فقط-امتیازی»اند و هرگز متنی نداشته‌اند (baker: ۴ از ۱۷ تأییدشده).
 * سشن باسکول به IP ایران گره خورده — پس این اسکریپت را روی سیستم خودتان
 * (ایران) با کوکیِ بعد از لاگین اجرا کنید:
 *
 *   ۱) در مرورگر وارد buskool.com شوید
 *   ۲) F12 → Network → یک درخواست XHR به buskool.com → Copy whole Cookie header
 *   ۳) در .env ← BUSKOOL_COOKIE="..." (کل رشته)
 *   ۴) node scripts/refresh-b-comment-texts.mjs
 *
 * چه می‌کند (idempotent — اجرای مکرر بی‌ضرر):
 *   • اول لاگین‌بودن سشن را می‌سنجد (GET /api/user — مهمان 401 می‌گیرد؛
 *     کشف ۱۵-۱۱: کوکی مهمان از باسکول پذیرفته می‌شود ولی چیزی باز نمی‌کند)
 *   • فروشنده‌هایی که کامنت بدون متن (text='') دارند پیدا می‌کند
 *   • کامنت‌هایشان را با کوکی از باسکول می‌گیرد
 *   • متنِ کامنت‌های موجود را پر می‌کند (متن پرشده هرگز با خالی بازنویسی نمی‌شود)
 *   • کامنت‌های جدید (نویسنده‌ای که نداریم) را لیستی اضافه می‌کند
 *   • گزارش کامل می‌دهد؛ اگر کوکی کار نکند با پیام روشن می‌ایستد
 *
 * نکتهٔ سرعت: همهٔ عملیات‌های DB لیستی است (createMany) — مثل ایمپورتر جدید.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });
if (existsSync(join(root, 'scripts', 'lib', 'profile.mjs'))) {
  const { applyProfile } = await import('./lib/profile.mjs');
  applyProfile();
}
const require = createRequire(join(root, 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'https://www.buskool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DELAY_MS = 600; // ادب با باسکول
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cookie = (process.env.BUSKOOL_COOKIE ?? '').trim();
const aimchify = (t) =>
  String(t ?? '')
    .replace(/باس[كک]ول/g, 'آیمچ')
    .replace(/این[كک]وبا[كک]/g, 'آیمچ');
const bkDate = (s) => {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
};
const newObjectId = () => randomBytes(12).toString('hex');

async function fetchComments(userId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/profile/get-user-comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          Origin: API,
          Referer: `${API}/`,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ user_id: userId }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status === 403) throw new Error(`HTTP ${res.status} — محدودیت باسکول`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ctype = (res.headers.get('content-type') ?? '').split(';')[0];
      if (ctype.includes('text/html')) throw new Error('پاسخ HTML — سشن/کوکی پذیرفته نشد (IP خارج از ایران؟)');
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1500 * attempt);
    }
  }
}

async function main() {
  if (!cookie) {
    console.error('✖ BUSKOOL_COOKIE در .env تنظیم نیست — راهنما بالای همین فایل.');
    process.exit(1);
  }
  console.log('── تکمیل متن کامنت‌های باسکول (با کوکی) ──\n');

  // سنجش لاگین‌بودن سشن (کشف ۱۵-۱۱) — کوکیِ مهمان پذیرفته می‌شود ولی
  // متن confirmed=0 را باز نمی‌کند؛ قبل از زدن ۴۰۰ درخواست بی‌فایده بایستیم.
  // GET /api/user: سشن لاگین‌شده 200، مهمان 401 Unauthenticated.
  {
    let status = null;
    try {
      const res = await fetch(`${API}/api/user`, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          Referer: `${API}/`,
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(20_000),
      });
      status = res.status;
    } catch {
      /* شبکه */
    }
    if (status === 401) {
      console.error('✖ این کوکی سشنِ «مهمان» است — لاگین نیست.');
      console.error('  لاراول بعد از ورود به حساب session id را عوض می‌کند؛');
      console.error('  کوکیِ قبل از لاگین (یا از مرورگرِ لاگین‌نکرده) هیچ چیزی را باز نمی‌کند.');
      console.error('  راه درست: در buskool.com وارد حساب شوید → بعد F12 → Network →');
      console.error('  یک درخواست XHR → Copy whole Cookie header → در .env بگذارید و دوباره اجرا کنید.');
      process.exit(1);
    }
    console.log(status === 200 ? '✓ سشن لاگین است\n' : `؟ وضعیت سشن نامشخص (HTTP ${status}) — ادامه می‌دهیم\n`);
  }

  // فروشنده‌های دارای کامنت بدون متن + شناسهٔ باسکولشان
  const emptySellers = await prisma.bComment.findMany({
    where: { text: '' },
    select: { sellerId: true },
  });
  const sellerIds = [...new Set(emptySellers.map((c) => c.sellerId))];
  const sellers = await prisma.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, userName: true, b: true },
  });
  const withBkId = sellers.filter((s) => s.b && s.b.userId);
  console.log(`فروشنده‌های دارای کامنت بدون متن: ${sellerIds.length} (با شناسهٔ باسکول: ${withBkId.length})\n`);
  if (!withBkId.length) return;

  let sellersDone = 0, textsFilled = 0, newComments = 0, stillEmpty = 0, failed = 0;
  let cookieWorks = null; // null = هنوز معلوم نیست

  for (const seller of withBkId) {
    const bkUserId = seller.b.userId;
    let resp;
    try {
      resp = await fetchComments(bkUserId);
    } catch (err) {
      failed++;
      console.log(`  ✖ @${seller.userName}: ${(err).message}`);
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    const list = (resp?.comments ?? []).filter((c) => c.rating_score || c.text);
    const withText = list.filter((c) => c.text);
    // تشخیص سلامت کوکی با اولین فروشندهٔ پرکامنت: اگر هیچ متنی نیامد یعنی کوکی کار نمی‌کند
    if (cookieWorks === null && list.length >= 5) {
      cookieWorks = withText.length > 0;
      if (!cookieWorks) {
        console.error('\n✖ کوکی کار نمی‌کند — پاسخ باسکول همچنان بدون متن است.');
        console.error('  یا سشن منقضی شده یا باسکول آن را به IP دیگری گره زده (از ایران با فیلترشکن خاموش اجرا کنید).');
        process.exit(1);
      }
      console.log('✓ کوکی سالم است — متن‌ها می‌آیند\n');
    }

    if (!withText.length) continue;
    sellersDone++;

    // نویسنده‌های موجود — یک کوئری (به‌ازای هر کامنت نیست)
    const bkIds = [...new Set(list.filter((c) => c.user_id).map((c) => c.user_id))];
    const existingAuthors = bkIds.length
      ? await prisma.userForBComment.findMany({
          where: { bUserId: { in: bkIds } },
          select: { id: true, bUserId: true },
        })
      : [];
    const authorIdByBk = new Map(existingAuthors.map((a) => [a.bUserId, a.id]));

    // کامنت‌های موجود این فروشنده — یک کوئری
    const existingComments = await prisma.bComment.findMany({
      where: { sellerId: seller.id },
      select: { authorId: true, text: true, rating: true },
    });
    const existingByAuthor = new Map(existingComments.map((r) => [r.authorId, r]));

    // ۱) متن کامنت‌های موجود را پر کن (هرگز متن پرشده را خالی نکن)
    for (const c of withText) {
      if (!c.user_id) continue;
      const authorId = authorIdByBk.get(c.user_id);
      if (!authorId) continue; // نویسندهٔ جدید — پایین‌تر
      const prev = existingByAuthor.get(authorId);
      if (!prev) continue;
      const text = aimchify(c.text.slice(0, 1000));
      if (prev.text !== text) {
        await prisma.bComment.update({
          where: { authorId_sellerId: { authorId, sellerId: seller.id } },
          data: { text, ...(prev.rating !== (c.rating_score ?? 5) ? { rating: c.rating_score ?? 5 } : {}) },
        });
        textsFilled++;
      }
    }

    // ۲) کامنت‌های کاملاً جدید (نویسنده‌ای که نداریم) — لیستی
    const missingAuthorComments = list.filter((c) => {
      if (!c.rating_score && !c.text) return false;
      if (!c.user_id) return false;
      const authorId = authorIdByBk.get(c.user_id);
      return !authorId || !existingByAuthor.has(authorId);
    });
    if (missingAuthorComments.length) {
      // نویسنده‌های غایب — createMany با id سمت کلاینت (Prisma idها را برنمی‌گرداند)
      const missingAuthors = [];
      for (const c of missingAuthorComments) {
        if (authorIdByBk.has(c.user_id)) continue;
        const id = newObjectId();
        authorIdByBk.set(c.user_id, id);
        missingAuthors.push({
          id,
          bUserId: c.user_id ?? null,
          bCommentId: c.c_id ?? null,
          firstName: c.first_name ?? '',
          lastName: c.last_name ?? '',
          city: (c.city ?? '').trim() || null,
        });
      }
      if (missingAuthors.length) await prisma.userForBComment.createMany({ data: missingAuthors });
      await prisma.bComment.createMany({
        data: missingAuthorComments.map((c) => ({
          sellerId: seller.id,
          authorId: authorIdByBk.get(c.user_id),
          rating: c.rating_score ?? 5,
          text: aimchify((c.text ?? '').slice(0, 1000)),
          createdAt: bkDate(c.created_at) ?? new Date(),
        })),
      });
      newComments += missingAuthorComments.length;
    }

    // شمارش هنوز-خالی‌ها برای گزارش
    stillEmpty += list.filter((c) => !c.text).length;
    console.log(`  ✓ @${seller.userName}: ${withText.length} متن، ${missingAuthorComments.length} کامنت جدید`);
  }

  console.log('\n── گزارش ──');
  console.log(`فروشنده‌های پردازش‌شده (متن داشتند): ${sellersDone}`);
  console.log(`متن پرشده: ${textsFilled}`);
  console.log(`کامنت جدید افزوده‌شده: ${newComments}`);
  console.log(`کامنت‌های همچنان بدون متن (فقط-امتیازی یا کوکی‌گیر نیامده): ${stillEmpty}`);
  if (failed) console.log(`شکست شبکه: ${failed}`);
  console.log('\nنکته: کامنت‌های «فقط-امتیازی» واقعاً متنی ندارند — خالی ماندنشان طبیعی است.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
