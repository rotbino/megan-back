// ترمیم مهرهای updated_at آلودهٔ آگهی‌های ایمپورت‌شده (گزارش مالک ۱۵-۱۱):
// بک‌فیل normalize-desc-html (۱۴-۱۱ ساعت ۰۷:۱۷–۰۷:۱۹ UTC) با update عادی
// پریسما @updatedAt را به «اکنون» برد — ۱۶۹ آگهی چندسالهٔ باسکولی مهر تازهٔ
// جعلی گرفت و بالای «جدیدترین» نشست در حالی که کارتش «۵ سال پیش» است.
//
// قانون تشخیص (جراحی‌وار): فقط مهرهایی که در «عصر ایمچ» (از ۱۴-۱۱) نوشته
// شده‌اند جعلی‌اند — مقدارهای قدیمی‌تر (مثل خوشهٔ ۲۰۲۶-۰۹-۱۳) مهرهای واقعی
// باسکول‌اند که با ایمپورت آمده‌اند و نباید دست بخورند. آگهی‌های دارای
// تاریخچهٔ ویرایش واقعی (productEditHistory) و آگهی‌های پنل (id >= ۳م) هم
// معاف‌اند. مهر ترمیم = max(مهر قیمت، ثبت).
//
// اجرا:  node scripts/fix-fake-fresh-updated-at.mjs           → فقط گزارش (خشک)
//        node scripts/fix-fake-fresh-updated-at.mjs --apply   → اعمال
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const PRODUCT_START_ID = 3_000_000; // آستانهٔ idهای پنل — همان سرویس
/** شروع «عصر ایمچ» — نخستین روزی که نوشتنِ مقادیر تازه در این دیتابیس ممکن
 *  بود (پروژه از ۱۲–۱۳ آبان ۱۴۰۵ / ۱۲–۱۳ نوامبر ۲۰۲۶ فعّال است) */
const MEGAN_ERA = new Date('2026-11-14T00:00:00.000Z');

const rows = await prisma.product.findMany({
  where: {
    status: 'confirmed',
    id: { lt: PRODUCT_START_ID }, // فقط ایمپورت‌شده‌ها
    updatedAt: { gte: MEGAN_ERA },
  },
  select: { id: true, productName: true, createdAt: true, updatedAt: true, priceUpdatedAt: true },
});

let dirty = 0;
const edits = await prisma.productEditHistory.findMany({ select: { productId: true }, distinct: ['productId'] });
const edited = new Set(edits.map((e) => e.productId));

for (const p of rows) {
  if (edited.has(p.id)) continue; // ویرایش واقعی فروشنده — دست نزن
  const honest = new Date(
    Math.max(p.priceUpdatedAt?.getTime() ?? 0, p.createdAt.getTime()),
  );
  if (honest.getTime() === p.updatedAt.getTime()) continue;
  dirty++;
  console.log(
    `#${p.id} «${p.productName.slice(0, 24)}»: updated_at ${p.updatedAt.toISOString().slice(0, 16)} (جعلی) → ${honest.toISOString().slice(0, 16)}`,
  );
  if (APPLY) {
    // دستور خام — update عادی پریسما @updatedAt را به «اکنون» می‌گذارد
    await prisma.$runCommandRaw({
      update: 'Product',
      updates: [{ q: { _id: p.id }, u: { $set: { updated_at: { $date: honest.toISOString() } } } }],
    });
  }
}

console.log(
  `\n${rows.length} آگهی با مهر عصر-ایمچ بررسی شد • ${dirty} مهر جعلی ${APPLY ? 'ترمیم شد ✅' : 'نیاز به ترمیم دارد — برای نوشتن --apply بدهید'}`,
);
await prisma.$disconnect();

