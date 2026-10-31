#!/usr/bin/env node
/**
 * آماده‌سازی تست مرورگر «پیشنهاد تامین — شب دوم ۱-۱۱»:
 *  • فروشندهٔ تستی 09150000002 → بستهٔ فعال ۶ماهه + کیف پول ۱۰۰هزار
 *  • یک آگهی confirmed «سیب قرمز تستی» (دستهٔ سیب=۳/میوه=۱) تا نمونهٔ پارامتریک
 *    مسیر قیمت/حداقل سفارش واقعی را هم برود
 * خروجی: توکن در /tmp/offer-test-token.txt
 * اجرا: node scripts/offer-test-setup.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const BASE = 'http://localhost:4000/api/v1';

async function api(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

async function main() {
  const login = await api('auth/login', { phone: '09150000002' });
  if (!login.status) throw new Error('login failed: ' + JSON.stringify(login));
  const token = login.data.accessToken;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const sellerId = payload.sub;

  // بستهٔ فعال + کیف پول + نام
  await prisma.user.update({
    where: { id: sellerId },
    data: {
      activePakageType: 2,
      packageExpiresAt: new Date(Date.now() + 180 * 86400000),
      walletBalance: 100000,
      firstName: 'فروشنده',
      lastName: 'تستی ایمچ',
    },
  });

  // پاک‌سازی آگهی‌های تستی قبلی همین کاربر، بعد ساخت آگهی confirmed سیب
  await prisma.product.deleteMany({ where: { userId: sellerId } });
  const tehran = await prisma.location.findFirst({ where: { type: 'province', name: { contains: 'تهران' } } });
  const tehranCity = await prisma.location.findFirst({ where: { type: 'city', parentId: tehran?.id } });
  const counter = await prisma.counter.upsert({
    where: { id: 'product' },
    create: { id: 'product', seq: 300000 },
    update: { seq: { increment: 1 } },
  });
  await prisma.product.create({
    data: {
      id: counter.seq,
      productName: 'سیب قرمز تستی',
      slug: `خرید-عمده-سیب-قرمز-تستی-${counter.seq}`,
      description: 'سیب قرمز درجه یک تستی — برای تست نمونهٔ پارامتریک پیشنهاد تامین',
      categoryId: 1,
      subCategoryId: 3,
      unit: 'کیلوگرم',
      provinceId: tehran?.buskolId ?? 1,
      cityId: tehranCity?.buskolId ?? 1,
      stock: 5000,
      minSaleAmount: 500,
      minSalePrice: 15000,
      status: 'confirmed',
      userId: sellerId,
    },
  });

  // دایرکتوری و سهمیه را چک کنیم
  const quota = await api('buyers/getMyOfferQuota', {}, token);
  const prods = await api('products/getMyProducts', {}, token);
  console.log('sellerId:', sellerId);
  console.log('quota:', JSON.stringify(quota.data));
  console.log('myProducts:', prods.data.items.map((p) => `${p.productName}(${p.status})`).join(', '));
  await prisma.$disconnect();

  const fs = await import('fs');
  fs.writeFileSync('/tmp/offer-test-token.txt', token);
  console.log('token saved');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
