/**
 * seed آگهی‌های پایلوت گزارش v2 — نخود (۶) + پفک (۴) روی مونگوی لوکال.
 * فقط برای تست مرورگر «گزارش آگهی‌ها»؛ روی Atlas اجرا نمی‌شود.
 */
import { readFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import { config } from 'dotenv';

config({ path: '/home/z/my-project/repos/megan-back/.env', override: true });

const url = process.env.LOCAL_DATABASE_URL || 'mongodb://127.0.0.1:27017/megan_local';
const cats = JSON.parse(
  readFileSync('/home/z/my-project/repos/megan-back/scripts/data/categories.json', 'utf8'),
);
const byName = (n) => cats.find((c) => c.category_name.trim() === n);

const حبوبات = byName('حبوبات');
const نخود = byName('نخود');
const تنقلات = byName('تنقلات و شیرینی');
const پفک = byName('پفک');
console.log('ids:', { حبوبات: حبوبات?.id, نخود: نخود?.id, تنقلات: تنقلات?.id, پفک: پفک?.id });

const client = new MongoClient(url);
await client.connect();
const db = client.db();

// شهرهای لازم از Location
const locs = db.collection('Location');
const cityId = async (name) => {
  const d = await locs.findOne({ type: 'city', name });
  return d ? { id: d.buskool_id, parent: d.parent_id } : null;
};
const کرمانشاه = await cityId('کرمانشاه');
const یزد = await cityId('یزد');
const تهران = await cityId('تهران');
const تبریز = await cityId('تبریز');
const بندرعباس = await cityId('بندرعباس');
const اصفهان = await cityId('اصفهان');
const شیراز = await cityId('شیراز');
console.log('cities:', { کرمانشاه, یزد, تهران, تبریز, بندرعباس, اصفهان, شیراز });

// یک فروشندهٔ seed شده
const seller = await db.collection('User').findOne({});
const sellerId = seller._id;
console.log('seller:', seller.user_name);

// استخراج استان از parent کلید شهر
const provinceOf = async (c) => {
  if (!c?.parent) return 0;
  const p = await locs.findOne({ _id: c.parent });
  return p ? p.buskool_id : 0;
};

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 864e5);

const mk = async (id, name, cat, sub, city, price, stock, min, days, view) => ({
  _id: id,
  product_name: name,
  slug: `pilot-${id}`,
  description: 'آگهی پایلوت تست گزارش v2.',
  category_id: cat.id,
  sub_category_id: sub.id,
  unit: 'کیلوگرم',
  province_id: await provinceOf(city),
  city_id: city.id,
  stock,
  min_sale_amount: min,
  min_sale_price: price,
  price_validity_days: 3,
  price_updated_at: daysAgo(days),
  features: null,
  status: 'confirmed',
  rejection_reasons: [],
  is_ladder: false,
  ladder_expires_at: null,
  is_elevated: false,
  has_video: false,
  is_old: false,
  view_count: view,
  user_id: sellerId,
  created_at: daysAgo(days + 1),
  updated_at: daysAgo(days),
});

const rows = [
  await mk(9_000_001, 'نخود کابل درجه یک محصول امسال — بار کرمانشاه', حبوبات, نخود, کرمانشاه, 96500, 12000, 50, 0, 210),
  await mk(9_000_002, 'نخود ممبلی اردکان صادراتی — برداشت مستقیم از کشاورز', حبوبات, نخود, یزد, 142500, 45000, 1000, 0, 180),
  await mk(9_000_003, 'نخود لک فله — آماده بارگیری از بازار تهران', حبوبات, نخود, تهران, 88500, 8000, 500, 1, 95),
  await mk(9_000_004, 'نخود کابل پوست‌کنده آماده بسته‌بندی (سورت ماشینی)', حبوبات, نخود, تبریز, 124000, 5000, 100, 1, 76),
  await mk(9_000_005, 'نخود ممبلی بوداده فله — ماده اولیه تنقلات و بسته‌بندی', حبوبات, نخود, یزد, 168000, 800, 10, 2, 150),
  await mk(9_000_006, 'نخود صادراتی ممتاز خلوص ۹۹٪ — آماده سورت و صادرات', حبوبات, نخود, بندرعباس, 129000, 120000, 10000, 3, 320),
  await mk(9_000_007, 'پفک چی‌توز پنیر — کارتن ۶۰ عددی ۵۰ گرمی', تنقلات, پفک, تهران, 540000, 350, 2, 0, 410),
  await mk(9_000_008, 'پفک مینو پنیر — کارتن ۴۰ عددی ۵۰ گرمی', تنقلات, پفک, اصفهان, 520000, 120, 4, 0, 88),
  await mk(9_000_009, 'پفک عالیس فلفلی — کارتن ۶۰ عددی ۵۰ گرمی', تنقلات, پفک, شیراز, 560000, 80, 10, 1, 66),
  await mk(9_000_010, 'پفک فله کیلویی (بدون برند) — کارتن ۱۰ کیلویی', تنقلات, پفک, تهران, 950000, 150, 1, 2, 130),
];

for (const r of rows) {
  await db.collection('Product').replaceOne({ _id: r._id }, r, { upsert: true });
}
console.log(`✔ ${rows.length} آگهی پایلوت درج شد`);
await client.close();
