#!/usr/bin/env node
/** پاک‌سازی کاربران تستی خریداران (09150000*) + داده‌های وابسته — پس از تست سرتاسری */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const phones = ['09150000001', '09150000002', '09150000003'];
const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true } });
const ids = users.map((u) => u.id);
console.log('test users:', users.map((u) => u.phone));

if (ids.length) {
  const threads = await prisma.chatThread.findMany({
    where: { OR: [{ sellerId: { in: ids } }, { buyerId: { in: ids } }] },
    select: { id: true },
  });
  const threadIds = threads.map((t) => t.id);
  let del = {};
  if (threadIds.length) del.messages = await prisma.chatMessage.deleteMany({ where: { threadId: { in: threadIds } } });
  del.threads = await prisma.chatThread.deleteMany({ where: { id: { in: threadIds } } });
  del.buyerCategories = await prisma.buyerCategory.deleteMany({ where: { userId: { in: ids } } });
  del.supplyOffers = await prisma.supplyOffer.deleteMany({ where: { OR: [{ sellerId: { in: ids } }, { buyerId: { in: ids } }] } });
  del.users = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const [k, v] of Object.entries(del)) console.log(`  ${k}: ${v.count}`);
}
await prisma.$disconnect();
console.log('done');
