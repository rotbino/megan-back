// عیب‌یابی فقط-خواندی «توضیحات کسب‌وکار» کاربران ایمپورت‌شده از باسکول.
// سؤال: چند کاربر متن خودکار باسکول/اینکوباک در businessDesc دارند؟
// چند متن واقعی شامل واژهٔ باسکول/اینکوباک است؟ الگوهای متن خودکار چیست؟
// اجرا: node scripts/diag-business-desc.mjs   (بدون نوشتن در دیتابیس)
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** همان نرمال‌سازی سرویس + نیم‌فاصله → فاصله */
function norm(t) {
  return String(t ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

/** منطق فعلی سرویس (کامیت 3d7a3aa) — فقط واریان باسکول */
function isAutoOld(desc) {
  const t = norm(desc);
  return (
    t.includes('در حال خرید و فروش عمده در بازار بزرگ باسکول') &&
    t.includes('برای ارتباط با من روی دکمه')
  );
}

/** منطق پیشنهادی جدید — هر دو نسل قالب (باسکول + اینکوباک قدیم) */
function isAutoNew(desc) {
  const t = norm(desc);
  const contact = t.includes('برای ارتباط با من رو') && t.includes('به اشتراک بگذارید');
  const brand =
    /در حال خرید و فروش عمده در بازار بزرگ (باسکول|اینکوباک)/.test(t) ||
    /در سامانه ?ی? ?(باسکول|اینکوباک) هستم/.test(t) ||
    /در سایت (باسکول|اینکوباک)/.test(t);
  return contact && brand;
}

const users = await prisma.user.findMany({
  where: { bUserName: { not: null } },
  select: { userName: true, businessDesc: true, b: true },
});
console.log(`کل کاربران ایمپورت‌شده: ${users.length}`);

const withDesc = users.filter((u) => (u.businessDesc ?? '').trim());
console.log(`دارای businessDesc غیرخالی: ${withDesc.length}`);

const hasBuskool = withDesc.filter((u) => norm(u.businessDesc).includes('باسکول'));
const hasInkubak = withDesc.filter((u) => norm(u.businessDesc).includes('اینکوباک'));
console.log(`  شامل «باسکول»: ${hasBuskool.length}`);
console.log(`  شامل «اینکوباک»: ${hasInkubak.length}`);

const autoOld = withDesc.filter((u) => isAutoOld(u.businessDesc));
const autoNew = withDesc.filter((u) => isAutoNew(u.businessDesc));
console.log(`  تشخیص خودکار با منطق فعلی سرویس: ${autoOld.length}`);
console.log(`  تشخیص خودکار با منطق جدید (اینکوباک هم): ${autoNew.length}`);
console.log(`  خودکارِ جدید که منطق فعلی می‌اندازد ولی قدیمی نمی‌کرد: ${autoNew.length - autoNew.filter((u) => isAutoOld(u.businessDesc)).length}`);

// متن‌های شامل برند که «خودکار» تشخیص داده نشدند — یعنی متن واقعی با واژهٔ برند
const realWithBrand = withDesc.filter(
  (u) => (hasBuskool.includes(u) || hasInkubak.includes(u)) && !isAutoNew(u.businessDesc),
);
console.log(`\nمتن واقعی (غیرقالبی) شامل باسکول/اینکوباک: ${realWithBrand.length}`);

// الگوهای متن خودکار — بعد از حذف نام/شهر، چند قالب متمایز هست؟
const patterns = new Map();
for (const u of autoNew) {
  const t = norm(u.businessDesc)
    .replace(/۲|۲/g, 'N')
    // حذف بخش‌های متغیر (نام/شهر/نوع محصول) برای خوشه‌بندی قالب
    .replace(/^[^.،!؟]*? هستم/, '«نام» هستم')
    .replace(/از شهر [^.،!؟]*? /, 'از شهر «شهر» ');
  patterns.set(t, (patterns.get(t) ?? 0) + 1);
}
console.log(`\nقالب‌های متمایز متن خودکار: ${patterns.size}`);
for (const [p, n] of [...patterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  [${n}×] ${p.slice(0, 160)}`);
}

// نمونهٔ متن‌های واقعی شامل برند
console.log(`\nنمونهٔ متن‌های واقعی شامل برند (۵ تا):`);
for (const u of realWithBrand.slice(0, 5)) {
  console.log(`  @${u.userName}: ${norm(u.businessDesc).slice(0, 180)}`);
}

// نمونهٔ متن‌های خودکارِ جدید (اینکوباک) که منطق فعلی رد نکرده بود
console.log(`\nنمونهٔ اینکوباکی که الان در دیتابیس ذخیره شده (۵ تا):`);
for (const u of autoNew.filter((x) => !isAutoOld(x.businessDesc)).slice(0, 5)) {
  console.log(`  @${u.userName}: ${norm(u.businessDesc).slice(0, 200)}`);
}

// b.descriptionIsAuto — چند تا از اسناد b فلگ قدیمی دارند؟
let flagAuto = 0;
for (const u of users) {
  const b = u.b ?? {};
  if (b.descriptionIsAuto === true) flagAuto++;
}
console.log(`\nاسناد b با descriptionIsAuto=true: ${flagAuto}`);

await prisma.$disconnect();
