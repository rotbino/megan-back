import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({
  where: { id: { in: ['6adf5c48e241f3dcec0b3056', '6ae4a21bdb823ec70c0495a4'] } },
  select: { id: true, userName: true, firstName: true, lastName: true, phone: true, isActive: true },
});
console.log(JSON.stringify(users, null, 2));
const threads = await p.chatThread.findMany({
  where: { OR: [{ sellerId: '6adf5c48e241f3dcec0b3056' }, { buyerId: '6adf5c48e241f3dcec0b3056' }, { sellerId: '6ae4a21bdb823ec70c0495a4' }, { buyerId: '6ae4a21bdb823ec70c0495a4' }] },
  select: { id: true, sellerId: true, buyerId: true, productId: true, lastMessageAt: true, createdAt: true },
});
console.log(JSON.stringify(threads, null, 2));
await p.$disconnect();
