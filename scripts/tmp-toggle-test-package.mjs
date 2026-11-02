// فعال/غیرفعال‌سازی موقت بستهٔ کاربر تست (سعید محمدی 09123456789) — فقط برای
// راستی‌آزمایی نمودار دایره‌ای ایمچ من دور ۱۵؛ بعد از تست حتماً revert می‌شود
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const mode = process.argv[2] ?? 'on'; // on | off
const PHONE = '09123456789';
const DAY = 86_400_000;

async function main() {
  const u = await prisma.user.findFirst({ where: { phone: PHONE } });
  if (!u) throw new Error('کاربر تست پیدا نشد');
  if (mode === 'on') {
    const startedAt = new Date(Date.now() - 5 * DAY);
    const packageExpiresAt = new Date(startedAt.getTime() + 60 * DAY);
    await prisma.user.update({
      where: { id: u.id },
      data: { activePakageType: 1, packageStartedAt: startedAt, packageExpiresAt: packageExpiresAt },
    });
    console.log('ON: نوع ۱ (دو ماهه)، شروع ۵ روز پیش → ~۵۵ روز مانده از ۶۰');
  } else {
    await prisma.user.update({
      where: { id: u.id },
      data: { activePakageType: 0, packageStartedAt: null, packageExpiresAt: null },
    });
    console.log('OFF: بازگشت به رایگان');
  }
  const after = await prisma.user.findUnique({
    where: { id: u.id },
    select: { activePakageType: true, packageStartedAt: true, packageExpiresAt: true },
  });
  console.log(JSON.stringify(after, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
