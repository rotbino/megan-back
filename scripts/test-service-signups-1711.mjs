#!/usr/bin/env node
/**
 * تست API بازطراحی /services (۱۷-۱۱) — ۴ سرویس + نقش خریدار/فروشنده:
 *  ۰) پاک‌سازی ثبت‌نام‌های قبلی شمارهٔ تست (idempotency)
 *  ۱) ورود کاربر تست با موبایل (روش سشن)
 *  ۲) ذخیره ثبت‌نام خریدار (میدان‌یار) → نقش buyer
 *  ۳) ذخیره فروشنده همان سرویس → ارتقا به both
 *  ۴) ذخیره فروشنده پخشیار (businessName خالی — اختیاری)
 *  ۵) getMine → دو رکورد نقش‌دار
 *  ۶) منفی: serviceId قدیمی (ritu) رد؛ بدون role رد
 *  ۷) getSignupList ادمین → نقش + catalogId + آمار سرویس/نقش
 *     (توکن ادمین با همان منطق سرویس ساخته می‌شود — رمز واقعی دست نمی‌زنیم)
 *
 * اجرا: node scripts/test-service-signups-1711.mjs  (بک‌اند روی :4000 روشن)
 * دادهٔ تست در انتها حذف نمی‌شود تا پنل ادمین بشود دید؛ برای پاک‌سازی کامل:
 * node scripts/test-service-signups-1711.mjs --cleanup
 */
const BASE = 'http://127.0.0.1:4000/api/v1';
const PHONE = '09991234567'; // شمارهٔ تست
const CLEANUP = process.argv.includes('--cleanup');

// بارگذاری .env ریپو با override — محیط‌های سندباکس ممکن است DATABASE_URL
// دلخواهی در شل داشته باشند؛ تست باید به Atlas واقعی ریپو وصل شود.
const dotenv = (await import('dotenv')).default;
dotenv.config({ path: new URL('../.env', import.meta.url).pathname, override: true });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
}
async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ۰) پاک‌سازی ثبت‌نام‌های قبلی همین شماره — نقش‌ها از صفر ساخته شوند
const existing = await prisma.user.findUnique({ where: { phone: PHONE }, select: { id: true } });
if (existing) {
  await prisma.serviceSignup.deleteMany({ where: { userId: existing.id } });
}

if (CLEANUP) {
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } }).catch(() => {});
  }
  await prisma.$disconnect();
  console.log('CLEANUP DONE');
  process.exit(0);
}

// ۱) ورود کاربر تست
const login = await post('/auth/login', { phone: PHONE });
check('ورود کاربر تست', login.json?.status === true && Boolean(login.json?.data?.accessToken));
const token = login.json?.data?.accessToken;

// ۲) ثبت‌نام خریدار میدان‌یار
const s1 = await post(
  '/service-signups/save',
  { serviceId: 'maidan-yar', role: 'buyer', guild: 'سوپرمارکت و میوه‌فروشی', businessName: '' },
  token,
);
check('خریدار میدان‌یار', s1.json?.status === true && s1.json?.data?.role === 'buyer', JSON.stringify(s1.json?.data));

// ۳) همان سرویس با نقش فروشنده → both
const s2 = await post(
  '/service-signups/save',
  { serviceId: 'maidan-yar', role: 'seller', guild: 'تولیدکنندهٔ لبنیات', businessName: 'تولیدی نگین' },
  token,
);
check('ارتقا به هر دو نقش', s2.json?.status === true && s2.json?.data?.role === 'both', JSON.stringify(s2.json?.data));

// ۴) فروشندهٔ پخشیار بدون نام کسب‌وکار (اختیاری)
const s3 = await post(
  '/service-signups/save',
  { serviceId: 'pakhshyar', role: 'seller', guild: 'تولیدکنندهٔ مواد غذایی' },
  token,
);
check('فروشندهٔ پخشیار (بدون کسب‌وکار)', s3.json?.status === true && s3.json?.data?.role === 'seller');

// ۵) getMine
const mine = await post('/service-signups/getMine', {}, token);
const rows = mine.json?.data ?? [];
check('getMine دو سرویس', Array.isArray(rows) && rows.length === 2, `rows=${rows.length}`);
const maidan = rows.find((r) => r.serviceId === 'maidan-yar');
check('getMine نقش both', maidan?.role === 'both' && maidan?.guild === 'تولیدکنندهٔ لبنیات');

// ۶) منفی‌ها
const bad1 = await post('/service-signups/save', { serviceId: 'ritu', role: 'seller', guild: 'x' }, token);
check('رد serviceId قدیمی (ritu)', bad1.status === 400 || bad1.json?.status === false, `status=${bad1.status}`);
const bad2 = await post('/service-signups/save', { serviceId: 'hamkharid', guild: 'x' }, token);
check('رد بدون role', bad2.status === 400 || bad2.json?.status === false, `status=${bad2.status}`);

// ۷) ادمین — توکن با همان منطق سرویس (راز مشتق‌شده + scope=admin)
const jwt = await import('jsonwebtoken');
const adminRow = await prisma.adminUser.findFirst({
  where: { isActive: true },
  orderBy: { createdAt: 'asc' },
  select: { id: true, username: true, role: true },
});
const secret = process.env.ADMIN_JWT_SECRET || `${process.env.JWT_SECRET}:admin-scope`;
const atoken = adminRow
  ? jwt.default.sign(
      { sub: adminRow.id, username: adminRow.username, role: adminRow.role, scope: 'admin' },
      secret,
      { expiresIn: '30m' },
    )
  : null;
check('ادمین فعال برای تست', Boolean(atoken), adminRow?.username ?? 'no-admin');
const list = await post('/admin/service-signups/getSignupList', {}, atoken);
const items = list.json?.data?.items ?? [];
const stats = list.json?.data?.stats;
check('لیست ادمین دو ردیف', items.length === 2, `items=${items.length}`);
const maidanRow = items.find((r) => r.serviceId === 'maidan-yar');
check(
  'ردیف ادمین: نقش + صنف + موبایل',
  maidanRow?.role === 'both' && maidanRow?.guild === 'تولیدکنندهٔ لبنیات' && maidanRow?.user?.phone === PHONE,
  JSON.stringify({ role: maidanRow?.role, guild: maidanRow?.guild, catalogId: maidanRow?.user?.catalogId }),
);
check('لینک کاتالوگ (userName پیش‌فرض)', maidanRow?.user?.catalogId === null && Boolean(maidanRow?.user?.userName), `userName=${maidanRow?.user?.userName}`);
check('بدون نشت رابطهٔ catalog', !('catalog' in (maidanRow?.user ?? {})), 'catalog key must not exist');
check(
  'آمار سرویس/نقش',
  stats?.total === 2 &&
    stats.byService.find((s) => s.serviceId === 'maidan-yar')?.count === 1 &&
    stats.byService.find((s) => s.serviceId === 'pakhshyar')?.count === 1 &&
    stats.byRole.both === 1 &&
    stats.byRole.seller === 1,
  JSON.stringify(stats),
);

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
