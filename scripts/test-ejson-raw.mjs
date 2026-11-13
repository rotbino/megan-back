// تست پشتیبانی EJSON ($oid/$date) در ورودی $runCommandRaw — پیش‌نیاز فیکس
// raw برای شمارندهٔ بازدید و reaperها. روی محصول واقعی (بازگردانی می‌شود).
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const users = await prisma.user.findMany({ where: { bUserName: { not: null } }, select: { id: true } });
const prod = await prisma.product.findFirst({
  where: { userId: { in: users.map((u) => u.id) }, status: 'confirmed' },
  orderBy: { id: 'asc' },
});
const orig = { updatedAt: prod.updatedAt, priceUpdatedAt: prod.priceUpdatedAt, userId: prod.userId };
console.log(`آزمون روی #${prod.id} — user_id=${prod.userId}`);

const OLD = new Date('2023-05-10T08:00:00Z');

// ۱) $inc بدون دست‌زدن به updated_at (الگوی شمارندهٔ بازدید)
await prisma.$runCommandRaw({
  update: 'Product',
  updates: [{ q: { _id: prod.id }, u: { $inc: { view_count: 1 } } }],
});
let a = await prisma.product.findUnique({ where: { id: prod.id } });
console.log(`$inc view_count: updated=${a.updatedAt.toISOString()} (${a.updatedAt.getTime() === orig.updatedAt.getTime() ? 'دست‌نخورده ✅' : 'عوض شد ❌'}) view=${a.viewCount}/${prod.viewCount}`);

// ۲) $date در $set (الگوی بک‌فیل مهرهای زمانی)
try {
  await prisma.$runCommandRaw({
    update: 'Product',
    updates: [{ q: { _id: prod.id }, u: { $set: { updated_at: { $date: OLD.toISOString() } } } }],
  });
  a = await prisma.product.findUnique({ where: { id: prod.id } });
  const ok = a.updatedAt.getTime() === OLD.getTime();
  console.log(`$set با $date: updated=${a.updatedAt.toISOString()} → ${ok ? 'BSON Date واقعی ✅' : 'نوع خراب/رشته ❌'}`);
} catch (e) {
  console.log(`$date خطا: ${e.message.slice(0, 120)}`);
}

// ۳) $oid در q و $set (الگوی انتقال مالکیت ادغام اکانت)
try {
  const r = await prisma.$runCommandRaw({
    update: 'Product',
    updates: [{ q: { _id: prod.id, user_id: { $oid: orig.userId } }, u: { $set: { user_id: { $oid: orig.userId } } } }],
  });
  a = await prisma.product.findUnique({ where: { id: prod.id } });
  console.log(`$oid: matched=${JSON.stringify(r?.n ?? r)} user_id هنوز خواندنی=${a.userId === orig.userId ? '✅' : '❌'}`);
} catch (e) {
  console.log(`$oid خطا: ${e.message.slice(0, 120)}`);
}

// بازگردانی کامل
await prisma.$runCommandRaw({
  update: 'Product',
  updates: [{
    q: { _id: prod.id },
    u: {
      $set: { updated_at: { $date: orig.updatedAt.toISOString() }, view_count: prod.viewCount },
      ...(orig.priceUpdatedAt ? { price_updated_at: { $date: orig.priceUpdatedAt.toISOString() } } : {}),
      ...(!orig.priceUpdatedAt ? { $unset: { price_updated_at: '' } } : {}),
    },
  }],
});
a = await prisma.product.findUnique({ where: { id: prod.id } });
console.log(`بازگردانی: updated=${a.updatedAt.toISOString()} view=${a.viewCount} price=${a.priceUpdatedAt?.toISOString() ?? 'null'}`);

await prisma.$disconnect();
