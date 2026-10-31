#!/usr/bin/env node
/**
 * تست سرتاسری خریداران + تنظیمات پویا (باچ ۳۱-۱۰ بخش ۳)
 * دو کاربر می‌سازد: خریدار (دفتر خرید پر) و فروشندهٔ دارندهٔ بسته؛
 * سپس دایرکتوری، سهمیه، پیشنهاد تکی/گروهی، کیف پول داینامیک و ادمین را می‌آزماید.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true }); // سندباکس DATABASE_URL قدیمی در شل دارد

const BASE = 'http://localhost:4000/api/v1';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

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

async function login(phone) {
  const r = await api('auth/login', { phone });
  if (r.status) return r.data.accessToken;
  throw new Error(`login failed: ${JSON.stringify(r)}`);
}

async function main() {
  console.log('— ۱) ورود دو کاربر تستی');
  const buyerPhone = '09150000001';
  const sellerPhone = '09150000002';
  const buyerToken = await login(buyerPhone);
  const sellerToken = await login(sellerPhone);
  check('ورود خریدار و فروشنده', !!buyerToken && !!sellerToken);

  console.log('— ۲) یافتن دستهٔ برگ از درخت');
  const cats = await api('categories/getAllCategories', {});
  const flatten = (nodes, parents = []) =>
    nodes.flatMap((n) =>
      n.children?.length ? flatten(n.children, [...parents, n.category_name]) : [{ id: n.id, name: n.category_name, path: parents.join(' ‹ ') }],
    );
  const leaves = flatten(cats.data);
  check('درخت دسته‌ها آمد', leaves.length > 0, `(${leaves.length} برگ)`);
  const leaf1 = leaves[0];
  const leaf2 = leaves.find((l) => l.id !== leaf1.id) ?? leaf1;
  console.log(`    برگ ۱: ${leaf1.name} (${leaf1.id}) · برگ ۲: ${leaf2.name} (${leaf2.id})`);

  console.log('— ۳) دفتر خرید من — ذخیره و خواندن');
  const buyerMe = JSON.parse(Buffer.from(buyerToken.split('.')[1], 'base64').toString());
  const save = await api('buyers/saveMyBook', {
    items: [
      { categoryId: leaf1.id, volumeMin: 1000, volumeMax: 5000, unit: 'کیلوگرم' },
      { categoryId: leaf2.id, volumeMin: 2, volumeMax: 0, unit: 'تن' },
    ],
  }, buyerToken);
  check('ذخیرهٔ دفتر خرید', save.status === true, JSON.stringify(save));
  const myBook = await api('buyers/getMyBook', {}, buyerToken);
  check('خواندن دفتر خرید — ۲ ردیف', myBook.status && myBook.data.items.length === 2);
  check('نام دسته در پاسخ هست', myBook.data.items[0].name === leaf1.name);

  const badSave = await api('buyers/saveMyBook', {
    items: [{ categoryId: 1, volumeMin: 5, volumeMax: 2, unit: 'کیلوگرم' }], // max < min
  }, buyerToken);
  check('رد بازهٔ معکوس حجم', badSave.status === false);

  console.log('— ۴) دایرکتوری عمومی — بی نام و تماس');
  const dir = await api('buyers/directory', { categoryId: leaf1.id });
  check('خریدار در دایرکتوری دیده شد', dir.status && dir.data.items.length >= 1, JSON.stringify(dir).slice(0, 200));
  const card = dir.data.items[0];
  check('کارت بی نام/تماس است', !card.firstName && !card.phone && !card.userName && !!card.id);
  check('نقش آمده', card.role === 'عمده‌خریدار' || card.role === 'خرده‌خریدار', card.role);
  check('بازهٔ حجم خوانا', /در ماه/.test(card.categories[0]?.range ?? ''), card.categories[0]?.range);
  check('فعال اخیر', card.activeRecently === true);

  const dirAll = await api('buyers/directory', {});
  check('بدون فیلتر دسته هم می‌آید', dirAll.status && dirAll.data.items.length >= 1);

  console.log('— ۵) ارتقای تستی فروشنده به بستهٔ فعال + موجودی');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const sellerMe = JSON.parse(Buffer.from(sellerToken.split('.')[1], 'base64').toString());
  await prisma.user.update({
    where: { id: sellerMe.sub },
    data: {
      activePakageType: 2,
      packageExpiresAt: new Date(Date.now() + 180 * 86400000),
      walletBalance: 100000,
      firstName: 'فروشنده',
      lastName: 'تستی',
    },
  });
  // خریدار مکان بگیرد تا کارت استان/شهر نشان دهد
  const tehran = await prisma.location.findFirst({ where: { type: 'province', name: { contains: 'تهران' } } });
  if (tehran) {
    const tehranCity = await prisma.location.findFirst({ where: { type: 'city', parentId: tehran.id } });
    await prisma.user.update({
      where: { id: buyerMe.sub },
      data: { provinceId: tehran.buskolId, cityId: tehranCity?.buskolId ?? null },
    });
  }
  check('فروشنده ویژه شد + مکان خریدار', true);

  console.log('— ۶) سهمیهٔ پیشنهاد تامین');
  const quota = await api('buyers/getMyOfferQuota', {}, sellerToken);
  check('سهمیهٔ دارندهٔ بستهٔ ۶ماهه = ۱۰', quota.status && quota.data.dailyLimit === 10, JSON.stringify(quota).slice(0, 150));
  check('قیمت ارسال گروهی = ۵۰۰۰', quota.data.groupSend.perRecipientPrice === 5000);

  const quotaFree = await api('buyers/getMyOfferQuota', {}, buyerToken);
  check('بدون بسته → غیر ویژه', quotaFree.status && quotaFree.data.isFeatured === false);

  console.log('— ۷) پیشنهاد تامین تکی');
  const offer = await api('buyers/sendSupplyOffer', {
    buyerId: buyerMe.sub,
    message: 'سلام، پسته اکبری درجه یک داریم؛ برای خرید ماهانه ۵٪ تخفیف می‌گذاریم.',
  }, sellerToken);
  check('ارسال تکی موفق', offer.status === true, JSON.stringify(offer).slice(0, 200));
  check('سهمیهٔ باقی‌مانده آمد', offer.status && offer.data.quotaLeft === 9);

  // پیام در گفتگوی مستقیم ثبت شده؟
  const threads = await prisma.chatThread.findMany({
    where: { sellerId: sellerMe.sub, buyerId: buyerMe.sub, productId: null },
  });
  const msgCount = threads.length
    ? await prisma.chatMessage.count({ where: { threadId: threads[0].id } })
    : 0;
  check('پیام چت به خریدار رسید', threads.length === 1 && msgCount === 1);

  console.log('— ۸) ارسال گروهی — کسر از کیف پول');
  // خریدار دوم برای گروه
  const buyer2Token = await login('09150000003');
  const buyer2Me = JSON.parse(Buffer.from(buyer2Token.split('.')[1], 'base64').toString());
  await api('buyers/saveMyBook', {
    items: [{ categoryId: leaf1.id, volumeMin: 500, volumeMax: 1000, unit: 'کیلوگرم' }],
  }, buyer2Token);

  const before = await prisma.user.findUnique({ where: { id: sellerMe.sub } });
  const group = await api('buyers/groupSendSupplyOffer', {
    buyerIds: [buyerMe.sub, buyer2Me.sub],
    message: 'پیشنهاد ویژهٔ پایان فصل — ارزان‌تر از بازار.',
  }, sellerToken);
  check('ارسال گروهی موفق (۲ گیرنده)', group.status === true && group.data.sent === 2, JSON.stringify(group).slice(0, 200));
  check('هزینه = ۲ × ۵۰۰۰', group.status && group.data.fee === 10000);
  const after = await prisma.user.findUnique({ where: { id: sellerMe.sub } });
  check('کیف پول اتمیک کم شد', after.walletBalance === before.walletBalance - 10000, `${before.walletBalance} → ${after.walletBalance}`);

  // تراکنش ثبت شد؟
  const tx = await api('wallet/getWalletTransactions', {}, sellerToken);
  check('تراکنش «ارسال گروهی» در تاریخچه', tx.status && tx.data.items.some((t) => t.type === 'offer'));

  console.log('— ۹) گیت‌های امنیتی');
  const noPkg = await api('buyers/sendSupplyOffer', {
    buyerId: buyerMe.sub,
    message: 'تست بدون بسته باید رد شود.',
  }, buyer2Token);
  check('کاربر بدون بسته رد شد', noPkg.status === false && (noPkg.code === 'PACKAGE_REQUIRED' || noPkg.message.includes('بسته')));

  console.log('— ۱۰) کیف پول داینامیک');
  const wallet = await api('wallet/getWallet', {}, sellerToken);
  check('پکیج‌ها از تنظیمات آمدند', wallet.status && Array.isArray(wallet.data.packages) && wallet.data.packages.length >= 1);
  check('حداقل شارژ دلخواه = گران‌ترین پکیج', wallet.status && wallet.data.custom.min === Math.max(...wallet.data.packages.map((p) => p.amount)));

  console.log('— ۱۱) ادمین — تغییر تنظیم و اثر فوری');
  const adminLogin = await api('admin/auth/login', { username: '09196421264', password: '434343' });
  const adminToken = adminLogin.data.token;
  const billing1 = await api('admin/settings/getBilling', {}, adminToken);
  check('ادمین تنظیمات را خواند', billing1.status === true);
  const changed = JSON.parse(JSON.stringify(billing1.data));
  changed.ladder.monthlyPrice = 60000;
  changed.supplyOffer.dailyLimits.find((l) => l.pakageType === 2).limit = 8;
  changed.groupSend.perRecipientPrice = 7000;
  const upd = await api('admin/settings/updateBilling', { billing: changed }, adminToken);
  check('ادمین تنظیمات را ذخیره کرد', upd.status === true, JSON.stringify(upd).slice(0, 150));

  const quota2 = await api('buyers/getMyOfferQuota', {}, sellerToken);
  check('سقف جدید (۸) فوری اعمال شد', quota2.status && quota2.data.dailyLimit === 8, JSON.stringify(quota2.data).slice(0, 100));
  const billingPublic = await api('site-settings/getBillingConfig', {});
  check('قیمت گروهی جدید (۷۰۰۰) عمومی شد', billingPublic.status && billingPublic.data.groupSend.perRecipientPrice === 7000);

  // بازگردانی پیش‌فرض
  const restore = JSON.parse(JSON.stringify(changed));
  restore.ladder.monthlyPrice = 50000;
  restore.supplyOffer.dailyLimits.find((l) => l.pakageType === 2).limit = 10;
  restore.groupSend.perRecipientPrice = 5000;
  await api('admin/settings/updateBilling', { billing: restore }, adminToken);

  console.log('— ۱۲) لیست درخواست‌ها با فیلتر دسته');
  const reqs = await api('buy-requests/getBuyRequestList', { categoryId: leaf1.id });
  check('فیلتر دسته کار می‌کند (بدون خطا)', reqs.status === true);

  await prisma.$disconnect();
  console.log(`\n═══ نتیجه: ${passed} پاس · ${failed} خطا ═══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
