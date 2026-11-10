#!/usr/bin/env node
/**
 * تست سرتاسری «دفتر خرید» (خواسته مالک ۱۰-۱۱ دور ۵) — قرینهٔ test-catalog.
 * اجرا: node scripts/test-buyer-book.mjs   (پیش‌نیاز: سرور روی :4000)
 * مسیر پایه با BOOK_TEST_BASE قابل تغییر است.
 *
 * قرارداد: خریدار دفتر خرید دارد (/b/{bookId}) که فروشندهٔ دارندهٔ بسته
 * ذخیره می‌کند. اندپوینت‌ها getMySettings / updateSettings / resolvePublicId /
 * getPublic / isSaved / toggleSave / getMySaved هستند — عین استاب سندباکس
 * (megan-web/scripts/stub-backend.mjs) و لایهٔ فرانت (src/lib/mock/api.ts).
 *
 * جریان: سه کاربر تستی (خریدار/فروشندهٔ بسته‌دار/بدون بسته) → آیدی تصادفی
 * پیش‌فرض → ولیدیشن و یکتایی آیدی دلخواه → رزولو عمومی → گیت NEED_PACKAGE →
 * ذخیره/دفترچهٔ فروشنده → bookId روی آیتم‌های دایرکتوری → آپلود ۴فایلی احراز
 * (رفع MULTIPART_TRUNCATED) → پاک‌سازی کامل (cascade خودش همه‌چیز را می‌برد).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const BASE = process.env.BOOK_TEST_BASE ?? 'http://localhost:4000/api/v1';
const BUYER_PHONE = '09160001111'; // خریدار — صاحب دفتر
const SELLER_PHONE = '09160002222'; // فروشندهٔ بسته‌دار — ذخیره‌کننده
const NOPKG_PHONE = '09160003333'; // بینندهٔ بدون بسته — باید NEED_PACKAGE بگیرد
const CUSTOM_ID = 'phaksh-e2e'; // آیدی دلخواه تست

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

async function login(phone) {
  const r = await post('/auth/login', { phone });
  if (!r.json?.data?.accessToken) throw new Error(`ورود ${phone} ناموفق: ${JSON.stringify(r.json)}`);
  return r.json.data.accessToken;
}

/** دیتای تستی — کاربران با login ساخته می‌شوند؛ اینجا فقط seed وابسته‌ها */
async function prisma() {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient();
}

/** ساخت درخت دستهٔ نمونه + کالاهای دفتر خریدار + بستهٔ فعال فروشنده */
async function seed(buyerId, sellerId) {
  const p = await prisma();
  try {
    // درخت: کشاورزی > میوه > (سیب | پرتقال | لیمو)
    const cats = [
      { id: 909001, parentId: null, categoryName: 'محصولات کشاورزی', slug: 'e2e-agri', unit: 'کیلوگرم' },
      { id: 909002, parentId: 909001, categoryName: 'میوه', slug: 'e2e-fruit', unit: 'کیلوگرم' },
      { id: 909003, parentId: 909002, categoryName: 'سیب', slug: 'e2e-apple', unit: 'کیلوگرم', example: 'قرمز' },
      { id: 909004, parentId: 909002, categoryName: 'پرتقال', slug: 'e2e-orange', unit: 'کیلوگرم' },
      { id: 909005, parentId: 909002, categoryName: 'لیمو', slug: 'e2e-lemon', unit: 'کیلوگرم' },
    ];
    for (const { id, ...mutable } of cats) {
      await p.category.upsert({ where: { id }, create: { id, ...mutable }, update: mutable });
    }

    // کالاهای دفتر خریدار: دو تاییدشده + یک در انتظار (عمومی نباید ببیند)
    await p.buyerCategory.createMany({
      data: [
        { userId: buyerId, categoryId: 909003, volumeMin: 800, period: 'weekly', unit: 'کیلوگرم', status: 'confirmed' },
        { userId: buyerId, categoryId: 909004, volumeMin: 500, period: 'monthly', unit: 'کیلوگرم', status: 'confirmed' },
        { userId: buyerId, categoryId: 909005, volumeMin: 100, period: 'monthly', unit: 'کیلوگرم', status: 'pending' },
      ],
    });

    // بستهٔ فعال فروشنده (یک‌ساله) + سابقهٔ خریدار
    await p.user.update({
      where: { id: sellerId },
      data: { activePakageType: 3, packageExpiresAt: new Date(Date.now() + 365 * 86_400_000) },
    });
    await p.user.update({
      where: { id: buyerId },
      data: { firstName: 'پرنس', lastName: 'خریداری', lastSeenAt: new Date() },
    });
  } finally {
    await p.$disconnect();
  }
}

async function cleanup() {
  const p = await prisma();
  try {
    const del = await p.user.deleteMany({ where: { phone: { in: [BUYER_PHONE, SELLER_PHONE, NOPKG_PHONE] } } });
    await p.category.deleteMany({ where: { id: { in: [909001, 909002, 909003, 909004, 909005] } } });
    return del.count;
  } finally {
    await p.$disconnect();
  }
}

/** تصویر JPEG واقعی با نویز — حجم هدف برای تست سقف بدنه (sharp موجود ریپو).
 *  نویز فشرده نمی‌شود پس ابعاد ↔ حجم تقریباً خطی است؛ چند دور تنظیم تا
 *  بازهٔ هدف (~۱.۸MB، زیر سقف per-file ۵MB، بالای سقف بدنهٔ قدیمی). */
async function makeJpeg(targetKb) {
  const sharp = (await import('sharp')).default;
  let w = 2000;
  let h = 1300;
  for (let attempt = 0; attempt < 6; attempt++) {
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i += 65536) {
      crypto.getRandomValues(new Uint8Array(noise.buffer, i, Math.min(65536, noise.length - i)));
    }
    const buf = await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 96 })
      .toBuffer();
    const kb = buf.length / 1024;
    if (kb > targetKb * 0.8 && kb < 4500) return buf;
    const scale = Math.max(0.2, Math.min(4, Math.sqrt(targetKb / kb)));
    w = Math.max(200, Math.round(w * scale));
    h = Math.max(130, Math.round(h * scale));
  }
  throw new Error('ساخت تصویر تستی با حجم هدف ممکن نشد');
}

async function main() {
  await cleanup();
  console.log('── پاک‌سازی آغازین انجام شد؛ ورود کاربران تستی…');

  const [buyerToken, sellerToken, nopkgToken] = await Promise.all([
    login(BUYER_PHONE),
    login(SELLER_PHONE),
    login(NOPKG_PHONE),
  ]);
  const p = await prisma();
  const [buyer, seller] = await Promise.all([
    p.user.findUniqueOrThrow({ where: { phone: BUYER_PHONE }, select: { id: true, userName: true } }),
    p.user.findUniqueOrThrow({ where: { phone: SELLER_PHONE }, select: { id: true, userName: true } }),
  ]);
  const nopkg = await p.user.findUniqueOrThrow({ where: { phone: NOPKG_PHONE }, select: { userName: true } });
  await p.$disconnect();
  await seed(buyer.id, seller.id);
  console.log(`── seed شد؛ خریدار=${buyer.userName} فروشنده=${seller.userName}\n`);

  // ─── ۱) getMySettings — پیش‌فرض تصادفی ───────────────────────────────
  let r = await post('/buyerBook/getMySettings', {}, buyerToken);
  const def = r.json?.data?.settings;
  show('getMySettings: پاسخ ۲xx', r.status >= 200 && r.status < 300, `status=${r.status}`);
  show(
    'getMySettings: آیدی پیش‌فرض تصادفی (b + ۶ نویسه)',
    /^b[a-z0-9]{5,9}$/.test(def?.bookId ?? ''),
    def?.bookId,
  );
  show(
    'getMySettings: رنگ/لوگو پیش‌فرض null',
    def?.brandColor == null && def?.logo == null,
  );

  // ─── ۲) updateSettings — ولیدیشن و یکتایی ────────────────────────────
  r = await post('/buyerBook/updateSettings', { bookId: 'X!' }, buyerToken);
  show('updateSettings: آیدی نامعتبر → ۴۰۰', r.status === 400, r.json?.message);
  r = await post('/buyerBook/updateSettings', { bookId: '-abc-' }, buyerToken);
  show('updateSettings: خط تیره ابتدا/انتها → ۴۰۰', r.status === 400, r.json?.message);
  r = await post('/buyerBook/updateSettings', { brandColor: 'red' }, buyerToken);
  show('updateSettings: رنگ نامعتبر → ۴۰۰', r.status === 400, r.json?.message);
  r = await post('/buyerBook/updateSettings', { logo: 'x'.repeat(601) }, buyerToken);
  show('updateSettings: لوگوی بلند → ۴۰۰', r.status === 400, r.json?.message);

  r = await post(
    '/buyerBook/updateSettings',
    { bookId: CUSTOM_ID, brandColor: '#0891b2' },
    buyerToken,
  );
  const st = r.json?.data?.settings;
  show(
    'updateSettings: آیدی دلخواه + رنگ برند ذخیره شد',
    r.status >= 200 && r.status < 300 && st?.bookId === CUSTOM_ID && st?.brandColor === '#0891b2',
    JSON.stringify(st),
  );

  r = await post('/buyerBook/updateSettings', { bookId: CUSTOM_ID }, sellerToken);
  show('updateSettings: آیدی تکراری توسط دیگران → ۴۰۹', r.status === 409, r.json?.message);
  r = await post('/buyerBook/updateSettings', { bookId: buyer.userName }, sellerToken);
  show('updateSettings: userName دیگری به‌عنوان آیدی → ۴۰۹', r.status === 409, r.json?.message);
  r = await post('/buyerBook/updateSettings', { brandColor: '' }, buyerToken);
  show(
    'updateSettings: پاک‌کردن رنگ (رشتهٔ خالی) → null',
    r.status >= 200 && r.status < 300 && r.json?.data?.settings?.brandColor == null,
  );
  await post('/buyerBook/updateSettings', { brandColor: '#0891b2' }, buyerToken);

  // ─── ۳) resolvePublicId — عمومی بدون ورود ────────────────────────────
  r = await post('/buyerBook/resolvePublicId', { id: CUSTOM_ID });
  show(
    'resolvePublicId: آیدی دلخواه → userName + تنظیمات',
    r.status >= 200 && r.status < 300 && r.json?.data?.userName === buyer.userName && r.json?.data?.settings?.bookId === CUSTOM_ID,
    r.json?.data?.userName,
  );
  show('resolvePublicId: نام نمایشی خریدار', r.json?.data?.name === 'پرنس خریداری', r.json?.data?.name);
  r = await post('/buyerBook/resolvePublicId', { id: buyer.userName });
  show(
    'resolvePublicId: userName هم رزولو می‌شود',
    r.status >= 200 && r.status < 300 && r.json?.data?.userName === buyer.userName,
  );
  r = await post('/buyerBook/resolvePublicId', { id: 'nobody-here-404' });
  show('resolvePublicId: ناشناخته → null', r.status >= 200 && r.status < 300 && r.json?.data === null);

  // ─── ۴) getPublic — گیت بستهٔ فعال ───────────────────────────────────
  r = await post('/buyerBook/getPublic', { id: CUSTOM_ID }, buyerToken);
  const pub = r.json?.data;
  show('getPublic (صاحب دفتر): ۲xx', r.status >= 200 && r.status < 300, `status=${r.status}`);
  show(
    'getPublic: فقط ۲ کالای تاییدشده (pending پنهان)',
    Array.isArray(pub?.items) && pub.items.length === 2 && pub.items.every((i) => i.status === 'confirmed'),
    `items=${pub?.items?.length}`,
  );
  const apple = pub?.items?.find((i) => i.categoryId === 909003);
  show(
    'getPublic: شکل کالا (نام/ریشه/پدر/نوع/مثال)',
    apple?.name === 'سیب' && apple?.rootName === 'محصولات کشاورزی' && apple?.parentName === 'میوه' && apple?.example === 'قرمز',
    JSON.stringify(apple),
  );
  show(
    'getPublic: کارت هویت خریدار (نام/شهر/روزها/حضور)',
    pub?.buyer?.userName === buyer.userName &&
      typeof pub?.buyer?.daysInImach === 'number' &&
      typeof pub?.buyer?.activeRecently === 'boolean' &&
      ['عمده‌خریدار', 'خرده‌خریدار'].includes(pub?.buyer?.role),
    `role=${pub?.buyer?.role}`,
  );
  show(
    'getPublic: نقش از حجم خرید (۸۰۰ کیلو هفتگی = عمده؟ نه — زیر تن)',
    pub?.buyer?.role === 'خرده‌خریدار',
    pub?.buyer?.role,
  );
  show('getPublic: saversCount صفر (هنوز کسی ذخیره نکرده)', pub?.saversCount === 0, `${pub?.saversCount}`);
  show(
    'getPublic: تنظیمات برند همراه است',
    pub?.settings?.bookId === CUSTOM_ID && pub?.settings?.brandColor === '#0891b2',
  );

  r = await post('/buyerBook/getPublic', { id: CUSTOM_ID }, nopkgToken);
  show(
    'getPublic (بدون بسته): ۴۰۳ NEED_PACKAGE',
    r.status === 403 && r.json?.code === 'NEED_PACKAGE',
    `${r.status} ${r.json?.code}`,
  );
  r = await post('/buyerBook/getPublic', { id: CUSTOM_ID }, sellerToken);
  show('getPublic (فروشندهٔ بسته‌دار): ۲۰۰', r.status >= 200 && r.status < 300 && r.json?.data?.items?.length === 2);
  r = await post('/buyerBook/getPublic', { id: 'nobody-here-404' }, sellerToken);
  show('getPublic: ناشناخته → null', r.status >= 200 && r.status < 300 && r.json?.data === null);

  // ─── ۵) ذخیرهٔ فروشنده — isSaved / toggleSave / getMySaved ───────────
  r = await post('/buyerBook/isSaved', { userName: buyer.userName }, sellerToken);
  show('isSaved: اول false', r.status >= 200 && r.status < 300 && r.json?.data?.saved === false);
  r = await post('/buyerBook/toggleSave', { userName: buyer.userName }, sellerToken);
  show('toggleSave: ذخیره → true', r.status >= 200 && r.status < 300 && r.json?.data?.saved === true);
  r = await post('/buyerBook/isSaved', { userName: buyer.userName }, sellerToken);
  show('isSaved: حالا true', r.json?.data?.saved === true);

  r = await post('/buyerBook/getPublic', { id: CUSTOM_ID }, sellerToken);
  show('getPublic: saversCount یک شد', r.json?.data?.saversCount === 1, `${r.json?.data?.saversCount}`);

  r = await post('/buyerBook/getMySaved', {}, sellerToken);
  const row = r.json?.data?.items?.[0];
  show(
    'getMySaved: ردیف کامل (خریدار/شهر/تعداد کالا/آیدی دفتر)',
    r.json?.data?.items?.length === 1 &&
      row?.buyerUserName === buyer.userName &&
      row?.itemCount === 2 &&
      row?.bookId === CUSTOM_ID &&
      row?.buyerName === 'پرنس خریداری',
    JSON.stringify(row),
  );

  r = await post('/buyerBook/toggleSave', { userName: buyer.userName }, sellerToken);
  show('toggleSave: حذف ذخیره → false', r.json?.data?.saved === false);
  r = await post('/buyerBook/getMySaved', {}, sellerToken);
  show('getMySaved: خالی شد', r.json?.data?.items?.length === 0);
  r = await post('/buyerBook/toggleSave', { userName: 'nobody-here-404' }, sellerToken);
  show('toggleSave: خریدار ناشناخته → ۴۰۴', r.status === 404, r.json?.message);

  // ─── ۶) دایرکتوری — لینک ظریف bookId روی کارت خریدار ────────────────
  r = await post('/buyers/directory', { s: 'سیب' });
  const dirItem = r.json?.data?.items?.find((i) => i.buyerId === buyer.id);
  show(
    'directory: آیتم خریدار با bookId سفارشی',
    !!dirItem && dirItem.bookId === CUSTOM_ID,
    dirItem ? `bookId=${dirItem.bookId}` : 'آیتم پیدا نشد',
  );

  // ─── ۷) کاتالوگ — سلامت اندپوینت‌های دور ۳/۴ (کنترل هم‌زمان) ────────
  r = await post('/catalog/getMySettings', {}, sellerToken);
  show('catalog/getMySettings: ۲۰۰', r.status >= 200 && r.status < 300 && !!r.json?.data?.settings?.catalogId);
  r = await post('/catalog/updateSettings', { brandName: 'فروشگاه تست' }, sellerToken);
  show(
    'catalog/updateSettings: ذخیرهٔ نام برند',
    r.status >= 200 && r.status < 300 && r.json?.data?.settings?.brandName === 'فروشگاه تست',
  );

  // ─── ۸) احراز هویت — آپلود ۴ فایل در یک درخواست (رفع MULTIPART_TRUNCATED) ──
  const jpeg = await makeJpeg(1800); // ~۱.۸MB × ۴ ≈ ۷.۲MB — بالای سقف بدنهٔ قدیمی ۶MB
  const form = new FormData();
  form.append('nationalCardFront', new Blob([jpeg], { type: 'image/jpeg' }), 'front.jpg');
  form.append('nationalCardBack', new Blob([jpeg], { type: 'image/jpeg' }), 'back.jpg');
  form.append('selfieWithCard', new Blob([jpeg], { type: 'image/jpeg' }), 'selfie.jpg');
  form.append('registrationNotice', new Blob([jpeg], { type: 'image/jpeg' }), 'license.jpg');
  const vres = await fetch(BASE + '/verification/submitVerification', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sellerToken}` },
    body: form,
  });
  const vjson = await vres.json().catch(() => null);
  show(
    `submitVerification: ۴ فایل (~${(jpeg.length * 4 / 1024 / 1024).toFixed(1)}MB) موفق`,
    vres.status >= 200 && vres.status < 300 && vjson?.data?.status === 'pending' && !!vjson?.data?.orderId,
    `status=${vres.status} code=${vjson?.code ?? '—'} msg=${vjson?.message ?? ''}`,
  );
  r = await post('/verification/getMyVerification', {}, sellerToken);
  const docs = r.json?.data?.docs ?? {};
  show(
    'getMyVerification: هر ۴ مدرک چسبیده',
    !!docs.nationalCardFront && !!docs.nationalCardBack && !!docs.selfieWithCard && !!docs.registrationNotice,
    Object.keys(docs).join(','),
  );

  // ─── پاک‌سازی پایانی ──────────────────────────────────────────────────
  const removed = await cleanup();
  console.log(`\n── پاک‌سازی پایانی: ${removed} کاربر تستی حذف شد (cascade)`);
  console.log(`\nنتیجه: ${passed} موفق / ${failed} ناموفق`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
