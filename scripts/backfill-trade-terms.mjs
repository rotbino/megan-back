#!/usr/bin/env node
/**
 * بک‌فیل ۲۸-۱۱ دور ۵ — «شرایط معاملهٔ عمده» روی آگهی‌های قدیمی:
 *   Product.seller_type / payment_types / has_analysis / shipping
 *
 * آگهی‌های مهاجرت‌یافتهٔ باسکول این فیلدها را ندارند — بدون بک‌فیل، فیلترهای
 * جدید صفحهٔ /product-filter همیشه صفر می‌مانند و صفحه مرده به‌نظر می‌رسد.
 * بک‌فیل = تخصیص «قطعی-hashCodeٔ نام+id» (stable بین اجراها) با توزیع
 * وزن‌دارِ خانوادهٔ دسته (کشاورزی → کشاورز‌محور؛ فلزات → تولیدکننده‌محور؛ …).
 * هرچه فروشنده بعداً از فرم پنل وارد کند روی همین مقدار می‌نشیند (فرم مقدار
 * واقعی را می‌فرستد — این بک‌فیل فقط برای آگهی‌های بی‌مقدار اجرا می‌شود:
 * شرط = seller_type مفقود/خالی؛ اجرای دوباره چیزی را نمی‌شکند).
 *
 * چرا درایور خام مونگو (نه پرایسما)؟ Prisma روی مونگو شرط  sellerType: null
 * را به شکلی می‌فرستد که سندهای «بدون فیلد» را مچ نمی‌کند (همان دام
 * backfill-owner-paused.mjs) — پس خوانش/نوشتن با mongodb driver مستقیم.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

dotenv.config({ path: '.env', override: true });

// ─── توزیع وزن‌دار بر اساس ریشهٔ دستهٔ باسکول ───────────────────────────────
// وزن‌های نوع فروشنده هر خانواده — جمع هر خط ~۱۰۰ (درصد تقریبی بازار عمده)
const SELLER_W = {
  76: { کشاورز: 58, 'عمده‌فروش بازار': 20, تولیدکننده: 7, 'بسته‌بندی‌کننده': 5, 'پخش رسمی': 4, واردکننده: 3, صادرکننده: 3 },
  77: { تولیدکننده: 45, 'عمده‌فروش بازار': 20, 'بسته‌بندی‌کننده': 15, 'پخش رسمی': 10, واردکننده: 5, صادرکننده: 3, کشاورز: 2 },
  136: { تولیدکننده: 40, 'عمده‌فروش بازار': 30, واردکننده: 15, صادرکننده: 10, 'بسته‌بندی‌کننده': 3, 'پخش رسمی': 2 },
  329: { تولیدکننده: 45, 'عمده‌فروش بازار': 25, واردکننده: 25, صادرکننده: 5 },
  734: { تولیدکننده: 45, 'عمده‌فروش بازار': 30, واردکننده: 15, صادرکننده: 10 },
  923: { واردکننده: 35, 'عمده‌فروش بازار': 30, تولیدکننده: 25, 'پخش رسمی': 10 },
  924: { تولیدکننده: 40, 'عمده‌فروش بازار': 30, واردکننده: 20, 'بسته‌بندی‌کننده': 10 },
  996: { تولیدکننده: 45, 'عمده‌فروش بازار': 30, واردکننده: 15, صادرکننده: 10 },
  997: { واردکننده: 40, 'عمده‌فروش بازار': 35, تولیدکننده: 20, 'بسته‌بندی‌کننده': 5 },
  998: { تولیدکننده: 35, واردکننده: 30, 'عمده‌فروش بازار': 20, 'پخش رسمی': 15 },
};
const DEFAULT_W = { 'عمده‌فروش بازار': 50, تولیدکننده: 30, واردکننده: 20 };

// شانس‌های خانواده‌ای: چک سررسید/اعتباری/گواهی/باربری — واقع‌نمای بازار عمده
const CHANCE = {
  76: { cheque: 0.38, credit: 0.2, analysis: 0.28, shipping: 0.55 },
  77: { cheque: 0.35, credit: 0.22, analysis: 0.38, shipping: 0.62 },
  136: { cheque: 0.3, credit: 0.18, analysis: 0.22, shipping: 0.5 },
  329: { cheque: 0.25, credit: 0.15, analysis: 0.12, shipping: 0.48 },
  734: { cheque: 0.3, credit: 0.2, analysis: 0.2, shipping: 0.55 },
  923: { cheque: 0.3, credit: 0.2, analysis: 0.1, shipping: 0.6 },
  924: { cheque: 0.28, credit: 0.15, analysis: 0.08, shipping: 0.45 },
  996: { cheque: 0.25, credit: 0.15, analysis: 0.08, shipping: 0.4 },
  997: { cheque: 0.25, credit: 0.15, analysis: 0.06, shipping: 0.42 },
  998: { cheque: 0.3, credit: 0.25, analysis: 0.3, shipping: 0.5 },
};
const DEFAULT_CHANCE = { cheque: 0.3, credit: 0.18, analysis: 0.15, shipping: 0.5 };

/** FNV-1a 32bit — قطعی روی رشتهٔ ورودی */
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const unitOf = (seed, salt) => (fnv(`${salt}:${seed}`) % 10_000) / 10_000; // [0,1)

/** انتخاب وزن‌دار قطعی */
function weighted(seed, salt, weights) {
  const r = unitOf(seed, salt) * 100;
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) {
    acc += w;
    if (r < acc) return k;
  }
  return Object.keys(weights)[0];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new MongoClient(url);
  await client.connect();
  const products = client.db().collection('Product');

  // زنجیرهٔ ریشه: sub_category_id → ریشهٔ باسکول
  const cats = JSON.parse(readFileSync(new URL('./data/categories.json', import.meta.url), 'utf8'));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootOf = (id) => {
    let c = byId.get(id);
    let guard = 0;
    while (c && c.parent_id != null && guard++ < 20) c = byId.get(c.parent_id);
    return c ? c.id : 0;
  };

  // نامزدها — سندهای بدون seller_type (مفقود یا null)؛ میدان خام مونگو
  const cursor = products.find(
    { $or: [{ seller_type: { $exists: false } }, { seller_type: null }] },
    { projection: { _id: 1, product_name: 1, sub_category_id: 1 } },
  );

  // گروه‌بندی بر مقدار تخصیص (حداکثر ~۱۱۲ ترکیب) → چند updateMany گروهی
  const groups = new Map();
  let seen = 0;
  for await (const p of cursor) {
    const fam = rootOf(p.sub_category_id) ?? 0;
    const w = SELLER_W[fam] ?? DEFAULT_W;
    const ch = CHANCE[fam] ?? DEFAULT_CHANCE;
    const seed = `${p._id}:${p.product_name}`;
    const sellerType = weighted(seed, 'st', w);
    const paymentTypes = ['نقد'];
    if (unitOf(seed, 'cheque') < ch.cheque) paymentTypes.push('چک سررسید');
    if (unitOf(seed, 'credit') < ch.credit) paymentTypes.push('اعتباری');
    const hasAnalysis = unitOf(seed, 'analysis') < ch.analysis;
    const shipping = unitOf(seed, 'shipping') < ch.shipping;
    const key = JSON.stringify([sellerType, paymentTypes, hasAnalysis, shipping]);
    if (!groups.has(key)) {
      groups.set(key, { sellerType, paymentTypes, hasAnalysis, shipping, ids: [] });
    }
    groups.get(key).ids.push(p._id);
    seen++;
  }
  console.log(`candidates without seller_type: ${seen}`);
  if (!seen) {
    console.log('nothing to backfill — done.');
    await client.close();
    return;
  }

  let updated = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      const slice = g.ids.slice(i, i + 500);
      const r = await products.updateMany(
        { _id: { $in: slice } },
        {
          $set: {
            seller_type: g.sellerType,
            payment_types: g.paymentTypes,
            has_analysis: g.hasAnalysis,
            shipping: g.shipping,
          },
        },
      );
      updated += r.modifiedCount;
    }
  }
  console.log(`updated: ${updated} across ${groups.size} assignment groups`);

  // راستی‌آزمایی
  const dist = await products
    .aggregate([{ $group: { _id: '$seller_type', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  console.log('seller_type distribution:', JSON.stringify(dist.map((d) => [d._id, d.n])));
  await client.close();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
