#!/usr/bin/env node
/**
 * تست سرتاسری «کاتالوگ محصول» (خواسته مالک ۱۰-۱۱).
 * اجرا: node scripts/test-catalog.mjs   (پیش‌نیاز: سرور روی :4000)
 * مسیر پایه با CATALOG_TEST_BASE قابل تغییر است.
 *
 * جریان: دو کاربر تستی (فروشنده/خریدار) → ساخت کاتالوگ → ویرایش آیدی و
 * رنگ → صفحهٔ عمومی → ذخیره/دفترچه/ذخیره‌کنندگان → فیلد catalog در
 * getSeller → پاک‌سازی کامل کاربران تستی (cascade خودش کاتالوگ را می‌برد).
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
  return { token: r.json.data.accessToken, isNewUser: r.json.data.isNewUser, hasPassword: r.json.data.hasPassword };
}

async function main() {
  await cleanup(); // بقایای اجرای قبلیِ نیمه‌کاره

  const seller = await login(SELLER_PHONE);
  const buyer = await login(BUYER_PHONE);
  show('ورود دو کاربر تستی (بدون رمز)', seller.isNewUser === true && buyer.isNewUser === true);

  const pageId = `test-catalog-${Math.floor(1000 + Math.random() * 8999)}`;

  // ── checkPageId ──
  const badId = await post('/catalog/checkPageId', { pageId: 'XX' });
  show('checkPageId قالب نامعتبر → available:false (عمومی)', badId.json?.data?.available === false);
  const freeId = await post('/catalog/checkPageId', { pageId });
  show('checkPageId آزاد → available:true', freeId.json?.data?.available === true);

  // ── create: اعتبارسنجی ──
  const badCreate = await post('/catalog/create', { pageId: 'AB' }, seller.token);
  show('create آیدی نامعتبر → 400 INVALID_PAGE_ID', badCreate.status === 400 && badCreate.json?.code === 'INVALID_PAGE_ID');
  const badWa = await post('/catalog/create', { pageId, whatsappNumber: '12345' }, seller.token);
  show('create واتساپ خراب → 400 INVALID_WHATSAPP', badWa.status === 400 && badWa.json?.code === 'INVALID_WHATSAPP');
  const noAuth = await post('/catalog/create', { pageId });
  show('create بدون ورود → 401 فارسی', noAuth.status === 401 && noAuth.json?.status === false);

  // ── create: موفق ──
  const created = await post(
    '/catalog/create',
    { pageId, brandColor: '#7c3aed', instagramId: '@test.shop', whatsappNumber: '۰۹۱۵۰۰۰۱۲۳۴' },
    seller.token,
  );
  show(
    'create → کاتالوگ با نرمال‌سازی اینستاگرام/واتساپ فارسی',
    created.json?.status === true &&
      created.json?.data?.pageId === pageId &&
      created.json?.data?.brandColor === '#7c3aed' &&
      created.json?.data?.instagramId === 'test.shop' &&
      created.json?.data?.whatsappNumber === '09150001234',
  );

  // ── یکتایی ──
  const again = await post('/catalog/create', { pageId: `${pageId}-x` }, seller.token);
  show('create دومین بار → 409 CATALOG_EXISTS', again.status === 409 && again.json?.code === 'CATALOG_EXISTS');
  const taken = await post('/catalog/checkPageId', { pageId }, buyer.token);
  show('checkPageId آیدی گرفته‌شده → available:false', taken.json?.data?.available === false);

  // ── getMine ──
  const mine = await post('/catalog/getMine', {}, seller.token);
  show('getMine → همان کاتالوگ', mine.json?.data?.pageId === pageId && mine.json?.data?.updatedAt === null);

  // ── update: آیدی جدید + رنگ + پاک‌کردن اینستاگرام ──
  const pageId2 = `${pageId}-v2`;
  const updated = await post(
    '/catalog/update',
    { pageId: pageId2, brandColor: '#0891b2', instagramId: null },
    seller.token,
  );
  show(
    'update → آیدی جدید + رنگ + حذف اینستاگرام + مهر updatedAt',
    updated.json?.data?.pageId === pageId2 &&
      updated.json?.data?.brandColor === '#0891b2' &&
      updated.json?.data?.instagramId === null &&
      !!updated.json?.data?.updatedAt,
  );
  const oldPage = await post('/catalog/getByPageId', { pageId });
  show('getByPageId آیدی قدیمی → null (۴۰۴ فرانت)', oldPage.json?.data === null);

  // ── صفحهٔ عمومی (بدون توکن) ──
  const pub = await post('/catalog/getByPageId', { pageId: pageId2 });
  show(
    'getByPageId عمومی → catalog + userName + saversCount',
    pub.json?.data?.catalog?.pageId === pageId2 && !!pub.json?.data?.userName && pub.json?.data?.saversCount === 0,
  );

  // ── ذخیرهٔ خریدار ──
  const before = await post('/catalog/isSaved', { pageId: pageId2 }, buyer.token);
  show('isSaved اولیه → false', before.json?.data?.saved === false);
  const toggled = await post('/catalog/toggleSave', { pageId: pageId2 }, buyer.token);
  show('toggleSave → true', toggled.json?.data?.saved === true);
  const after = await post('/catalog/isSaved', { pageId: pageId2 }, buyer.token);
  show('isSaved بعد از ذخیره → true', after.json?.data?.saved === true);

  const savers = await post('/catalog/getSavers', { pageId: pageId2 });
  show(
    'getSavers عمومی → شمار و ردیف خریدار',
    savers.json?.data?.count === 1 && savers.json?.data?.items?.[0]?.userName != null,
  );

  const savedList = await post('/catalog/getMySaved', {}, buyer.token);
  const savedRow = savedList.json?.data?.items?.[0];
  show(
    'getMySaved → دفترچهٔ خریدار (pageId + فروشنده + شمار محصول)',
    savedList.json?.status === true &&
      savedRow?.pageId === pageId2 &&
      !!savedRow?.sellerUserName &&
      savedRow?.productCount === 0,
  );

  const pub2 = await post('/catalog/getByPageId', { pageId: pageId2 });
  show('getByPageId بعد از ذخیره → saversCount:1', pub2.json?.data?.saversCount === 1);

  // ── فیلد catalog در getSeller (کش باید بی‌اعتبار شده باشد) ──
  const sellerProfile = await post('/products/getSeller', { userName: pub.json.data.userName });
  show(
    'getSeller → user.catalog.pageId (کش تازه)',
    sellerProfile.json?.data?.user?.catalog?.pageId === pageId2,
  );

  // ── حذف ذخیره + پاک‌سازی ──
  const untoggled = await post('/catalog/toggleSave', { pageId: pageId2 }, buyer.token);
  show('toggleSave دوباره → حذف ذخیره', untoggled.json?.data?.saved === false);

  const removed = await cleanup();
  show('پاک‌سازی کاربران تستی (cascade کاتالوگ/ذخیره‌ها)', removed >= 2, `users=${removed}`);
  const gone = await post('/catalog/getByPageId', { pageId: pageId2 });
  show('کاتالوگ پس از حذف کاربر → null', gone.json?.data === null);

  console.log(`\n${failed === 0 ? '✅ همه پاس شد' : '❌ خرابی دارد'} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('✖ خطای تست:', err.message);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
