// پاک‌سازی «توضیحات کسب‌وکار» و توضیحات آگهی‌های کاربران ایمپورت‌شدهٔ باسکول
// (خواستهٔ مالک ۱۳-۱۱ — نام قدیمی سایت «اینکوباک» بوده):
//   ۱) متن خودکار باسکول/اینکوباک → businessDesc=null (صفحهٔ آیمچ متن پارامتریک
//      خودش را می‌سازد — lib/seller-text) + b.descriptionIsAuto=true + b.descriptionRaw=null
//   ۲) متن واقعی شامل «باسکول»/«اینکوباک» → جایگزینی با «آیمچ»
//   ۳) همین جایگزینی در توضیحات محصولات همین کاربران
// منطق عیناً همان isBuskoolAutoDesc/aimchifyBrandMentions سرویس است.
// اجرا:  node scripts/fix-business-desc.mjs           → فقط گزارش (خشک)
//        node scripts/fix-business-desc.mjs --apply   → اعمال
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// ── عین سرویس (importer.service.ts) ──
const normalizeFa = (t) =>
  String(t ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();

function isBuskoolAutoDesc(desc) {
  if (!desc) return false;
  const t = normalizeFa(desc);
  const contact = t.includes('برای ارتباط با من رو') && t.includes('به اشتراک بگذارید');
  const brand =
    /در حال خرید و فروش عمده در بازار بزرگ (باسکول|اینکوباک)/.test(t) ||
    /در سامانه ?ی? ?(باسکول|اینکوباک) هستم/.test(t) ||
    /در (وب ?سایت|سایت) (باسکول|اینکوباک)/.test(t);
  return contact && brand;
}

const aimchify = (t) =>
  String(t ?? '')
    .replace(/باس[كک]ول/g, 'آیمچ')
    .replace(/این[كک]وبا[كک]/g, 'آیمچ');

const users = await prisma.user.findMany({
  where: { bUserName: { not: null } },
  select: { id: true, userName: true, businessDesc: true, b: true },
});
console.log(`${APPLY ? '⚡ اعمال' : '🔍 خشک (بدون --apply فقط گزارش)'} — کاربران ایمپورت‌شده: ${users.length}\n`);

let nAuto = 0;
let nBrand = 0;
let nProduct = 0;
const changes = [];

for (const u of users) {
  const raw = (u.businessDesc ?? '').trim();
  if (!raw) continue;

  if (isBuskoolAutoDesc(raw)) {
    // ۱) متن خودکار → حذف از ستون نمایشی + فلگ در سند b
    nAuto++;
    const b = { ...(u.b ?? {}) };
    b.descriptionIsAuto = true;
    b.descriptionRaw = null;
    changes.push(`  @${u.userName}: خودکار باسکول/اینکوباک → حذف (متن پارامتریک آیمچ نمایش داده می‌شود)`);
    if (APPLY) {
      await prisma.user.update({
        where: { id: u.id },
        data: { businessDesc: null, b },
      });
    }
    continue;
  }

  const clean = aimchify(raw);
  if (clean !== raw) {
    // ۲) متن واقعی با اشاره به برند قدیمی
    nBrand++;
    changes.push(`  @${u.userName}: جایگزینی برند → «${clean.slice(0, 120)}${clean.length > 120 ? '…' : ''}»`);
    if (APPLY) {
      await prisma.user.update({ where: { id: u.id }, data: { businessDesc: clean } });
    }
  }

  // b.descriptionIsAuto=false + descriptionRaw با متن واقعی — برای رکوردهایی که
  // قبلاً با فلگ غلط/خالی مانده‌اند هم درست می‌شود
  const b = u.b ?? {};
  if (b.descriptionIsAuto !== false || b.descriptionRaw !== raw) {
    const bNew = { ...b, descriptionIsAuto: false, descriptionRaw: raw };
    if (APPLY) await prisma.user.update({ where: { id: u.id }, data: { b: bNew } });
  }
}

// ۳) توضیحات محصولات همین کاربران
const ids = users.map((u) => u.id);
const products = await prisma.product.findMany({
  where: { userId: { in: ids } },
  select: { id: true, productName: true, description: true },
});
for (const p of products) {
  const raw = (p.description ?? '').trim();
  if (!raw) continue;
  const clean = aimchify(raw);
  if (clean !== raw) {
    nProduct++;
    changes.push(`  محصول #${p.id} «${p.productName}»: جایگزینی برند در توضیحات`);
    if (APPLY) {
      await prisma.product.update({ where: { id: p.id }, data: { description: clean } });
    }
  }
}

for (const c of changes) console.log(c);
console.log(
  `\nخلاصه: ${nAuto} متن خودکار حذف‌شدنی • ${nBrand} متن با برند جایگزین‌شدنی • ${nProduct} توضیحات محصول جایگزین‌شدنی` +
    (APPLY ? ' — اعمال شد ✅' : ' — هنوز اعمال نشده؛ برای نوشتن --apply بدهید'),
);

await prisma.$disconnect();
