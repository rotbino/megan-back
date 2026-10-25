#!/usr/bin/env node
/**
 * تست سرتاسری اندپوینت‌های فاز R0..R5 — اجرا: node scripts/test-api.mjs
 * پیش‌نیاز: سرور روی :4000 در حال اجرا (node dist/main.js) + seedها اجرا شده باشند
 */
const BASE = 'http://localhost:4000/api/v1';
const PHONE = `09123${Math.floor(100000 + Math.random() * 899999)}`; // یکتا در هر اجرا

let passed = 0;
let failed = 0;

function show(title, ok, extra = '') {
  const mark = ok ? '✔' : '✖';
  if (ok) passed++; else failed++;
  console.log(`${mark} ${title}${extra ? ` — ${extra}` : ''}`);
}

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

async function main() {
  // ── health ──
  const health = await fetch(BASE + '/health').then((r) => r.json());
  show('GET /health', health?.status === true && health?.data?.db === 'up');

  // ── validation: شماره غلط ──
  const badPhone = await post('/auth/sendOtp', { phone: '12345' });
  show('sendOtp شماره نامعتبر → 400 فارسی', badPhone.status === 400 && badPhone.json?.status === false && /موبایل/.test(badPhone.json?.message ?? ''));

  // ── sendOtp ──
  const send = await post('/auth/sendOtp', { phone: PHONE });
  const devCode = send.json?.data?.devCode;
  show('sendOtp → devCode در development', (send.status === 201 || send.status === 200) && !!devCode, `devCode=${devCode}`);
  show('sendOtp پیام فارسی', send.json?.message === 'کد تایید ارسال شد.');

  // ── verifyOtp غلط ──
  const wrong = await post('/auth/verifyOtp', { phone: PHONE, code: '00000' });
  show('verifyOtp کد غلط → 400 OTP_WRONG', wrong.status === 400 && wrong.json?.code === 'OTP_WRONG');

  // ── verifyOtp درست ──
  const verify = await post('/auth/verifyOtp', { phone: PHONE, code: devCode });
  const accessToken = verify.json?.data?.accessToken;
  const refreshToken = verify.json?.data?.refreshToken;
  show('verifyOtp → isNewUser + توکن‌ها', verify.json?.status === true && verify.json?.data?.isNewUser === true && !!accessToken && !!refreshToken);

  // ── getProfile ──
  const profile = await post('/users/getProfile', {}, accessToken);
  const userId = profile.json?.data?.user?.id;
  const userName = profile.json?.data?.user?.user_name;
  show('getProfile → user_name باسکول‌گونه', profile.json?.status === true && /^[a-z2-9]{8,12}$/.test(userName ?? ''), `userName=${userName}`);

  // ── updateProfile ──
  const upd = await post('/users/updateProfile', { first_name: 'سامی', last_name: 'جابر', sex: 'آقا', is_seller: true }, accessToken);
  show('updateProfile → نام ذخیره شد', upd.json?.data?.user?.first_name === 'سامی');

  // ── گارد 401 ──
  const noAuth = await post('/users/getProfile', {});
  show('گارد → 401 AUTH_REQUIRED', noAuth.status === 401 && noAuth.json?.code === 'AUTH_REQUIRED');

  // ── refreshToken چرخشی ──
  const ref = await post('/auth/refreshToken', { refreshToken });
  const newAccess = ref.json?.data?.accessToken;
  show('refreshToken → توکن جدید', ref.json?.status === true && !!newAccess);
  const refAgain = await post('/auth/refreshToken', { refreshToken });
  show('رفرش قبلی باطل → 401', refAgain.status === 401);

  // ── دسته‌ها ──
  const tree = await post('/categories/getAllCategories');
  const roots = tree.json?.data ?? [];
  const agri = roots.find((r) => r.category_name === 'کشاورزی');
  show('getAllCategories → ۱۰ ریشه + درخت', roots.length === 10 && (agri?.children?.length ?? 0) >= 5, `کشاورزی→${agri?.children?.length} فرزند`);
  const children = await post('/categories/getCategoriesByParent', { parent_id: null });
  show('getCategoriesByParent(null) → ریشه‌ها', (children.json?.data ?? []).length === 10);

  // ── مکان‌ها ──
  const provinces = await post('/locations/getAllProvinces');
  show('getAllProvinces → ۳۱ استان', (provinces.json?.data ?? []).length === 31);
  const kerman = await post('/locations/getCitiesByProvince', { province_id: 21 });
  show('getCitiesByProvince(کرمان) → ۳۳ شهر', (kerman.json?.data ?? []).length === 33);

  // ── محصولات seed‌شده ──
  const list = await post('/products/getProductList', {});
  show('getProductList → ۶۰ آگهی باسکول', list.json?.data?.total === 60, `total=${list.json?.data?.total}`);
  const first = list.json?.data?.items?.[0];
  show('آیتم اول → ساختار DTO کامل', !!(first?.productName && first?.seller?.userName && first?.photoThumbs));

  const pist = await post('/products/getProductList', { categorySlug: 'پسته' });
  show('فیلتر پسته → ۱۲ آگهی', pist.json?.data?.total === 12, `total=${pist.json?.data?.total}`);
  const khorma = await post('/products/getProductList', { s: 'خرما' });
  show('جستجوی خرما → ۱۲ آگهی', khorma.json?.data?.total === 12);
  const kermanProv = await post('/products/getProductList', { provinceId: 21 });
  show('فیلتر استان کرمان → ۱۵ آگهی', kermanProv.json?.data?.total === 15);

  // ── جزئیات + عکس rehost‌شده ──
  const detail = await post('/products/getProductById', { id: 328828 });
  const photos = detail.json?.data?.photos ?? [];
  show('getProductById 328828 → عکس rehost آروان', photos.length >= 1 && photos[0].includes('daymatfilles.s3.ir-thr-at1.arvanstorage.ir'));
  const imgRes = await fetch(photos[0], { method: 'HEAD' });
  show('عکس اصلی عمومی → 200', imgRes.status === 200);
  const thumbRes = await fetch((detail.json?.data?.photoThumbs ?? [])[0], { method: 'HEAD' });
  show('تامبنیل ۴۰۰px عمومی → 200', thumbRes.status === 200);

  // ── فروشنده ──
  const seller = await post('/products/getSeller', { userName: 'c34qxnsh' });
  show('getSeller c34qxnsh → آگهی‌ها', (seller.json?.data?.products ?? []).length >= 1, `${(seller.json?.data?.products ?? []).length} آگهی`);

  // ── پیشنهاد جستجو ──
  const sug = await post('/products/searchSuggestions', { typedText: 'خرما' });
  show('searchSuggestions خرما → پیشنهادها', (sug.json?.data ?? []).length >= 2);

  // ── مرتبط‌ها ──
  const rel = await post('/products/getRelatedProducts', { subCategoryId: 44, excludeId: 328828 });
  show('getRelatedProducts پسته → ۶ آگهی', (rel.json?.data ?? []).length === 6);

  // ── ثبت محصول (ویزارد) ──
  const created = await post('/products/createProduct', {
    productName: 'پسته تست',
    subCategoryId: 44,
    provinceId: 21,
    cityId: 230,
    stock: 500,
    minSaleAmount: 100,
    minSalePrice: 3800000,
    description: 'تست ثبت محصول از ویزارد شش مرحله‌ای ایمچ برای بررسی فلو کامل ثبت آگهی.',
    features: [{ key: 'بسته‌بندی', value: 'کیسه' }],
  }, newAccess);
  const newId = created.json?.data?.id;
  show(
    'createProduct → id عددی + pending',
    typeof newId === 'number' && created.json?.data?.status === 'pending',
    `id=${newId}${created.json?.status === false ? ` | ${created.json?.message} (${created.json?.code})` : ''}`,
  );

  // ── آپلود عکس گالری محصول ──
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const sharp = (await import('sharp')).default;
  const testImg = '/tmp/megan-test-upload.jpg';
  // تصویر نویزی — تصویر تک‌رنگ زیر ۲۰KB فشرده می‌شود و قاعده باسکول ردش می‌کند
  const noise = Buffer.alloc(900 * 700 * 3);
  for (let i = 0; i < noise.length; i += 3) {
    noise[i] = (i * 7) & 255;
    noise[i + 1] = (i * 13) & 255;
    noise[i + 2] = (i * 29) & 255;
  }
  writeFileSync(
    testImg,
    await sharp(noise, { raw: { width: 900, height: 700, channels: 3 } }).jpeg({ quality: 85 }).toBuffer(),
  );
  const upRes = execSync(
    `curl -s -X POST "${BASE}/uploads/uploadImage?model=Product&modelId=${newId}&key=gallery&replace=false" -H "Authorization: Bearer ${newAccess}" -F "file=@${testImg}"`,
  ).toString();
  const upJson = JSON.parse(upRes);
  show('uploadImage گالری → ردیف File', upJson?.status === true && !!upJson?.data?.url, `${(upJson?.data?.size ?? 0)} bytes`);
  unlinkSync(testImg);

  // ── عکس در getMyProducts ──
  const myProds = await post('/products/getMyProducts', {}, newAccess);
  const mine = (myProds.json?.data?.items ?? []).find((p) => p.id === newId);
  show('getMyProducts → عکس چسبیده', (mine?.photos ?? []).length === 1);
  show('getMyProducts → counts + ظرفیت', myProds.json?.data?.counts?.pending === 1 && myProds.json?.data?.capacity === 5);

  // ── deleteMyProduct ──
  const del = await post('/products/deleteMyProduct', { id: newId }, newAccess);
  show('deleteMyProduct → حذف نرم', del.json?.status === true);

  // ── logout ──
  const out = await post('/auth/logout', { refreshToken: ref.json?.data?.refreshToken });
  show('logout', out.json?.status === true);

  console.log(`\n── نتیجه: ${passed} پاس / ${failed} خطا ──`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('خطای تست:', e);
  process.exit(1);
});
