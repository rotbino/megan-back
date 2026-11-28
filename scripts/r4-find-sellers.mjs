// r4-find-sellers — پیدا کردن فروشنده‌های آزمایشی دارای محصول confirmed
// اجرا: node scripts/r4-find-sellers.mjs (از ریشهٔ megan-back)
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?$/m)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

const products = await prisma.product.findMany({
  where: { status: 'confirmed' },
  select: { userId: true, productName: true, id: true },
  take: 4000,
});
const byUser = new Map();
for (const p of products) byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + 1);

const rice = await prisma.product.findMany({
  where: { productName: { contains: 'برنج' }, status: 'confirmed' },
  select: { id: true, productName: true, userId: true, features: true },
  take: 5,
});

const users = await prisma.user.findMany({
  where: { id: { in: [...byUser.keys()].slice(0, 60) } },
  select: { id: true, phone: true, userName: true, role: true },
});

const list = users
  .map((u) => ({ phone: u.phone, name: u.userName, role: u.role, hasPassword: u.hasPassword, products: byUser.get(u.id) }))
  .sort((a, b) => b.products - a.products)
  .slice(0, 10);

console.log('TOP SELLERS:');
for (const s of list) console.log(' ', s.phone, s.name, s.role, 'products:', s.products, 'hasPassword:', s.hasPassword);
console.log('RICE SAMPLES:');
for (const r of rice) console.log(' ', r.id, r.productName, 'features:', JSON.stringify(r.features));
await prisma.$disconnect();
