import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const threads = await p.chatThread.findMany({
  select: { id: true, sellerId: true, buyerId: true, productId: true, lastMessageAt: true, createdAt: true, _count: { select: { messages: true } } },
  orderBy: { createdAt: 'asc' },
});
console.log('total threads:', threads.length);
// group by unordered pair
const pairs = new Map();
for (const t of threads) {
  const key = [t.sellerId, t.buyerId].sort().join('|');
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(t);
}
let dupPairs = 0;
for (const [key, list] of pairs) {
  if (list.length > 1) {
    dupPairs++;
    console.log('DUP PAIR', key, 'threads:', list.length);
    for (const t of list) console.log('  ', t.id, 'product:', t.productId, 'msgs:', t._count.messages, 'lastAt:', t.lastMessageAt);
  }
}
console.log('pairs total:', pairs.size, 'dup pairs:', dupPairs);
await p.$disconnect();
