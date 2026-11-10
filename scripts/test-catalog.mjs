#!/usr/bin/env node
/**
 * تست سرتاسری «کاتالوگ کاربر» (خواسته مالک ۱۰-۱۱ + بازنگری دور ۲/۳).
 * اجرا: node scripts/test-catalog.mjs   (پیش‌نیاز: سرور روی :4000)
 * مسیر پایه با CATALOG_TEST_BASE قابل تغییر است.
 *
 * قرارداد جدید: کاتالوگ فروشنده همان صفحهٔ عمومی اوست (/c/{catalogId})؛
 * کلید همه‌جا userName است و اندپوینت‌ها getMySettings / updateSettings /
 * resolvePublicId / isSaved / toggleSave / getMySaved / getSavers هستند —
 * عین استاب سندباکس (megan-web/scripts/stub-backend.mjs).
 *
 * جریان: دو کاربر تستی (فروشنده/خریدار) → پیش‌فرض‌های getMySettings →
 * ذخیرهٔ شخصی‌سازی (ولیدیشن + یکتایی آیدی) → resolvePublicId →
 * ذخیره/دفترچه/ذخیره‌کنندگان → پاک‌سازی کامل کاربران تستی (cascade خودش
 * تنظیمات/ذخیره‌ها را می‌برد).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const BASE = process.env.CATALOG_TEST_BASE ?? 'http://localhost:4000/api/v1';
const SELLER_PHONE = '09150001234'; // ثابت — پاک‌سازی آغازین/پایانی همین‌ها
const BUYER_PHONE = '09150001235';

let passed = 0;
let failed = 0;
const show = (title, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✔' : '✖'} ${title}${extra ? ` — ${extra}` : ''}`);
};

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function cleanup() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const del = await prisma.user.deleteMany({ where: { phone: { in: [SELLER_PHONE, BUYER_PHONE] } } });
  await prisma.$disconnect();
  return del.count;
}

async function login(phone) {
  const r = await post('/auth/login', { phone });
  if (!r.json?.data?.accessToken) throw new Error(`ورود ${phone} ناموفق: ${JSON.stringify(r.json)}`);
  // پاسخ login فقط توکن می‌دهد؛ userName از پیش‌فرضِ getMySettings می‌آید
  // (catalogId بدون شخصی‌سازی = userName صاحب حساب)
  const s = await post('/catalog/getMySettings', {}, r.json.data.accessToken);
  const userName = s.json?.data?.settings?.catalogId;
  if (!userName) throw new Error(`گرفتن userName ${phone} ناموفق: ${JSON.stringify(s.json)}`);
  return { token: r.json.data.accessToken, userName, isNewUser: r.json.data.isNewUser };
}

async function main() {
  await cleanup(); // بقایای اجرای قبلیِ نیمه‌کاره

  const seller = await login(SELLER_PHONE);
  const buyer = await login(BUYER_PHONE);
  show('ورود دو کاربر تستی (بدون رمز)', seller.isNewUser === true && buyer.isNewUser === true);

  // ── getMySettings: پیش‌فرض‌ها (بدون هیچ ردیفی) ──
  const noAuth = await post('/catalog/getMySettings', {});
  show('getMySettings بدون ورود → 401 فارسی', noAuth.status === 401 && noAuth.json?.status === false);

  const mine0 = await post('/catalog/getMySettings', {}, seller.token);
  const s0 = mine0.json?.data?.settings;
  show(
    'getMySettings اولیه → همه‌چیز پیش‌فرض (آیدی=userName، آیکون=store، رنگ=null)',
    mine0.json?.status === true &&
      s0?.catalogId === seller.userName &&
      typeof s0?.brandName === 'string' &&
      s0?.brandColor === null &&
      s0?.brandIcon === 'store',
    `catalogId=${s0?.catalogId}`,
  );

  // ── updateSettings: ولیدیشن ──
  const badId = await post('/catalog/updateSettings', { catalogId: 'AB' }, seller.token);
  show('updateSettings آیدی نامعتبر → 400', badId.status === 400 && badId.json?.status === false);
  const badColor = await post('/catalog/updateSettings', { brandColor: 'green' }, seller.token);
  show('updateSettings رنگ خراب → 400', badColor.status === 400 && badColor.json?.status === false);
  const badIcon = await post('/catalog/updateSettings', { brandIcon: 'XD!' }, seller.token);
  show('updateSettings آیکون نامعتبر → 400', badIcon.status === 400 && badIcon.json?.status === false);
  const longName = await post('/catalog/updateSettings', { brandName: 'برند'.repeat(15) }, seller.token);
  show('updateSettings نام برند بلند → 400', longName.status === 400 && longName.json?.status === false);

  // ── updateSettings: موفق (فقط فیلدهای ارسالی عوض می‌شوند) ──
  const customId = `test-c-${Math.floor(1000 + Math.random() * 8999)}`;
  const saved = await post(
    '/catalog/updateSettings',
    { catalogId: customId, brandName: 'هایپر تست', brandColor: '#7C3AED', brandIcon: 'shopping-basket' },
    seller.token,
  );
  const s1 = saved.json?.data?.settings;
  show(
    'updateSettings → آیدی سفارشی + برند + رنگ (نرمال lowercase) + آیکون',
    saved.json?.status === true &&
      s1?.catalogId === customId &&
      s1?.brandName === 'هایپر تست' &&
      s1?.brandColor === '#7c3aed' &&
      s1?.brandIcon === 'shopping-basket',
  );

  const mine1 = await post('/catalog/getMySettings', {}, seller.token);
  show('getMySettings بعد از ذخیره → همان مقادیر', mine1.json?.data?.settings?.catalogId === customId);

  // ── یکتایی آیدی ──
  const taken = await post('/catalog/updateSettings', { catalogId: customId }, buyer.token);
  show('آیدی تکراری → 409', taken.status === 409 && taken.json?.status === false);
  const takenUserName = await post('/catalog/updateSettings', { catalogId: buyer.userName }, seller.token);
  show('آیدی = userName دیگری → 409', takenUserName.status === 409 && takenUserName.json?.status === false);
  const ownUserName = await post('/catalog/updateSettings', { catalogId: seller.userName }, seller.token);
  show(
    'آیدی = userName خودم → مجاز؛ برگشت به پیش‌فرض',
    ownUserName.json?.data?.settings?.catalogId === seller.userName,
  );
  // دوباره سفارشی کن برای ادامهٔ تست
  await post('/catalog/updateSettings', { catalogId: customId }, seller.token);

  // ── resolvePublicId (عمومی — بدون توکن) ──
  const byCustom = await post('/catalog/resolvePublicId', { id: customId });
  show(
    'resolvePublicId آیدی سفارشی → userName + تنظیمات',
    byCustom.json?.data?.userName === seller.userName && byCustom.json?.data?.settings?.brandName === 'هایپر تست',
  );
  const byUserName = await post('/catalog/resolvePublicId', { id: seller.userName });
  show(
    'resolvePublicId userName → همان کاربر + تنظیماتش',
    byUserName.json?.data?.userName === seller.userName && byUserName.json?.data?.settings?.catalogId === customId,
  );
  const unknown = await post('/catalog/resolvePublicId', { id: 'nobody-xyz-404' });
  show('resolvePublicId ناشناخته → null (۴۰۴ فرانت)', unknown.json?.data === null);

  // ── ذخیرهٔ خریدار (کلید = userName فروشنده) ──
  const before = await post('/catalog/isSaved', { userName: seller.userName }, buyer.token);
  show('isSaved اولیه → false', before.json?.data?.saved === false);
  const toggled = await post('/catalog/toggleSave', { userName: seller.userName }, buyer.token);
  show('toggleSave → true', toggled.json?.data?.saved === true);
  const after = await post('/catalog/isSaved', { userName: seller.userName }, buyer.token);
  show('isSaved بعد از ذخیره → true', after.json?.data?.saved === true);

  const savers = await post('/catalog/getSavers', { userName: seller.userName });
  show(
    'getSavers عمومی → شمار و ردیف خریدار',
    savers.json?.data?.count === 1 && savers.json?.data?.items?.[0]?.userName === buyer.userName,
  );
  const saversUnknown = await post('/catalog/getSavers', { userName: 'nobody-xyz-404' });
  show('getSavers فروشندهٔ ناشناخته → خالی', saversUnknown.json?.data?.count === 0);

  const savedList = await post('/catalog/getMySaved', {}, buyer.token);
  const savedRow = savedList.json?.data?.items?.[0];
  show(
    'getMySaved → دفترچهٔ خریدار (فروشنده + شمار محصول)',
    savedList.json?.status === true &&
      savedRow?.sellerUserName === seller.userName &&
      savedRow?.productCount === 0,
  );

  // ── getSeller: کش باید بی‌اعتبار شده باشد و کارت سالم بماند ──
  const sellerProfile = await post('/products/getSeller', { userName: seller.userName });
  show(
    'getSeller بعد از تغییرات → پروفایل سالم (بدون فیلد مردهٔ catalog)',
    sellerProfile.json?.status === true && sellerProfile.json?.data?.user?.userName === seller.userName,
  );

  // ── حذف ذخیره + پاک‌سازی ──
  const untoggled = await post('/catalog/toggleSave', { userName: seller.userName }, buyer.token);
  show('toggleSave دوباره → حذف ذخیره', untoggled.json?.data?.saved === false);
  const emptyList = await post('/catalog/getMySaved', {}, buyer.token);
  show('getMySaved بعد از حذف → خالی', emptyList.json?.data?.items?.length === 0);

  const removed = await cleanup();
  show('پاک‌سازی کاربران تستی (cascade تنظیمات/ذخیره‌ها)', removed >= 2, `users=${removed}`);
  const gone = await post('/catalog/resolvePublicId', { id: customId });
  show('کاتالوگ پس از حذف کاربر → null', gone.json?.data === null);

  console.log(`\n${failed === 0 ? '✅ همه پاس شد' : '❌ خرابی دارد'} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('✖ خطای تست:', err.message);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
