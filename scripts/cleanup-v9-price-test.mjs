/**
 * پاک‌سازی کاربر تست دور نهم (قیمت/زمان) — فقط 09150000099.
 * کاربر فقط ثبت‌نام + تکمیل پروفایل کرد؛ هیچ آگهی/نظری ندارد.
 * اجرا: node scripts/cleanup-v9-price-test.mjs
 */
import { PrismaClient } from '../node_modules/@prisma/client/default.js';
import { config } from '../node_modules/dotenv/dist/index.cjs';

config({ path: '.env', override: true });
const prisma = new PrismaClient();

const TEST_PHONE = '09150000099';

async function main() {
  const u = await prisma.user.findUnique({ where: { phone: TEST_PHONE }, select: { id: true } });
  if (!u) return console.log('کاربر تست موجود نیست — تمیز.');
  const uid = u.id;
  console.log('حذف کاربر تست:', uid);

  // وابسته‌های احتمالی (نشست‌ها/پوش/کدهای OTP/گفتگوها/نشان‌ها)
  await prisma.refreshToken.deleteMany({ where: { userId: uid } });
  await prisma.pushSubscription.deleteMany({ where: { userId: uid } });
  await prisma.otpCode.deleteMany({ where: { phone: TEST_PHONE } });
  const threads = await prisma.chatThread.findMany({
    where: { OR: [{ buyerId: uid }, { sellerId: uid }] },
    select: { id: true },
  });
  for (const t of threads) {
    await prisma.chatMessage.deleteMany({ where: { threadId: t.id } });
    await prisma.chatThread.delete({ where: { id: t.id } });
  }
  await prisma.callLog.deleteMany({ where: { callerId: uid } });
  // نشان‌ها: این کاربر هدفِ دیگران بوده یا لیست داشته (لیست‌ها کسکید می‌شوند)
  await prisma.savedUser.deleteMany({ where: { targetUserId: uid } });
  await prisma.savedList.deleteMany({ where: { userId: uid } });
  await prisma.sellerReview.deleteMany({ where: { authorId: uid } });
  await prisma.buyRequest.deleteMany({ where: { userId: uid } });
  await prisma.product.deleteMany({ where: { userId: uid } });

  await prisma.user.delete({ where: { id: uid } });
  console.log('✓ حذف شد و وابسته‌ها پاک شدند.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
