#!/usr/bin/env node
/**
 * تست جریان کامل پیشنهاد تامین بدون سهمیه (خواسته مالک ۶-۱۱) — node scripts/test-offer-flow.mjs
 * سرور روی :4000 — دو حساب تستی تازه می‌سازد: فروشندهٔ دارای بسته + خریدارِ دارای دفتر خرید؛
 * بعد پیشنهاد تکی را با موفقیت می‌فرستد (قبلاً OFFER_LIMIT داشت) و پاسخ بدون quotaLeft را می‌سنجد.
 */
const BASE = 'http://localhost:4000/api/v1';
import fs from 'node:fs';

let passed = 0;
let failed = 0;
function show(title, ok, extra = '') {
  const mark = ok ? '✔' : '✖';
  if (ok) passed++;
  else failed++;
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

async function login(phone) {
  await post('/auth/sendOtp', { phone });
  const v = await post('/auth/verifyOtp', { phone, code: '1234' });
  return v.json?.data?.accessToken;
}

async function main() {
  // ── حساب خریدار تازه + دفتر خرید ──
  const buyerPhone = `09358${Math.floor(100000 + Math.random() * 899999)}`;
  const buyerToken = await login(buyerPhone);
  show('ورود خریدار تستی', Boolean(buyerToken), buyerPhone);

  const tree = await post('/categories/getAllCategories', {});
  const leaves = (tree.json?.data ?? []).flatMap((r) => r.children ?? []).flatMap((s) => s.children ?? []);
  const leaf = leaves.find((l) => (l.category_name ?? '').trim().length > 0);
  show('دستهٔ برگ پیدا شد', Boolean(leaf), `${leaf?.category_name} (${leaf?.id})`);

  const save = await post(
    '/buyers/saveMyBook',
    { items: [{ categoryId: leaf.id, volumeMin: 100, period: 'monthly' }] },
    buyerToken,
  );
  show('دفتر خرید خریدار ذخیره شد', [200, 201].includes(save.status), `${save.status} ${save.json?.message ?? ''}`);

  // شناسهٔ مونگویی خریدار مستقیم از DB (دایرکتوری بر اساس نام/دسته جستجو می‌کند نه شماره)
  const { PrismaClient: P0 } = await import('@prisma/client');
  process.env.DATABASE_URL = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
  const p0 = new P0();
  const buyerRow = await p0.user.findFirst({ where: { phone: buyerPhone } });
  await p0.$disconnect();
  const buyerId = buyerRow?.id;
  show('شناسهٔ خریدار آماده شد', Boolean(buyerId), buyerId ?? 'not found');

  // ── حساب فروشندهٔ تازه + بستهٔ فعال (مستقیم در DB) ──
  const sellerPhone = `09123${Math.floor(100000 + Math.random() * 899999)}`;
  const sellerToken = await login(sellerPhone);
  show('ورود فروشندهٔ تستی', Boolean(sellerToken), sellerPhone);

  const { PrismaClient } = await import('@prisma/client');
  const env = fs.readFileSync('.env', 'utf8');
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
  const prisma = new PrismaClient();
  const seller = await prisma.user.findFirst({ where: { phone: sellerPhone } });
  await prisma.user.update({
    where: { id: seller.id },
    data: { activePakageType: 3, packageExpiresAt: new Date('2027-01-01') },
  });
  await prisma.$disconnect();
  show('بستهٔ فروشنده فعال شد', true);

  // محصول تازه از خود API — گیت کالا (خواسته مالک ۴-۱۱) رد شود؛ بعد تأییدش می‌کنیم
  const provs = await post('/locations/getAllProvinces', {});
  const prov = (provs.json?.data ?? []).find((p) => (p.province_name ?? '').includes('تهران')) ?? (provs.json?.data ?? [])[0];
  const cities = await post('/locations/getCitiesByProvince', { provinceId: prov?.id });
  const city = (cities.json?.data ?? []).find((c) => (c.city_name ?? '').includes('تهران')) ?? (cities.json?.data ?? [])[0];
  show('استان/شهر پیدا شد', Boolean(prov && city), `${prov?.province_name} / ${city?.city_name}`);
  const created = await post(
    '/products/createProduct',
    {
      productName: `تست ${leaf.category_name}`,
      subCategoryId: leaf.id,
      provinceId: prov?.id,
      cityId: city?.id,
      stock: 1000,
      minSaleAmount: 100,
      minSalePrice: 50000,
      description: 'توصیف آزمایشی محصول برای تست جریان پیشنهاد تامین — کیفیت تضمینی و بسته‌بندی مطابق درخواست.',
    },
    sellerToken,
  );
  show('محصول ثبت شد', [200, 201].includes(created.status), `${created.status} ${created.json?.message ?? ''}`);

  // تأیید مستقیم محصول (بدون منتظر ادمین) — تا از گیت کالا رد شود
  const prisma2 = new PrismaClient();
  await prisma2.product.updateMany({
    where: { userId: seller.id },
    data: { status: 'confirmed' },
  });
  await prisma2.$disconnect();
  show('محصول تأیید شد', true);

  // ── سهمیهٔ تازه: شکل مینیمال ──
  const quota = await post('/buyers/getMyOfferQuota', {}, sellerToken);
  show(
    'سهمیهٔ فروشنده: isFeatured=true بدون فیلد روزانه',
    quota.json?.data?.isFeatured === true && quota.json?.data?.dailyLimit === undefined,
    JSON.stringify(quota.json?.data),
  );

  // ── ارسال تکی ۷ باره — قبلاً سقف روزانه سطح ۳ = ۲۰ بود؛ حالا هیچ سهمیه‌ای نیست.
  //    ۷ بار به همان خریدار → قبلاً فقط ۱ سهمیه می‌گرفت؛ اینجا صرفاً موفقیت پیاپی را می‌سنجیم.
  let okCount = 0;
  let lastExtra = '';
  for (let i = 0; i < 7; i++) {
    const r = await post(
      '/buyers/sendSupplyOffer',
      { buyerId, message: `پیشنهاد آزمایشی ${i + 1} — کیفیت تضمینی و قیمت رقابتی.` },
      sellerToken,
    );
    if ([200, 201].includes(r.status) && r.json?.data?.offerId) okCount++;
    else lastExtra = `${r.status} ${r.json?.code ?? ''} ${r.json?.message ?? ''}`;
  }
  show('۷ ارسال پیاپی تکی موفق (بدون سهمیه)', okCount === 7, `ok=${okCount} ${lastExtra}`);

  // پاسخ ارسال تکی فیلد quotaLeft ندارد
  const one = await post(
    '/buyers/sendSupplyOffer',
    { buyerId, message: 'پیشنهاد پایانی — بسته‌بندی مطابق درخواست شما.' },
    sellerToken,
  );
  show(
    'پاسخ sendSupplyOffer بدون quotaLeft',
    one.json?.data?.quotaLeft === undefined && Boolean(one.json?.data?.offerId),
    JSON.stringify(one.json?.data ?? {}).slice(0, 80),
  );

  // ── پیشنهادهای ارسالی (تب سوم فرانت) — همین‌جا هم بررسی شود ──
  const sent = await post('/buyers/getMySentOffers', { page: 1, perPage: 20 }, sellerToken);
  show(
    'getMySentOffers همان تعداد را برمی‌گرداند',
    sent.json?.data?.total === 8,
    `total=${sent.json?.data?.total}`,
  );

  // ── ارسال گروهی: موجودی ناکافی → WALLET_INSUFFICIENT؛ با موجودی → کسر اتمیک ──
  // قیمت هر گیرنده از پیکربندی زنده
  const { PrismaClient: P2 } = await import('@prisma/client');
  const p2 = new P2();
  const seller2 = await p2.user.findFirst({ where: { phone: sellerPhone } });

  const group0 = await post(
    '/buyers/groupSendSupplyOffer',
    { buyerIds: [buyerId], message: 'ارسال گروهی آزمایشی بدون موجودی.' },
    sellerToken,
  );
  show(
    'گروهی بدون موجودی → WALLET_INSUFFICIENT',
    group0.json?.code === 'WALLET_INSUFFICIENT',
    `${group0.status} ${group0.json?.code ?? ''}`,
  );

  await p2.user.update({ where: { id: seller2.id }, data: { walletBalance: 20_000 } });
  await p2.$disconnect();

  const group1 = await post(
    '/buyers/groupSendSupplyOffer',
    { buyerIds: [buyerId], message: 'ارسال گروهی آزمایشی با موجودی کافی — تخفیف دوره‌ای دارد.' },
    sellerToken,
  );
  show(
    'گروهی با موجودی → sent/fee/balance بدون groupLeft',
    [200, 201].includes(group1.status) &&
      group1.json?.data?.sent === 1 &&
      typeof group1.json?.data?.fee === 'number' &&
      typeof group1.json?.data?.balance === 'number' &&
      group1.json?.data?.groupLeft === undefined,
    JSON.stringify(group1.json?.data ?? {}),
  );

  const quotaAfter = await post('/buyers/getMyOfferQuota', {}, sellerToken);
  show(
    'کیف پول پس از ارسال گروهی کم شده',
    quotaAfter.json?.data?.walletBalance === 20_000 - (group1.json?.data?.fee ?? 0),
    `${quotaAfter.json?.data?.walletBalance}`,
  );

  console.log(`\n→ ${passed} پاس، ${failed} خطا`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('خطای تست:', e);
  process.exit(1);
});
