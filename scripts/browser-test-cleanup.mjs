/**
 * پاکسازی دیتای تست مرورگر د-۹ — کاربر Y + مکالماتش.
 * X (فروشنده آگهی) کاربر موجود است و دست نمی‌خورد.
 * اجرا: node scripts/browser-test-cleanup.mjs
 */
const fs = await import('node:fs');
let d;
try {
  d = JSON.parse(fs.readFileSync('/tmp/browser-test-data.json', 'utf-8'));
} catch {
  console.log('دیتای تست نیست — چیزی برای پاکسازی نیست');
  process.exit(0);
}

const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

const threads = await prisma.chatThread.findMany({
  where: { OR: [{ buyerId: d.Y.userId }, { sellerId: d.Y.userId }] },
  select: { id: true },
});
for (const t of threads) {
  await prisma.chatMessage.deleteMany({ where: { threadId: t.id } });
  await prisma.chatThread.deleteMany({ where: { id: t.id } });
}
await prisma.adminMessage.deleteMany({ where: { userId: d.Y.userId } });
await prisma.refreshToken.deleteMany({ where: { userId: d.Y.userId } });
await prisma.user.delete({ where: { id: d.Y.userId } }).catch(() => {});
console.log(`پاک شد: ${threads.length} مکالمه + کاربر ${d.Y.userName}`);
await prisma.$disconnect();
