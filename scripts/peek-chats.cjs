// بازبینی مستقیم چت‌ها در Atlas (پرایسما از dist بک‌اند)
async function main() {
  let PrismaCtor;
  try {
    const mod = require('@prisma/client');
    PrismaCtor = mod.PrismaClient;
  } catch {
    const mod = require('../node_modules/.prisma/client/index.js');
    PrismaCtor = mod.PrismaClient;
  }
  const prisma = new PrismaCtor();
  const threads = await prisma.chatThread.findMany({
    include: {
      product: { select: { productName: true } },
      seller: { select: { firstName: true, lastName: true, phone: true } },
      buyer: { select: { firstName: true, lastName: true, phone: true } },
      messages: { orderBy: { createdAt: 'asc' }, select: { senderId: true, text: true, readAt: true, createdAt: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
  console.log('threads:', threads.length);
  for (const t of threads) {
    const unread = t.messages.filter((m) => !m.readAt).length;
    console.log(
      `- ${t.id} | ${t.product.productName} | buyer=${t.buyer.firstName} ${t.buyer.lastName} | seller=${t.seller.firstName} ${t.seller.lastName} | msgs=${t.messages.length} unread=${unread} | lastAt=${t.lastMessageAt?.toISOString?.() ?? t.lastMessageAt}`,
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => console.error('ERR', e.message));
