import { readFileSync } from 'fs';
const env = readFileSync('.env', 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
// if field missing in DB this throws
const u = await p.user.update({ where: { phone: '09196421264' }, data: { sessionsRevokedAt: null } });
console.log('OK — sessions_revoked_at exists in DB');
// products owned by test user مریم صابری
const maryam = await p.user.findUnique({ where: { phone: '09123334455' }, select: { id: true } });
const herProducts = await p.product.count({ where: { userId: maryam.id } });
console.log('maryam products:', herProducts);
// find a user with many products + name
const top = await p.product.groupBy({ by: ['userId'], _count: true, orderBy: { _count: { userId: 'desc' } }, take: 5 });
for (const t of top) {
  const usr = await p.user.findUnique({ where: { id: t.userId }, select: { phone: true, firstName: true, lastName: true, cityId: true, provinceId: true } });
  console.log(`user ${t.userId} → ${t._count.userId} products | ${JSON.stringify(usr)}`);
}
await p.$disconnect();
