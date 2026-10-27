import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
// users with confirmed products
const users = await p.product.findMany({ where: { status: 'confirmed' }, select: { userId: true }, distinct: ['userId'] });
console.log('users with confirmed products:', users.length);
for (const { userId } of users.slice(0, 6)) {
  const usr = await p.user.findUnique({ where: { id: userId }, select: { phone: true, firstName: true, lastName: true } });
  const cnt = await p.product.count({ where: { userId, status: 'confirmed' } });
  console.log(`${usr?.phone} (${usr?.firstName} ${usr?.lastName}) → ${cnt} confirmed`);
}
await p.$disconnect();
