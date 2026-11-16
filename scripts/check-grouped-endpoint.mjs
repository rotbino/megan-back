// تست زندهٔ endpoint گروهی (?group=product) با فیلترهای URL کاربر
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

const TEST_ADMIN = `e2e-grp-${Date.now().toString(36)}`;
const TEST_PASS = 'GrpT-' + randomBytes(6).toString('base64url');
async function hashPassword(plain) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}
await prisma.adminUser.create({
  data: { username: TEST_ADMIN, passwordHash: await hashPassword(TEST_PASS), name: 'تست موقت', role: 'ADMIN', isActive: true },
});

const BASE = 'http://localhost:4000/api/v1';
const loginRes = await fetch(`${BASE}/admin/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: TEST_ADMIN, password: TEST_PASS }),
});
const token = (await loginRes.json())?.data?.token;
if (!token) { console.error('login failed'); process.exit(1); }
const auth = { Authorization: `Bearer ${token}` };

const qs = new URLSearchParams({
  group: 'product',
  page: '1',
  pageSize: '50',
  sort: 'productUpdated',
  dir: 'desc',
  updatedFrom: '2026-11-14T20:30:00.000Z',
  updatedTo: '2026-11-15T20:29:59.999Z',
});
const res = await fetch(`${BASE}/importer/product-images?${qs}`, { headers: auth });
const data = (await res.json())?.data;
console.log('HTTP', res.status, '| total(products):', data?.total, '| rows:', data?.rows?.length, '| pageCount:', data?.pageCount);
console.log('summary:', JSON.stringify(data?.summary));

// چک: هر ردیف = یک آگهی با همهٔ عکس‌هایش
const bad = [];
for (const r of data?.rows ?? []) {
  if (!r.product || !Array.isArray(r.photos)) { bad.push(`row without product/photos: ${JSON.stringify(r).slice(0, 80)}`); continue; }
  if (r.photoCount !== r.photos.length) bad.push(`#${r.product.id}: photoCount=${r.photoCount} != photos.length=${r.photos.length}`);
  if (r.totalSize !== r.photos.reduce((s, p) => s + p.size, 0)) bad.push(`#${r.product.id}: totalSize mismatch`);
  for (const p of r.photos) if (!p.url || !p.id) bad.push(`#${r.product.id}: photo without url/id`);
}
console.log('bad rows:', bad.length, bad.slice(0, 3));

// نمونه‌ها: چند آگهی چندعکسه
const multi = (data?.rows ?? []).filter((r) => r.photos.length > 1).slice(0, 5);
for (const r of multi) console.log(`  #${r.product.id} ${r.product.name.slice(0, 25)} → ${r.photos.length} عکس، ${(r.totalSize / 1024).toFixed(0)}KB، مالک: ${r.owner?.userName ?? '—'}`);

// مقایسه با DB: تعداد آگهی‌های عکس‌دار در بازه
const dbCount = await prisma.product.count({
  where: { updatedAt: { gte: new Date('2026-11-14T20:30:00.000Z'), lte: new Date('2026-11-15T20:29:59.999Z') } },
});
console.log(`DB products in range: ${dbCount} (endpoint total: ${data?.total} — نباید بیشتر از DB باشد)`);

// تست سورت photoCount
const qs2 = new URLSearchParams({ group: 'product', page: '1', pageSize: '10', sort: 'photoCount', dir: 'desc' });
const res2 = await fetch(`${BASE}/importer/product-images?${qs2}`, { headers: auth });
const data2 = (await res2.json())?.data;
console.log('\nphotoCount-desc top10:', (data2?.rows ?? []).map((r) => r.photos.length).join(','));

// تست سورت size + فیلتر source=buskool + replaced=no
const qs3 = new URLSearchParams({ group: 'product', page: '1', pageSize: '10', sort: 'size', dir: 'desc', source: 'buskool', replaced: 'no' });
const res3 = await fetch(`${BASE}/importer/product-images?${qs3}`, { headers: auth });
const data3 = (await res3.json())?.data;
console.log('size-desc buskool unreplaced top10 (KB):', (data3?.rows ?? []).map((r) => (r.totalSize / 1024).toFixed(0)).join(','));

// تست جستجو
const qs4 = new URLSearchParams({ group: 'product', page: '1', pageSize: '10', q: 'زرشک' });
const res4 = await fetch(`${BASE}/importer/product-images?${qs4}`, { headers: auth });
const data4 = (await res4.json())?.data;
console.log('\nq=زرشک →', data4?.total, 'آگهی:', (data4?.rows ?? []).slice(0, 5).map((r) => `#${r.product.id}(${r.photos.length}عکس)`).join(' '));

// صفحهٔ ۲ (صفحه‌بندی بر آگهی)
const qs5 = new URLSearchParams({ group: 'product', page: '2', pageSize: '30', sort: 'productUpdated', dir: 'desc', updatedFrom: '2026-11-14T20:30:00.000Z', updatedTo: '2026-11-15T20:29:59.999Z' });
const res5 = await fetch(`${BASE}/importer/product-images?${qs5}`, { headers: auth });
const data5 = (await res5.json())?.data;
const page1Ids = new Set((data?.rows ?? []).map((r) => r.product.id));
const overlap = (data5?.rows ?? []).filter((r) => page1Ids.has(r.product.id)).length;
console.log(`\npage2(pageSize=30): rows=${data5?.rows?.length} overlap-with-page1(50): ${overlap} (باید 0-چند آگهی مرزی باشد — صفحه‌بندی آگهی‌محور)`);

await prisma.adminUser.delete({ where: { username: TEST_ADMIN } }).catch(() => {});
await prisma.$disconnect();
