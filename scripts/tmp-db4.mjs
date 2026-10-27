import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const u = await p.user.findUnique({ where: { phone: '09175726347' }, select: { id: true } });
const prods = await p.product.findMany({ where: { userId: u.id }, select: { id: true, productName: true, status: true, subCategoryId: true, categoryId: true } });
console.log('total products:', prods.length);
prods.slice(0, 10).forEach(pr => console.log(JSON.stringify(pr)));
// status distribution across all products
const dist = await p.product.groupBy({ by: ['status'], _count: true });
console.log('status distribution:', JSON.stringify(dist));
await p.$disconnect();
