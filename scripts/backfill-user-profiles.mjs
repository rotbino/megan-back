/**
 * backfill-user-profiles.mjs — نام/نام‌خانوادگی/استان/شهر برای کاربران بی‌نام.
 *
 * چرا؟ کاربران تستی seed شده بدون نام بودند و در پنل/پروفایل «واقعی»
 * به نظر نمی‌رسیدند (خواسته صریح کاربر در فاز تست). این اسکریپت:
 *   • برای هر کاربر بدون firstName، نام و نام‌خانوادگی فارسی واقعی
 *     از استخر نام‌ها می‌گذارد (deterministic بر اساس هش شماره موبایل —
 *     اجرای مجدد همان نام را می‌دهد، نه نام تصادفی تازه).
 *   • استان و شهر واقعی از جدول Location (فعال) می‌گذارد؛ برای
 *     کاربرانی که محصول تأییدشده دارند، استانِ پرتکرار آگهی‌هایشان.
 *   • isSeller=true برای دارندگان آگهی (پنل فروشنده درست نمایش داده شود).
 * idempotent است — کاربرانی که از قبل نام دارند دست نمی‌خورند.
 *
 * اجرا: node scripts/backfill-user-profiles.mjs [--dry]
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/DATABASE_URL="([^"]+)"/)[1];

const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const DRY = process.argv.includes('--dry');

// ─── استخر نام‌های فارسی رایج (ترکیب‌ها طبیعی و متنوع) ─────────────────────
const FIRST_M = [
  'علی', 'محمد', 'حسین', 'رضا', 'مهدی', 'امیر', 'سعید', 'حمید', 'کاظم', 'جواد',
  'مجید', 'مسعود', 'بهنام', 'فرهاد', 'کاریم', 'یاسر', 'میلاد', 'سینا', 'پیمان', 'بابک',
  'اکبر', 'ابراهیم', 'اصغر', 'یدالله', 'نورالله', 'مصطفی', 'احمد', 'محسن', 'قاسم', 'داوود',
];
const FIRST_F = [
  'فاطمه', 'زهرا', 'مریم', 'زهرا', 'نرگس', 'سمانه', 'الهام', 'لیلا', 'مینا', 'شیرین',
  'پریسا', 'نیلوفر', 'سارا', 'هنرمند', 'گلناز', 'Mahsa', 'محبوبه', 'رحیمه', 'سمیه', 'حوریه',
].map((n) => (n === 'Mahsa' ? 'مهسا' : n));
const LAST = [
  'احمدی', 'محمدی', 'حسینی', 'رضایی', 'موسوی', 'کریمی', 'صادقی', 'جعفری', 'نوری', 'قاسمی',
  'شریفی', 'سلطانی', 'مرادی', 'رستمی', 'کاظمی', 'زمانی', 'تهرانی', 'شیرازی', 'اصفهانی', 'یزدی',
  'خراسانی', 'بلوچ', 'ترکمن', 'قشقایی', 'لرستانی', 'امینی', 'حیدری', 'نجفی', 'طاهری', 'عباسی',
  'فرهمند', 'نیک‌پور', 'صالحی', 'جهانگیری', 'پورعباس', 'سیدزاده', 'دامن‌افشان', 'اکبری', 'فتحی', 'ملکی',
];

/** انتخاب deterministic — همان ورودی همیشه همان خروجی */
function pick(arr, seed, salt) {
  const h = createHash('sha256').update(`${salt}:${seed}`).digest();
  return arr[h[0] % arr.length];
}

// ─── استان/شهرهای فعال ───────────────────────────────────────────────────────
const provinces = await p.location.findMany({
  where: { type: 'province', isActive: true },
  select: { id: true, buskolId: true, name: true },
});
const cities = await p.location.findMany({
  where: { type: 'city', isActive: true },
  select: { id: true, buskolId: true, parentId: true, name: true },
});
const citiesByParent = new Map();
for (const c of cities) {
  const pid = c.parentId?.split(':')[1];
  if (!pid) continue;
  if (!citiesByParent.has(pid)) citiesByParent.set(pid, []);
  citiesByParent.get(pid).push(c);
}

// ─── کاربران نیازمند تکمیل: (۱) بی‌نام (۲) بدون استان ─────────────────────
// ⚠️ quirk مهم Prisma+MongoDB: فیلتر `field: null` فقط null صریح را می‌گیرد،
// نه فیلد غایب — باید findRaw با $exists زد (۱۱۲ کاربر فیلد غایب داشتند).
const rawUsers = (await p.user.findRaw({
  filter: {
    $or: [
      { $or: [{ first_name: null }, { first_name: { $exists: false } }, { first_name: '' }] },
      { $or: [{ province_id: null }, { province_id: { $exists: false } }] },
    ],
  },
  options: { projection: { _id: 1, phone: 1, sex: 1, first_name: 1, province_id: 1 } },
})) ?? [];
const productCounts = new Map();
for (const pr of await p.product.findMany({ select: { userId: true } })) {
  productCounts.set(pr.userId, (productCounts.get(pr.userId) ?? 0) + 1);
}
const nameless = rawUsers.map((d) => {
  // _id از findRaw به شکل { $oid: '…' } می‌آید
  const rawId = d._id?.$oid ?? String(d._id);
  const firstName = typeof d.first_name === 'string' ? d.first_name : '';
  return {
    id: rawId,
    phone: d.phone,
    sex: d.sex ?? null,
    firstName,
    provinceId: typeof d.province_id === 'number' ? d.province_id : null,
    _count: { products: productCounts.get(rawId) ?? 0 },
  };
});
console.log(`کاربران نیازمند تکمیل: ${nameless.length} | استان فعال: ${provinces.length} | شهر فعال: ${cities.length}`);

// استانِ پرتکرار آگهی‌های هر کاربر (اگر آگهی دارد)
const provinceOfProduct = new Map();
const products = await p.product.findMany({
  where: { status: { not: 'deleted' } },
  select: { userId: true, provinceId: true },
});
for (const pr of products) {
  if (pr.provinceId == null) continue;
  if (!provinceOfProduct.has(pr.userId)) provinceOfProduct.set(pr.userId, new Map());
  const m = provinceOfProduct.get(pr.userId);
  m.set(pr.provinceId, (m.get(pr.provinceId) ?? 0) + 1);
}

// ─── به‌روزرسانی دسته‌ای (batch توازی ۲۵تایی — Atlas دور است) ───────────────
const tasks = [];
for (const u of nameless) {
  const isFemale = u.sex === 'خانم';
  const first = isFemale ? pick(FIRST_F, u.phone, 'f') : pick(FIRST_M, u.phone, 'f');
  const last = pick(LAST, u.phone, 'l');

  // استان: اول استانِ آگهی‌های خودش، وگرنه deterministic
  let provBuskolId = null;
  const own = provinceOfProduct.get(u.id);
  if (own && own.size > 0) {
    provBuskolId = [...own.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } else {
    provBuskolId = provinces.length
      ? pick(provinces, u.phone, 'p').buskolId
      : null;
  }
  const prov = provinces.find((x) => x.buskolId === provBuskolId) ?? null;

  // شهری از همان استان
  const provCities = prov ? (citiesByParent.get(String(prov.buskolId)) ?? []) : [];
  const city = provCities.length ? pick(provCities, u.phone, 'c') : null;

  tasks.push({
    id: u.id,
    phone: u.phone,
    label: `${u.firstName || `${first} ${last}`} | ${prov?.name ?? '—'} / ${city?.name ?? '—'}`,
    data: {
      // نام فقط برای بی‌نام‌ها — دارنده نام دست نمی‌خورد
      ...(u.firstName === '' ? { firstName: first, lastName: last } : {}),
      ...(prov ? { provinceId: prov.buskolId } : {}),
      ...(city ? { cityId: city.buskolId } : {}),
      ...(u._count.products > 0 ? { isSeller: true } : {}),
    },
  });
}

let updated = 0;
const CH = 25;
/** آپدیت با retry — write conflict روی Atlas ترنزینت است */
async function updateWithRetry(t, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await p.user.update({ where: { id: t.id }, data: t.data });
      return true;
    } catch (e) {
      if (i === tries - 1) {
        console.error('ERR', t.phone, e.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return false;
}
for (let i = 0; i < tasks.length; i += CH) {
  const chunk = tasks.slice(i, i + CH);
  await Promise.all(chunk.map((t) => (DRY ? Promise.resolve() : updateWithRetry(t))));
  updated += chunk.length;
  if (i === 0 || updated % 50 === 0) console.log(`  … ${updated}/${tasks.length} — نمونه: ${chunk[0].phone} → ${chunk[0].label}`);
}

console.log(DRY ? `[dry] به‌روزشده می‌شد: ${updated}` : `به‌روزشده: ${updated}`);
await p.$disconnect();
