// بررسی آگهی‌های یتیم (userId بدون کاربر) و وضعیت محصولات seed
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, phone: true, userName: true } });
  const userIds = new Set(users.map((u) => u.id));
  const userByPhone = new Map(users.map((u) => [u.phone, u]));

  const prods = await prisma.product.findMany({
    select: { id: true, userId: true, productName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`total products: ${prods.length}`);
  const orphans = prods.filter((p) => !userIds.has(p.userId));
  console.log(`orphan products (userId not in users): ${orphans.length}`);
  for (const o of orphans.slice(0, 10)) console.log('  orphan:', o.id, o.title, 'status:', o.status);

  // محصولات بر اساس کاربر
  const byUser = new Map();
  for (const p of prods) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, []);
    byUser.get(p.userId).push(p);
  }
  console.log(`\nproducts by user:`);
  for (const [uid, list] of byUser) {
    const u = users.find((x) => x.id === uid);
    console.log(
      `  user=${u ? u.phone : '???(' + uid.slice(0, 8) + ')'} userName=${u?.userName ?? '-'}`,
      'count:', list.length,
      'statuses:', [...new Set(list.map((p) => p.status))].join(','),
      
    );
  }

  // درخواست‌های خرید
  const reqs = await prisma.buyRequest.findMany({
    select: { id: true, userId: true, productName: true, status: true, isDeleted: true },
  });
  console.log(`\ntotal buyRequests: ${reqs.length}`);
  const orphanReqs = reqs.filter((r) => !userIds.has(r.userId));
  console.log(`orphan buyRequests: ${orphanReqs.length}`);
  const reqByUser = new Map();
  for (const r of reqs) {
    if (!reqByUser.has(r.userId)) reqByUser.set(r.userId, []);
    reqByUser.get(r.userId).push(r);
  }
  for (const [uid, list] of reqByUser) {
    const u = users.find((x) => x.id === uid);
    console.log(
      `  user=${u ? u.phone : '???(' + uid.slice(0, 8) + ')'} userName=${u?.userName ?? '-'}`,
      'count:', list.length,
      'statuses:', [...new Set(list.map((r) => r.status))].join(','),
    );
  }
}

main().finally(() => prisma.$disconnect());
