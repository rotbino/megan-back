#!/usr/bin/env node
/** تست API جریان کامل پیشنهاد تامین با شرایط ساختاریافته (dev سندباکس):
 *  ۱) ارسال تکی با شرایط کامل → ردیف DB + پنل خریدار (چیپ‌ها/مسیر دسته/threadId)
 *  ۲) پیام چت — بلوک «شرایط تامین» چسبیده باشد
 *  ۳) گیت‌های خطا: دستهٔ غیربرگ، چک ناقص، حمل بدون پرداخت‌کننده، خریدارِ خارج از دسته
 *  ۴) ارسال گروهی با شرایط + کسر کیف پول + backfill شدن threadId
 *  ۵) فیلترهای پنل خریدار: دسته / نوع کالا / فقط با چک / فقط با ارسال
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

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  async function login(phone) {
    const r = await api('auth/login', { phone });
    if (!r.status) throw new Error(`login ${phone} failed: ` + JSON.stringify(r).slice(0, 200));
    return r.data.accessToken;
  }
  const seller = await login('09150000002');
  const saeed = await login('09123456789');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const dir = await api('buyers/directory', { categoryId: 3 });
  const saeedCard = dir.data.items.find((i) => i.buyerName.includes('سعید'));
  const miraliCard = dir.data.items.find((i) => i.buyerName.includes('میرعلی'));
  check('کارت سعید و میرعلی در دستهٔ سیب', !!saeedCard && !!miraliCard);

  // ── ۱) ارسال تکی با شرایط کامل ──
  console.log('— ارسال تکی با شرایط —');
  const single = await api('buyers/sendSupplyOffer', {
    buyerId: saeedCard.buyerId,
    message: 'پیشنهاد تکی API با شرایط کامل برای سعید',
    categoryId: 3,
    productType: 'قرمز شیبلی',
    checkAccepted: true, checkPercent: 40, checkMaxDays: 90,
    deliveryToBuyer: true, shippingCostBy: 'customer',
    minOrderAmount: 750,
  }, seller);
  check('ارسال تکی ok', single.status === true, JSON.stringify(single).slice(0, 150));
  check('threadId در پاسخ', typeof single.data?.threadId === 'string');

  const rec = await api('buyers/getMyReceivedOffers', {}, saeed);
  const sOffer = rec.data.items.find((o) => o.productType === 'قرمز شیبلی');
  check('پیشنهاد در پنل سعید', !!sOffer);
  if (sOffer) {
    check('دستهٔ سیب (id=3)', sOffer.categoryId === 3 && sOffer.categoryName === 'سیب');
    check('مسیر دسته: کشاورزی / میوه', sOffer.categoryPath === 'کشاورزی / میوه', JSON.stringify(sOffer.categoryPath));
    check('چیپ چک: ۴۰٪/۹۰روز', sOffer.checkPercent === 40 && sOffer.checkMaxDays === 90);
    check('چیپ حمل: با مشتری', sOffer.shippingCostBy === 'customer');
    check('چیپ حداقل خرید: ۷۵۰ کیلوگرم', sOffer.minOrderAmount === 750 && sOffer.unit === 'کیلوگرم');
    check('threadId ثبت شده', typeof sOffer.threadId === 'string' && sOffer.threadId.length === 24);
    check('گزینهٔ فیلتر دسته در پاسخ', rec.data.categories.some((c) => c.id === 3 && c.name === 'سیب'));
  }

  // ── ۲) پیام چت — بلوک شرایط ──
  console.log('— پیام چت خریدار —');
  const msg = await prisma.chatMessage.findFirst({
    where: { threadId: sOffer?.threadId },
    orderBy: { createdAt: 'desc' },
  });
  check('پیام در گفتگو هست', !!msg);
  if (msg) {
    check('متن اصلی فروشنده در پیام است', msg.text.includes('پیشنهاد تکی API'));
    check('بلوک «شرایط تامین» در پیام است', msg.text.includes('شرایط تامین'));
    check('جملهٔ چک', msg.text.includes('پرداخت با چک: تا ۴۰٪ مبلغ، سرسید حداکثر ۹۰ روز'));
    check('جملهٔ ارسال', msg.text.includes('ارسال: به محل شما؛ هزینهٔ حمل با مشتری'));
    check('جملهٔ حداقل خرید', msg.text.includes('حداقل خرید: ۷۵۰ کیلوگرم'));
    check('جملهٔ نوع کالا', msg.text.includes('نوع کالا: قرمز شیبلی'));
  }

  // ── ۳) گیت‌های خطا ──
  console.log('— گیت‌های اعتبارسنجی —');
  const notLeaf = await api('buyers/sendSupplyOffer', {
    buyerId: saeedCard.buyerId, message: 'تست دسته میانی', categoryId: 1,
  }, seller);
  check('دستهٔ میانی رد (CATEGORY_NOT_LEAF)', notLeaf.status === false && notLeaf.code === 'CATEGORY_NOT_LEAF', JSON.stringify(notLeaf).slice(0, 120));

  const badCheck = await api('buyers/sendSupplyOffer', {
    buyerId: saeedCard.buyerId, message: 'تست چک ناقص', categoryId: 3, checkAccepted: true,
  }, seller);
  check('چک ناقص رد (CHECK_TERMS_INCOMPLETE)', badCheck.status === false && badCheck.code === 'CHECK_TERMS_INCOMPLETE', JSON.stringify(badCheck).slice(0, 120));

  const badShip = await api('buyers/sendSupplyOffer', {
    buyerId: saeedCard.buyerId, message: 'تست حمل ناقص', categoryId: 3, deliveryToBuyer: true,
  }, seller);
  check('حمل بدون پرداخت‌کننده رد (SHIPPING_PAYER_REQUIRED)', badShip.status === false && badShip.code === 'SHIPPING_PAYER_REQUIRED', JSON.stringify(badShip).slice(0, 120));

  const wrongCat = await api('buyers/sendSupplyOffer', {
    buyerId: saeedCard.buyerId, message: 'تست دستهٔ ناهمخوان', categoryId: 40,
  }, seller);
  check('خریدارِ خارج از دسته رد (BUYER_NOT_IN_CATEGORY)', wrongCat.status === false && wrongCat.code === 'BUYER_NOT_IN_CATEGORY', JSON.stringify(wrongCat).slice(0, 120));

  // ── ۴) ارسال گروهی با شرایط ──
  console.log('— ارسال گروهی —');
  const before = (await api('buyers/getMyOfferQuota', {}, seller)).data;
  const group = await api('buyers/groupSendSupplyOffer', {
    buyerIds: [...new Set(dir.data.items.map((i) => i.buyerId))],
    message: 'تست گروهی شرایط ساختاریافته',
    categoryId: 3,
    productType: 'قرمز',
    checkAccepted: true, checkPercent: 30, checkMaxDays: 45,
    deliveryToBuyer: true, shippingCostBy: 'customer',
    minOrderAmount: 1000,
  }, seller);
  check('گروهی ok', group.status === true, JSON.stringify(group).slice(0, 200));
  if (group.status) {
    const n = group.data.sent;
    check(`هزینه ${n}×۱۰۰۰ کسر شد`, group.data.fee === n * 1000);
    check('کیف پول کم شد', group.data.balance === before.walletBalance - group.data.fee);

    const gRows = await prisma.supplyOffer.findMany({
      where: { message: 'تست گروهی شرایط ساختاریافته' },
    });
    check('همهٔ ردیف‌های گروهی threadId دارند (backfill)', gRows.length === n && gRows.every((r) => typeof r.threadId === 'string' && r.threadId.length === 24), JSON.stringify(gRows.map((r) => r.threadId)));
    check('شرایط روی ردیف گروهی', gRows.every((r) => r.checkAccepted && r.checkPercent === 30 && r.deliveryToBuyer && r.shippingCostBy === 'customer' && r.minOrderAmount === 1000));

    const rec2 = await api('buyers/getMyReceivedOffers', { hasDelivery: true }, saeed);
    const g = rec2.data.items.find((o) => o.message.includes('تست گروهی'));
    check('گروهی در پنل با حمل با مشتری', !!g && g.shippingCostBy === 'customer');
  }

  // ── ۵) فیلترهای پنل ──
  console.log('— فیلترهای پنل خریدار —');
  const onlyCheck = await api('buyers/getMyReceivedOffers', { hasCheck: true }, saeed);
  check('فیلتر «فقط با چک»', onlyCheck.data.items.length >= 2);
  const byType = await api('buyers/getMyReceivedOffers', { productType: 'شیبلی' }, saeed);
  check('جستجوی نوع کالا', byType.data.total === 1);
  const noRes = await api('buyers/getMyReceivedOffers', { categoryId: 999 }, saeed);
  check('فیلتر دستهٔ ناموجود → خالی', noRes.data.total === 0);
  const byCat = await api('buyers/getMyReceivedOffers', { categoryId: 3 }, saeed);
  check('فیلتر دستهٔ سیب', byCat.data.total === 2 && byCat.data.items.every((o) => o.categoryId === 3));

  await prisma.$disconnect();
  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
