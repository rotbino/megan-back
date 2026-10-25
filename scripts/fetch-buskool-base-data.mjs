#!/usr/bin/env node
/**
 * کراول داده‌های پایه از APIهای عمومی باسکول:
 *   - POST /get_category_list {parent_id}     → کل درخت دسته‌ها (BFS)
 *   - POST /location/get_location_info {city_id}      → همه استان‌ها (۳۱)
 *   - POST /location/get_location_info {province_id}  → شهرهای هر استان
 * خروجی: scripts/data/{categories,provinces,cities}.json
 * اجرا: node scripts/fetch-buskool-base-data.mjs   (یا bun run seed:base-data)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const API = 'https://www.buskool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const DELAY_MS = 150; // مؤدبانه با سرور باسکول

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1000 * attempt); // تلاش مجدد با فاصله
    }
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  // ── درخت دسته‌بندی‌ها: BFS از ریشه ──
  console.log('▶ کراول درخت دسته‌بندی‌ها از باسکول…');
  const categories = [];
  const seen = new Set();
  let queue = [null]; // parent_id های در انتظار
  while (queue.length) {
    const next = [];
    for (const parent of queue) {
      const { status, categories: children } = await post('/get_category_list', {
        parent_id: parent,
      });
      if (!status) throw new Error(`get_category_list failed for parent=${parent}`);
      for (const c of children) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        categories.push(c);
        next.push(c.id);
      }
      await sleep(DELAY_MS);
    }
    queue = next;
    console.log(`  … ${categories.length} دسته تاکنون`);
  }
  writeFileSync(join(DATA_DIR, 'categories.json'), JSON.stringify(categories, null, 2));
  console.log(`✔ ${categories.length} دسته ذخیره شد → data/categories.json`);

  // ── استان‌ها ──
  console.log('▶ کراول استان‌ها…');
  const { status: st1, provinces } = await post('/location/get_location_info', { city_id: 230 });
  if (!st1) throw new Error('دریافت استان‌ها شکست خورد');
  writeFileSync(join(DATA_DIR, 'provinces.json'), JSON.stringify(provinces, null, 2));
  console.log(`✔ ${provinces.length} استان ذخیره شد → data/provinces.json`);

  // ── شهرها ──
  console.log('▶ کراول شهرهای هر استان…');
  const cities = [];
  for (const p of provinces) {
    const { status, cities: cs } = await post('/location/get_location_info', {
      province_id: p.id,
    });
    if (!status) throw new Error(`دریافت شهرهای استان ${p.id} شکست خورد`);
    cities.push(...cs);
    await sleep(DELAY_MS);
    console.log(`  … ${cities.length} شهر (${p.province_name.trim()})`);
  }
  writeFileSync(join(DATA_DIR, 'cities.json'), JSON.stringify(cities, null, 2));
  console.log(`✔ ${cities.length} شهر ذخیره شد → data/cities.json`);
}

main().catch((err) => {
  console.error('✖', err);
  process.exit(1);
});
