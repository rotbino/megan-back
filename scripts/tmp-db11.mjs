import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
// who owns DELETED products (the 92)? — these are who the owner probably tested with
const deletedOwners = await p.product.findMany({ where: { status: 'deleted' }, select: { userId: true }, distinct: ['userId'] });
console.log('users owning deleted products:', deletedOwners.length);
// sample: one with ONLY deleted products
for (const { userId } of deletedOwners.slice(0, 5)) {
  const u = await p.user.findUnique({ where: { id: userId }, select: { phone: true } });
  const conf = await p.product.count({ where: { userId, status: 'confirmed' } });
  const del = await p.product.count({ where: { userId, status: 'deleted' } });
  console.log(`${u.phone} → confirmed:${conf} deleted:${del}`);
}
await p.$disconnect();
