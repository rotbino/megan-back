/**
 * پاکسازی دیتای تست مرورگر فاز حضور/نظرات — بعد از تست دستی.
 * اجرا: node scripts/cleanup-presence-test.mjs
 */
import { PrismaClient } from '../node_modules/@prisma/client/default.js';
import { config } from '../node_modules/dotenv/dist/index.cjs';

config({ path: '.env', override: true });
const prisma = new PrismaClient();

const TEST_PHONES = ['09151112233'];
const SELLER_USER_NAME = 'npcm19sa';

async function main() {
  const seller = await prisma.user.findUnique({ where: { userName: SELLER_USER_NAME }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { phone: { in: TEST_PHONES } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  console.log('کاربران تست:', ids.length, '| فروشنده:', seller?.id);

  for (const uid of ids) {
    // نظرات تست
    if (seller) {
      const r = await prisma.sellerReview.deleteMany({ where: { authorId: uid, sellerId: seller.id } });
      console.log('نظر تست حذف:', r.count);
    }
    // مکالمات تست (مستقیم + روی آگهی)
    const threads = await prisma.chatThread.findMany({
      where: { OR: [{ buyerId: uid }, { sellerId: uid }] },
      select: { id: true },
    });
    for (const t of threads) {
      await prisma.chatMessage.deleteMany({ where: { threadId: t.id } });
      await prisma.chatThread.delete({ where: { id: t.id } });
    }
    console.log('مکالمات تست حذف:', threads.length);
    // گزارش تماس تست
    await prisma.callLog.deleteMany({ where: { callerId: uid } });
    // خود کاربر تست
    await prisma.user.delete({ where: { id: uid } }).catch(() => console.log('کاربر حذف نشد (ممکن است رکورد داشته باشد)'));
  }

  // ادمین تست مرورگر
  await prisma.adminUser.update({ where: { username: 'browser_admin' }, data: { isActive: false } });
  console.log('ادمین تست غیرفعال شد');

  // نبض فروشنده ریست (تا پروفایل «آفلاین» طبیعی نشان دهد)
  if (seller) {
    await prisma.user.update({ where: { id: seller.id }, data: { lastSeenAt: null } });
    console.log('نبض فروشنده ریست شد');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
