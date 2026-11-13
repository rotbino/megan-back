// تست: شاخهٔ update آپسرت (@updatedAt) + بازگشت
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const users = await prisma.user.findMany({ where: { bUserName: { not: null } }, select: { id: true } });
const prod = await prisma.product.findFirst({
  where: { userId: { in: users.map((u) => u.id) }, status: 'confirmed' },
  orderBy: { id: 'asc' },
});
const before = { updatedAt: prod.updatedAt, priceUpdatedAt: prod.priceUpdatedAt, createdAt: prod.createdAt };

const OLD = new Date('2023-05-10T08:00:00Z');
// شبیهٔ دقیق ایمپورتر: upsert روی رکورد موجود (شاخهٔ update)
await prisma.product.upsert({
  where: { id: prod.id },
  update: { stock: prod.stock, updatedAt: OLD },
  create: { id: prod.id, productName: 'x', slug: 'x', description: '', categoryId: 1, subCategoryId: 1, unit: 'kg', provinceId: 1, cityId: 1, stock: 0, minSaleAmount: 0, minSalePrice: 0, userId: prod.userId },
});
const a = await prisma.product.findUnique({ where: { id: prod.id } });
console.log(`upsert-update با updatedAt صریح=${OLD.toISOString()} → نتیجه=${a.updatedAt.toISOString()} → ${a.updatedAt.getTime() === OLD.getTime() ? 'پذیرفت ✅' : 'نادیده گرفت ❌ (ریشهٔ باگ)'}`);

// بازگردانی
await prisma.product.update({ where: { id: prod.id }, data: { stock: prod.stock, updatedAt: before.updatedAt, priceUpdatedAt: before.priceUpdatedAt } });
console.log('بازگردانی شد');
await prisma.$disconnect();
