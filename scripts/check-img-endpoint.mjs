// تست زندهٔ endpoint تصاویر با فیلترهای URL کاربر — آیا همهٔ عکس‌های هر آگهی می‌آیند؟
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

const TEST_ADMIN = `e2e-img-${Date.now().toString(36)}`;
const TEST_PASS = 'ImgT-' + randomBytes(6).toString('base64url');
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

// فیلترهای URL کاربر: from=2026-11-14T20:30:00Z to=2026-11-15T20:29:59.999Z (fld=updated پیش‌فرض)
const qs = new URLSearchParams({
  page: '1',
  pageSize: '50',
  sort: 'productUpdated',
  dir: 'desc',
  updatedFrom: '2026-11-14T20:30:00.000Z',
  updatedTo: '2026-11-15T20:29:59.999Z',
});
const res = await fetch(`${BASE}/importer/product-images?${qs}`, { headers: auth });
const body = await res.json();
const data = body?.data;
console.log('HTTP', res.status, '| total:', data?.total, '| rows:', data?.rows?.length, '| pageCount:', data?.pageCount);

// گروه‌بندی بر اساس آگهی — چند عکس از هر آگهی در صفحهٔ ۱ آمده؟
const byProduct = {};
for (const r of data?.rows ?? []) {
  const pid = r.product?.id ?? r.relatedId ?? '?';
  byProduct[pid] = (byProduct[pid] ?? 0) + 1;
}
const counts = Object.values(byProduct);
console.log('products in page-1:', Object.keys(byProduct).length, '| photo-counts per product:', JSON.stringify(counts));
// نمونهٔ آگهی چندعکسی در پاسخ
for (const [pid, n] of Object.entries(byProduct)) {
  if (n > 1) { console.log(`نمونهٔ چندعکسی در پاسخ: #${pid} با ${n} عکس`); break; }
}

// چک مستقیم DB برای همان بازه: آگهی چندعکسه‌ای در بازه هست که فقط ۱ عکسش آمده؟
const inRange = await prisma.product.findMany({
  where: { updatedAt: { gte: new Date('2026-11-14T20:30:00.000Z'), lte: new Date('2026-11-15T20:29:59.999Z') } },
  select: { id: true, productName: true },
  take: 200,
});
console.log('products in range (DB):', inRange.length);
const fileAgg = (await prisma.$runCommandRaw({
  aggregate: 'File',
  pipeline: [
    { $match: { related_model: 'Product', field_key: 'gallery', related_id: { $in: inRange.map((p) => String(p.id)) } } },
    { $group: { _id: '$related_id', count: { $sum: 1 } } },
  ],
  cursor: {},
})).cursor.firstBatch;
const multi = fileAgg.filter((f) => f.count > 1);
console.log('products with >1 photos in range:', multi.length, '| sample:', multi.slice(0, 3).map((m) => `#${m._id}:${m.count}`).join(' '));

await prisma.adminUser.delete({ where: { username: TEST_ADMIN } }).catch(() => {});
await prisma.$disconnect();
