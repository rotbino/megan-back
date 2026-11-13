// تست رفتار Prisma با @updatedAt در create/update + پشتیبانی EJSON در
// $runCommandRaw — روی یک محصول واقعی (بازگردانی می‌شود).
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const users = await prisma.user.findMany({ where: { bUserName: { not: null } }, select: { id: true } });
const prod = await prisma.product.findFirst({
  where: { userId: { in: users.map((u) => u.id) }, status: 'confirmed' },
  orderBy: { id: 'asc' },
  select: { id: true, createdAt: true, updatedAt: true, priceUpdatedAt: true },
});
if (!prod) { console.log('محصولی نیست'); process.exit(1); }
console.log(`محصول آزمون #${prod.id}`);
console.log(`  قبل: createdAt=${prod.createdAt.toISOString()} updatedAt=${prod.updatedAt.toISOString()} priceUpdatedAt=${prod.priceUpdatedAt?.toISOString() ?? 'null'}`);

// ── ۱) آیا update صریح updatedAt را می‌پذیرد؟
const OLD = new Date('2023-05-10T08:00:00Z');
await prisma.product.update({
  where: { id: prod.id },
  data: { updatedAt: OLD, priceUpdatedAt: OLD },
});
const after1 = await prisma.product.findUnique({ where: { id: prod.id } });
const updOk = after1.updatedAt.getTime() === OLD.getTime();
const priceOk = after1.priceUpdatedAt?.getTime() === OLD.getTime();
console.log(`  بعد از update صریح: updatedAt=${after1.updatedAt.toISOString()} → ${updOk ? 'پذیرفت ✅' : 'نادیده گرفت ❌ (باید raw بنویسیم)'} | priceUpdatedAt=${after1.priceUpdatedAt?.toISOString()} → ${priceOk ? 'پذیرفت ✅' : 'نادیده ❌'}`);

// ── ۲) $runCommandRaw با EJSON $date — اگر لازم شد
if (!updOk) {
  try {
    await prisma.$runCommandRaw({
      update: 'Product',
      updates: [
        { q: { _id: prod.id }, u: { $set: { updated_at: { $date: OLD.toISOString() }, price_updated_at: { $date: OLD.toISOString() } } } },
      ],
    });
    const after2 = await prisma.product.findUnique({ where: { id: prod.id } });
    const rawOk = after2.updatedAt.getTime() === OLD.getTime() && after2.priceUpdatedAt?.getTime() === OLD.getTime();
    console.log(`  بعد از $runCommandRaw EJSON: updatedAt=${after2.updatedAt.toISOString()} priceUpdatedAt=${after2.priceUpdatedAt?.toISOString()} → ${rawOk ? 'کار کرد ✅' : 'نوع خراب ❌'}`);
  } catch (e) {
    console.log(`  $runCommandRaw خطا: ${e.message}`);
  }
}

// ── بازگردانی مقدار اولیه
await prisma.product.update({
  where: { id: prod.id },
  data: { updatedAt: prod.updatedAt, priceUpdatedAt: prod.priceUpdatedAt, ...(updOk ? {} : {}) },
});
if (!updOk) {
  await prisma.$runCommandRaw({
    update: 'Product',
    updates: [
      { q: { _id: prod.id }, u: { $set: { updated_at: { $date: prod.updatedAt.toISOString() }, ...(prod.priceUpdatedAt ? { price_updated_at: { $date: prod.priceUpdatedAt.toISOString() } } : { $unset: { price_updated_at: '' } }) } } },
    ],
  });
}
const restored = await prisma.product.findUnique({ where: { id: prod.id } });
console.log(`  بازگردانی: updatedAt=${restored.updatedAt.toISOString()} priceUpdatedAt=${restored.priceUpdatedAt?.toISOString() ?? 'null'}`);

await prisma.$disconnect();
