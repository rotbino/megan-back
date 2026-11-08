/**
 * تبدیل کمپین جاری به نوع «کاربران جدید» (خواسته مالک ۹-۱۱):
 *  • type: time → new_user
 *  • newUserDays: 7 (هر کاربر تا ۷ روز پس از ثبت‌نام مهلت دارد)
 *  • newUserMaxPurchases: 3 (تا ۳ خرید بسته با تخفیف)
 *  • discountPercent: 60 (دست ادمین برای تغییر باز است)
 *  • متن/شعار جدید با محوریت انگیزه کاربران تازه‌ثبت‌نام‌کرده
 * اجرا: node scripts/convert-campaign-new-user.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

const prisma = new PrismaClient();

const TITLE = 'هدیه خوش‌آمدگویی ایمچ';
const DESCRIPTION =
  'به ایمچ خوش آمدی! به‌عنوان عضو تازه، تا ۷ روز پس از ثبت‌نام، ۶۰٪ تخفیف روی همه بسته‌های اشتراک مخصوص توست — با شمارشگر معکوس که همین بالا می‌بینی. اگر مهلت تمام شود یا سقف خرید با تخفیفت پر شود، این تخفیف برای همیشه برداشته می‌شود و تخفیف‌های مناسبتی بعدی حداکثر ۳۰٪ خواهند بود. همین حالا جمعش کن!';

async function main() {
  const campaigns = await prisma.salesCampaign.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (campaigns.length === 0) {
    console.log('✖ هیچ کمپین فعالی برای تبدیل پیدا نشد.');
    process.exit(1);
  }
  // جدیدترین کمپین فعال = همان «تخفیف خوش آمد گویی» جاری
  const target = campaigns[0];
  const updated = await prisma.salesCampaign.update({
    where: { id: target.id },
    data: {
      type: 'new_user',
      newUserDays: 7,
      newUserMaxPurchases: 3,
      discountPercent: 60,
      // درصد دستی قبلی (۶۰) همان مقدار پایه است — به حالت خودکار برمی‌گردد
      manualDiscountPercent: null,
      // شمار دستی خریداران مال کمپین تعدادی است — برای این نوع بی‌معناست
      manualPurchaseCount: null,
      title: TITLE,
      description: DESCRIPTION,
    },
  });
  console.log('✔ کمپین تبدیل شد:', JSON.stringify({
    id: updated.id,
    title: updated.title,
    type: updated.type,
    discountPercent: updated.discountPercent,
    newUserDays: updated.newUserDays,
    newUserMaxPurchases: updated.newUserMaxPurchases,
    endsAt: updated.endsAt,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error('✖', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
