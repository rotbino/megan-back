/**
 * پاک‌سازی دیتای تست مرورگر دور دهم (فونت + قانون انتشار نظرات).
 * کاربران 0935/0936 + نظرها + گفتگوها + ادمین تست حذف می‌شوند.
 * اجرا: node scripts/cleanup-browser-review-test.mjs
 */
import { PrismaClient } from '../node_modules/@prisma/client/default.js';
import { config } from '../node_modules/dotenv/dist/index.cjs';

config({ path: '.env', override: true });
const prisma = new PrismaClient();

async function main() {
  // فقط دو شمارهٔ همین اجرای تست (از فایل وضعیت) — هرگز الگوی عمومی
  const state = JSON.parse((await import('node:fs')).readFileSync('/tmp/review-test-state.json', 'utf8'));
  const phones = [state.buyerC.phone, state.buyerE.phone];
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return console.log('کاربر تستی نیست — تمیز.');

  const threads = await prisma.chatThread.findMany({ where: { OR: [{ sellerId: { in: ids } }, { buyerId: { in: ids } }] }, select: { id: true } });
  const thIds = threads.map((t) => t.id);
  if (thIds.length) await prisma.chatMessage.deleteMany({ where: { threadId: { in: thIds } } });
  await prisma.chatThread.deleteMany({ where: { id: { in: thIds } } });
  await prisma.sellerReview.deleteMany({ where: { OR: [{ sellerId: { in: ids } }, { authorId: { in: ids } }] } });
  await prisma.callLog.deleteMany({ where: { OR: [{ callerId: { in: ids } }, { calleeId: { in: ids } }] } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.otpCode.deleteMany({ where: { phone: { in: users.map((u) => u.phone) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.adminUser.updateMany({ where: { username: 'test_browser_admin' }, data: { isActive: false } });
  console.log(`حذف شد: ${ids.length} کاربر تست (${users.map((u) => u.phone).join('، ')})، ${thIds.length} گفتگو، نظرات و تماس‌های مربوطه + ادمین تست غیرفعال.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
