#!/usr/bin/env node
/**
 * پاک‌سازی دیتای تست «پیشنهاد تامین — شب دوم ۱-۱۱» (بعد از browser-test):
 *  • آگهی‌های سیب قرمز تستی + بسته/کیف پول کاربر 09150000002 ریست
 *  • SupplyOfferهای همین فروشندهٔ تستی حذف
 *  • مکالمات (thread + message) میان فروشندهٔ تستی و خریداران حذف — چون کاربر
 *    تستی تازه است، هر مکالمه‌ای که او در آن باشد ساختهٔ همین تست‌هاست
 * اجرا: node scripts/offer-test-cleanup.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const login = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09150000002' }),
  }).then((r) => r.json());
  const token = login.data?.accessToken;
  if (!token) throw new Error('login failed');
  const sellerId = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub;
  console.log('sellerId:', sellerId);

  const products = await prisma.product.deleteMany({ where: { userId: sellerId } });
  const offers = await prisma.supplyOffer.deleteMany({ where: { sellerId } });
  const threadsAsSeller = await prisma.chatThread.findMany({
    where: { OR: [{ sellerId }, { buyerId: sellerId }] },
    select: { id: true },
  });
  const threadIds = threadsAsSeller.map((t) => t.id);
  const messages = await prisma.chatMessage.deleteMany({ where: { threadId: { in: threadIds } } });
  const threads = await prisma.chatThread.deleteMany({ where: { id: { in: threadIds } } });

  // یداچ‌های تستی جلسات قبل — میرعلی (09144133782) به‌عنوان فروشندهٔ آزمایشی به
  // سعید پیشنهاد فرستاده بود؛ همان یک ردیف + گفتگوی مستقیمشان پاک می‌شود
  // (دفتر خرید و بستهٔ میرعلی دست‌نخورده می‌ماند)
  const mirali = await prisma.user.findFirst({ where: { phone: '09144133782' } });
  let oldTest = { offers: 0, threads: 0, messages: 0 };
  if (mirali) {
    const oldOffers = await prisma.supplyOffer.findMany({
      where: { sellerId: mirali.id },
      select: { threadId: true },
    });
    const oldThreadIds = [
      ...new Set(oldOffers.map((o) => o.threadId).filter(Boolean)),
    ];
    oldTest = {
      offers: (await prisma.supplyOffer.deleteMany({ where: { sellerId: mirali.id } })).count,
      messages: (await prisma.chatMessage.deleteMany({ where: { threadId: { in: oldThreadIds } } })).count,
      threads: (await prisma.chatThread.deleteMany({ where: { id: { in: oldThreadIds } } })).count,
    };
  }

  await prisma.user.update({
    where: { id: sellerId },
    data: {
      activePakageType: 0,
      packageExpiresAt: null,
      walletBalance: 0,
      firstName: 'کاربر',
      lastName: 'تستی',
    },
  });

  console.log(
    JSON.stringify(
      {
        products: products.count,
        offers: offers.count,
        threads: threads.count,
        messages: messages.count,
        oldMiraliTest: oldTest,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
