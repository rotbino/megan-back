// واقعی‌سازی پیام دو پیشنهاد تامین کاشته‌شده برای دموی مالک (جریان دفتر خرید → پیشنهادها)
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MESSAGES = {
  3: 'سیب قرمز درجه یک از باغ‌های آذربایجان — بسته‌بندی ۱۰ کیلویی، قیمت عمده توافقی. ارسال به محل شما در تهران با ما، حداقل سفارش ۱۰۰ کیلوگرم.',
  43: 'برنج هاشمی کشت اول کارون، سفیدشده و معطر — تحویل فوری از انبار تهران. چک تا ۵۰٪ مبلغ پذیرفته می‌شود، حداقل سفارش ۱۰۰ کیلوگرم.',
};

async function main() {
  const buyer = await prisma.user.findFirst({ where: { phone: '09123456789' } });
  if (!buyer) throw new Error('خریدار تست پیدا نشد');
  const offers = await prisma.supplyOffer.findMany({
    where: { buyerId: buyer.id, message: { contains: 'آزمایشی' } },
    select: { id: true, categoryId: true },
  });
  for (const o of offers) {
    const msg = MESSAGES[o.categoryId];
    if (!msg) continue;
    await prisma.supplyOffer.update({ where: { id: o.id }, data: { message: msg } });
    console.log('updated offer', o.id, 'cat', o.categoryId);
  }
  console.log('done', offers.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
