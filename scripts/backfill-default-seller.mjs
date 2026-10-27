// بک‌فیل نقش پیش‌فرض فروشنده (خواسته مالک):
// همه کاربران فعلی is_seller=true / is_buyer=false می‌شوند (پیش‌فرض پنل فروشنده)؛
// کاربر با سوییچ پنل هر نقشی را انتخاب کند همان در DB ماندگار می‌ماند.
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const res = await prisma.user.updateMany({
    where: {},
    data: { isSeller: true, isBuyer: false },
  });
  console.log(`به‌روز شد: ${res.count} کاربر → پیش‌فرض پنل فروشنده`);

  const sellers = await prisma.user.count({ where: { isSeller: true, isBuyer: false } });
  const buyers = await prisma.user.count({ where: { isBuyer: true, isSeller: false } });
  console.log(`فروشنده: ${sellers} / خریدار صریح: ${buyers}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
