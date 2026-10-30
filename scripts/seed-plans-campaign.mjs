#!/usr/bin/env node
/**
 * بذر ۳۱-۱۰ — بسته‌های دوبرابرشده + کمپین آغاز فعالیت ایمچ + رمز ادمین توسعه.
 *
 *   node scripts/seed-plans-campaign.mjs [--admin-pass 434343]
 *
 *  • سه بسته پایه با قیمت دوبرابر (p2m=398k، p6m=998k، p12m=1.598M) —
 *    کمپین ۵۰٪ آنها را به قیمت قبلی برمی‌گرداند (خواسته مالک).
 *  • کمپین زمانی «جشنواره آغاز فعالیت ایمچ» — ۵۰٪ تخفیف، ۳۰ روزه.
 *  • رمز همه ادمین‌ها → 434343 (مرحله توسعه — خواسته مالک).
 * Idempotent: بسته‌ها با upsert؛ کمپین فقط اگر هیچ کمپین فعالی نباشد.
 */
import { readFileSync } from 'node:fs';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';

const scryptAsync = promisify(scrypt);
const hashPassword = async (plain) => {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
};

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
if (!url) {
  console.error('✖ DATABASE_URL در .env یافت نشد');
  process.exit(1);
}

const client = new MongoClient(url);
await client.connect();
const db = client.db();

const FEATURES = [
  'ثبت تعداد نامحدود محصول',
  'دسترسی نامحدود به همه خریداران',
  'ثبت درخواست خرید نامحدود',
  'درج نشان فروشنده ویژه روی محصولات و پروفایل',
  'نمایش محصولات بالاتر از رقبا',
  'اولویت بررسی و پشتیبانی ویژه',
];

// ── ۱) بسته‌ها (قیمت دوبرابر — کمپین ۵۰٪ قیمت قبلی را برمی‌گرداند) ──
const plans = [
  { key: 'p2m', title: 'دو ماهه', months: 2, amount: 398_000, pakageType: 1, bestSeller: false, sortOrder: 1 },
  { key: 'p6m', title: 'شش ماهه', months: 6, amount: 998_000, pakageType: 2, bestSeller: true, sortOrder: 2 },
  { key: 'p12m', title: 'یک‌ساله', months: 12, amount: 1_598_000, pakageType: 3, bestSeller: false, sortOrder: 3 },
];
for (const p of plans) {
  await db.collection('Plan').updateOne(
    { key: p.key },
    {
      $set: { ...p, features: FEATURES, isActive: true, updated_at: new Date() },
      $setOnInsert: { soldCount: 0, created_at: new Date() },
    },
    { upsert: true },
  );
  console.log(`✅ بسته ${p.key} → ${p.amount.toLocaleString('fa-IR')} (پایه)`);
}

// ── ۲) کمپین آغاز فعالیت (۵۰٪ زمانی، ۳۰ روز) — فقط اگر فعال دیگری نیست ──
const now = new Date();
// پاک‌سازی کمپین خراب قبلی (فیلدهای camelCase اشتباه) + جست‌وجوی فعال با نام‌های map شده
await db.collection('SalesCampaign').deleteMany({ startsAt: { $ne: null } });
const activeCampaign = await db.collection('SalesCampaign').findOne({
  isActive: true,
  starts_at: { $lte: now },
  $or: [{ ends_at: null }, { ends_at: { $gt: now } }],
});
if (!activeCampaign) {
  // نام فیلدها عین @map های پرایسما (starts_at/ends_at/…) — مونگو اسکیملس است
  await db.collection('SalesCampaign').insertOne({
    title: 'جشنواره آغاز فعالیت ایمچ',
    description:
      'به مناسبت بازگشایی سایت، همه بسته‌های اشتراک ویژه با ۵۰٪ تخفیف ارائه می‌شوند — همان قیمت همیشگی، با کیفیتی که همیشه می‌خواستید!',
    type: 'time',
    discountPercent: 50,
    manual_discount_percent: null,
    starts_at: now,
    ends_at: new Date(now.getTime() + 30 * 86_400_000),
    isActive: true,
    tiers: null,
    purchase_count: 0,
    created_at: now,
    updated_at: now,
  });
  console.log('🎉 کمپین «جشنواره آغاز فعالیت ایمچ» ساخته شد (۵۰٪، ۳۰ روز)');
} else {
  console.log(`ℹ️ کمپین فعال از قبل موجود است: ${activeCampaign.title}`);
}

// ── ۳) رمز ادمین → 434343 (مرحله توسعه) ──
const passIdx = process.argv.indexOf('--admin-pass');
const adminPass = passIdx > -1 ? process.argv[passIdx + 1] : '434343';
const admins = await db.collection('AdminUser').find({}).toArray();
for (const a of admins) {
  await db.collection('AdminUser').updateOne(
    { _id: a._id },
    { $set: { password_hash: await hashPassword(adminPass), updated_at: new Date() } },
  );
  console.log(`🔑 رمز ادمین «${a.username ?? a.userName ?? a._id}» → ${adminPass}`);
}
if (admins.length === 0) console.log('ℹ️ ادمینی در DB نیست (بوت‌استرپ خودش می‌سازد)');

await client.close();
console.log('✅ تمام شد');
