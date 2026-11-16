/**
 * اعتبارسنجی فقط-خواندنی نگاشت v2 روی دیتای واقعی Atlas (megan_online_db).
 * هیچ چیزی نمی‌نویسد — فقط aggregate + گزارش پوشش.
 *   node scripts/validate-taxonomy-map.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

// DATABASE_URL از .env ترَک‌شدهٔ گیت (نسخهٔ ابری — فایل کاری ممکن است local باشد؛ بدون چاپ)
const envTxt = execSync('git show HEAD:.env', { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const m = /^DATABASE_URL=(.+)$/m.exec(envTxt);
if (!m) throw new Error('DATABASE_URL not found');
const url = m[1].trim().replace(/^"|"$/g, '');

// نگاشت از فایل تولیدی
const gen = readFileSync(new URL('../src/admin/ads-report/buskol-map.generated.ts', import.meta.url), 'utf8');
const ids = new Map();
let r;
const re = /  (\d+): '([^']+)'/g;
while ((r = re.exec(gen)) !== null) ids.set(Number(r[1]), r[2]);

const client = new MongoClient(url, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db();
console.log('db:', db.databaseName);

const [total, bySub, cats] = await Promise.all([
  db.collection('Product').countDocuments({}),
  db.collection('Product').aggregate([{ $group: { _id: '$sub_category_id', n: { $sum: 1 } } }]).toArray(),
  db.collection('Category').find({}, { projection: { _id: 1, category_name: 1, parent_id: 1 } }).toArray(),
]);
const catName = new Map(cats.map((c) => [c._id, (c.category_name || '').trim()]));

let mapped = 0;
const unmapped = [];
const perRoot = new Map();
const perNode = new Map();
for (const g of bySub) {
  const key = ids.get(g._id);
  if (!key) {
    unmapped.push([g._id, catName.get(g._id) ?? '?', g.n]);
    continue;
  }
  mapped += g.n;
  const root = key.split('.')[0];
  perRoot.set(root, (perRoot.get(root) ?? 0) + g.n);
  const chain = key.split('.');
  for (let i = 1; i <= chain.length; i++) {
    const k = chain.slice(0, i).join('.');
    perNode.set(k, (perNode.get(k) ?? 0) + g.n);
  }
}

console.log(`\nمحصولات: ${total} | روی v2: ${mapped} (${((mapped / total) * 100).toFixed(1)}٪) | نگاشت‌نشده: ${total - mapped}`);
console.log('\nتوزیع ریشه‌های v2:');
for (const [k, v] of [...perRoot.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${String(v).padStart(6)}`);
console.log('\n۲۰ گره پرحجم:');
for (const [k, v] of [...perNode.entries()].filter(([k]) => k.includes('.')).sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(6)}`);
if (unmapped.length) {
  console.log('\nنگاشت‌نشده‌ها (id / نام باسکول / تعداد):');
  for (const [id, name, n] of unmapped.sort((a, b) => b[2] - a[2]).slice(0, 15)) console.log(`  ${id} / ${name} / ${n}`);
}

// دسته‌های DB که در نگاشت نیستند (بیش از seed ۶۹۵تایی — مثلاً تازه‌های ایمپورت)
const extraCats = cats.filter((c) => !ids.has(c._id));
console.log(`\nدسته‌های DB خارج از نگاشت: ${extraCats.length}`);
for (const c of extraCats.slice(0, 10)) console.log(`  ${c._id} / ${c.category_name}`);

await client.close();
