// پرکردن نام/نام‌خانوادگی/استان/شهر کاربران موجود تا شبیه کاربران واقعی باشند
// - کاربران دارای آگهی: مکان از خودِ آگهی‌هایشان (سازگار با محتوایشان)
// - کاربران دارای درخواست خرید: مکان از درخواستشان
// - بقیه: مکان بر اساس توزیع واقع‌گرایانه استان‌های پرترافیک
// - isSeller برای دارنده آگهی confirmed / isBuyer برای دارنده درخواست
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ─── استخر نام‌ها (رایج ایران — ۴۰ مرد + ۲۵ زن، ۴۵ نام خانوادگی) ───────
const MALE = ['علی','حسین','محمد','رضا','مهدی','احمد','امیر','سعید','مجید','کریم','یوسف','ابراهیم','حمید','مسعود','کامران','بهنام','فرهاد','رامین','نیما','آرش','سینا','پویا','هومن','بابک','کاوه','شهرام','اصغر','قادر','یعقوب','جعفر','مصطفی','حسن','اکبر','مهدی','داوود','رستگل','صمد','لطیف','منصور'];
const FEMALE = ['فاطمه','زهرا','مریم','سارا','نرگس','الهام','شیما','لیلا','نسرین','مینا','پریسا','سمانه','هانیه','غزاله','آیدا','رها','بهاره','مهسا','یاسمن','یلدا','نازنین','سپیده','شیرین','ترانه','کیمیا'];
const FAMILY = ['احمدی','محمدی','رضایی','حسینی','کریمی','موسوی','صادقی','جعفری','نوری','قاسمی','شریفی','رحیمی','کاظمی','عباسی','زمانی','طاهری','مرادی','برزگر','شجاعی','فرهادی','یوسفی','امینی','سلطانی','هاشمی','اکبری','اسدی','بهرامی','پارسا','تهرانی','جلالی','حیدری','خسروی','خالدی','رستمی','روحانی','صالحی','عارفی','عزیزی','غفاری','فتحی','قربانی','کاشانی','گلستانی','مجیدی','نادری'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  // id استان‌های پرترافیک باسکول + وزن — تهران/کرمان(پسته)/خراسان(زعفران)/...
  const provinces = await prisma.location.findMany({
    where: { parent_id: null, is_active: true },
    select: { id: true, name: true },
  });
  const provinceWeights = [
    ['تهران', 30], ['کرمان', 12], ['خراسان رضوی', 10], ['اصفهان', 9], ['فارس', 8],
    ['البرز', 7], ['آذربایجان شرقی', 5], ['قم', 4], ['یزد', 4], ['گیلان', 3],
    ['مازندران', 3], ['خوزستان', 3], ['قزوین', 2],
  ];
  const provByName = new Map(provinces.map((p) => [p.name, p]));
  // سبد وزنی
  const bag = [];
  for (const [name, w] of provinceWeights) {
    const p = provByName.get(name);
    if (p) for (let i = 0; i < w; i++) bag.push(p.id);
  }
  const citiesByProv = new Map();
  for (const p of provinces) {
    const cities = await prisma.location.findMany({
      where: { parent_id: p.id, is_active: true },
      select: { id: true },
    });
    citiesByProv.set(p.id, cities);
  }

  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true, provinceId: true, cityId: true, sex: true },
  });

  // محتوای هر کاربر — مکان واقعی محتوا
  const products = await prisma.product.findMany({
    where: { status: 'confirmed' },
    select: { userId: true, provinceId: true, cityId: true },
    orderBy: { createdAt: 'desc' },
  });
  const requests = await prisma.buyRequest.findMany({
    where: { status: 'confirmed' },
    select: { userId: true, provinceId: true, cityId: true },
    orderBy: { createdAt: 'desc' },
  });
  const locFromProducts = new Map();
  for (const p of products) if (!locFromProducts.has(p.userId)) locFromProducts.set(p.userId, p);
  const locFromRequests = new Map();
  for (const r of requests) if (!locFromRequests.has(r.userId)) locFromRequests.set(r.userId, r);
  const sellerIds = new Set(products.map((p) => p.userId));
  const buyerIds = new Set(requests.map((r) => r.userId));

  let filled = 0;
  for (const u of users) {
    const data = {};
    // نام
    const hasName = (u.firstName || '').trim().length > 0 && (u.lastName || '').trim().length > 0;
    if (!hasName) {
      const female = Math.random() < 0.28;
      data.firstName = female ? rand(FEMALE) : rand(MALE);
      data.lastName = rand(FAMILY);
      data.sex = female ? 'خانم' : 'آقا';
    }
    // مکان — اولویت: خودِ آگهی/درخواست کاربر
    if (!u.provinceId || !u.cityId) {
      const fromProduct = locFromProducts.get(u.id);
      const fromRequest = locFromRequests.get(u.id);
      const src = fromProduct ?? fromRequest;
      if (src?.provinceId && src?.cityId) {
        data.provinceId = src.provinceId;
        data.cityId = src.cityId;
      } else if (bag.length) {
        const pid = rand(bag);
        const cities = citiesByProv.get(pid) ?? [];
        if (cities.length) {
          data.provinceId = pid;
          data.cityId = rand(cities).id;
        }
      }
    }
    // نقش — با محتوا سازگار
    if (sellerIds.has(u.id)) data.isSeller = true;
    if (buyerIds.has(u.id)) data.isBuyer = true;

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: u.id }, data });
      filled++;
    }
  }
  console.log(`کاربران به‌روزشده: ${filled} از ${users.length}`);

  // گزارش
  const missing = await prisma.user.count({ where: { OR: [{ firstName: '' }, { lastName: '' }] } });
  const noCity = await prisma.user.count({ where: { cityId: null } });
  console.log(`بدون نام: ${missing} | بدون شهر: ${noCity}`);
}

main().finally(() => prisma.$disconnect());
