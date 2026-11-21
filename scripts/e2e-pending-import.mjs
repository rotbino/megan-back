/**
 * E2E تسک ۲۲-۱۱ — «کاربران در انتظار ایمپورت» روی بک لوکال :4000 (Atlas واقعی):
 *   ۱) pending خالی/پر — لیست ماندگار از دیتابیس
 *   ۲) خودترمیمی: رکوردی که کاربرش ایمچ کامل شده موقع خواندن حذف می‌شود
 *   ۳) اسکن کوچک واقعی (بدون کوکی، بدون آپدیت قیمت) — ثبت کاربران جدید
 *   ۴) شبیه‌سازی «گرفتن موبایل»: ذخیرهٔ شماره روی رکورد → لیست نشانش می‌دهد
 *   ۵) پاکسازی دادهٔ آزمایشی
 * فقط خواندن/نوشتن رکوردهای آزمایشی خودش؛ سهمیهٔ کوکی باسکول مصرف نمی‌شود.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env', override: true });
const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:4000/api/v1/importer/update';
const ADMIN = process.env.IMPORTER_ADMIN_PHONE ?? '09196421264';
const TEST_BID = 999_000_001;

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminPhone: ADMIN, ...body }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j?.data ?? j;
};

const step = (n, ok, extra = '') => console.log(`${ok ? '✓' : '✖'} ${n}${extra ? ` — ${extra}` : ''}`);
let failed = 0;
const check = (n, ok, extra) => {
  step(n, ok, extra);
  if (!ok) failed++;
};

try {
  // ── ۰. سلامت سرور ──
  const h = await fetch('http://127.0.0.1:4000/api/v1/health', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
  check('0. سرور بالاست', true, `health=${JSON.stringify(h).slice(0, 60)}`);

  // ── ۱. لیست اولیه ──
  const p0 = await post('/pending', {});
  check('1a. pending جواب داد', Array.isArray(p0.users), `${p0.users.length} رکورد؛ removedImported=${p0.removedImported}`);
  const before = p0.users.length;

  // ── ۲. خودترمیمی: رکورد با کاربرِ از-قبل-ایمپورت‌شده ──
  const importedUser = await prisma.user.findFirst({
    where: { bUserName: { not: null }, failedImport: false },
    select: { bUserName: true },
  });
  if (importedUser?.bUserName) {
    await prisma.pendingImportUser.create({
      data: {
        bUserId: TEST_BID,
        bUserName: importedUser.bUserName,
        firstName: 'تست',
        lastName: 'خودترمیمی',
        sampleProductId: 1,
        sampleProductName: 'تست',
      },
    });
    const p1 = await post('/pending', {});
    const gone = !p1.users.some((u) => u.bUserId === TEST_BID);
    check('2. خودترمیمی: رکورد کاربرِ ایمپورت‌شده حذف شد', gone && p1.removedImported >= 1, `removedImported=${p1.removedImported}`);
  } else {
    check('2. خودترمیمی (بدون کاربر نمونه — رد شد)', false, 'کاربر ایمپورت‌شده پیدا نشد');
  }

  // ── ۳. رکورد آزمایشی غایب + شبیه‌سازی گرفتن موبایل ──
  await prisma.pendingImportUser.upsert({
    where: { bUserId: TEST_BID + 1 },
    create: {
      bUserId: TEST_BID + 1,
      bUserName: 'e2e_test_user_2211',
      firstName: 'تست',
      lastName: 'انتظار',
      bCreatedAt: new Date(),
      sampleProductId: 42,
      sampleProductName: 'آزمایشی',
      adsSeen: 3,
    },
    update: {},
  });
  const p2 = await post('/pending', {});
  const row = p2.users.find((u) => u.bUserId === TEST_BID + 1);
  check('3a. رکورد جدید در لیست هست', !!row, row ? `@${row.bUserName} • phone=${row.phone}` : '');
  check('3b. موبایل هنوز null است (بدون موبایل ثبت شده)', row?.phone == null);

  // شبیه‌سازی ذخیرهٔ شماره (همان کاری که fetchPhone با bUserName می‌کند)
  await prisma.pendingImportUser.updateMany({
    where: { bUserName: 'e2e_test_user_2211' },
    data: { phone: '09120000000', phoneTakenAt: new Date() },
  });
  const p3 = await post('/pending', {});
  const rowPhone = p3.users.find((u) => u.bUserId === TEST_BID + 1);
  check('3c. موبایل ذخیره‌شده در لیست دیده می‌شود', rowPhone?.phone === '09120000000', `phone=${rowPhone?.phone}`);

  // ── ۴. اسکن کوچک واقعی (بدون آپدیت قیمت؛ فقط ۲۰ آیتم آخر) ──
  const scan = await post('/scan', { from: 0, to: 20, updatePrices: false, recentDays: 3 });
  check(
    '4a. اسکن جواب داد',
    typeof scan.fetched === 'number' && Array.isArray(scan.newUsers),
    `fetched=${scan.fetched} • kept=${scan.kept} • newUsers=${scan.newUsers.length}`,
  );
  if (scan.newUsers.length) {
    const p4 = await post('/pending', {});
    const allThere = scan.newUsers.every((u) => p4.users.some((x) => x.bUserId === u.bUserId));
    check('4b. کاربران جدید اسکن در لیست ماندگار ثبت شدند', allThere, `${scan.newUsers.length} نفر`);
  } else {
    console.log('• 4b. در این ۲۰ آیتم کاربر جدیدی نبود (طبیعی) — ثبت لیست در ۴c آزمایش شد');
  }

  // ── ۵. پاکسازی دادهٔ آزمایشی ──
  const del = await prisma.pendingImportUser.deleteMany({
    where: { bUserName: { in: ['e2e_test_user_2211'] } },
  });
  const p5 = await post('/pending', {});
  check('5. پاکسازی آزمایشی + لیست نهایی سالم', del.count === 1 && p5.users.every((u) => u.bUserName !== 'e2e_test_user_2211'), `${p5.users.length} رکورد مانده (قبل از تست: ${before})`);

  console.log(failed === 0 ? '\nهمهٔ مراحل ✓' : `\n${failed} مرحله شکست خورد ✖`);
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  console.error('✖ خطای E2E:', err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
