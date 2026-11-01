/**
 * آماده‌سازی وضعیت تست مرورگر دور دهم (فونت + قانون انتشار نظرات).
 * کارها:
 *   • فروشندهٔ واقعی با آگهی confirmed پیدا می‌کند (صفحهٔ محصول/پروفایل واقعی).
 *   • خریدار C: چت با فروشنده → ثبت نظر pending (برای کارت سنجاق‌شده).
 *   • خریدار E: بدون هیچ تماس/چتی (برای نمایش پیام گیت در فرم).
 *   • ادمین تست برای پنل.
 * خروجی: JSON با توکن‌ها و آدرس‌ها برای مرورگر.
 * اجرا: node scripts/setup-browser-review-test.mjs
 */
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:4000/api/v1';

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function login(phone) {
  const s = await post('auth/sendOtp', { phone });
  const v = await post('auth/verifyOtp', { phone, code: s.json?.data?.devCode });
  return v.json?.data?.accessToken ?? null;
}

const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

// ادمین تست
const ADMIN_USER = 'test_browser_admin';
const ADMIN_PASS = randomBytes(12).toString('base64url');
async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64url')}`;
}

// ─── فروشندهٔ واقعی ─────────────────────────────────────────────────────────
const product = await prisma.product.findFirst({
  where: { status: 'confirmed' },
  orderBy: { updatedAt: 'desc' },
  select: {
    id: true,
    slug: true,
    productName: true,
    subCategoryId: true,
    user: { select: { id: true, userName: true, firstName: true, lastName: true } },
  },
});
if (!product) {
  console.error('آگهی confirmed پیدا نشد');
  process.exit(1);
}
const seller = product.user;
const subCat = await prisma.category.findUnique({ where: { id: product.subCategoryId }, select: { categoryName: true } });

// ─── خریدار C (با چت + نظر pending) ────────────────────────────────────────
const rnd = Math.floor(Math.random() * 7_800_000);
const phoneC = '0935' + String(2_100_000 + rnd);
const phoneE = '0936' + String(2_100_000 + rnd);
const tokenC = await login(phoneC);
const tokenE = await login(phoneE);

const th = await post('chat/startThread', { userName: seller.userName }, tokenC);
await post('chat/sendMessage', { threadId: th.json?.data?.id, text: 'سلام؛ برای خرید عمده پیام دادم.' }, tokenC);
const rv = await post('reviews/addSellerReview', { userName: seller.userName, rating: 5, text: 'چت کردیم؛ فروشنده پاسخگو و خوش‌قول بود. کیفیت مرسوم اول بود.' }, tokenC);
const reviewId = rv.json?.data?.id;

// ─── ادمین ──────────────────────────────────────────────────────────────────
await prisma.adminUser.upsert({
  where: { username: ADMIN_USER },
  update: { isActive: true, passwordHash: await makeHash(ADMIN_PASS) },
  create: { username: ADMIN_USER, passwordHash: await makeHash(ADMIN_PASS), role: 'SUPER_ADMIN', isActive: true },
});
const al = await post('admin/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
const adminToken = al.json?.data?.token ?? al.json?.data?.accessToken;

const userC = await prisma.user.findUnique({ where: { phone: phoneC }, select: { id: true, userName: true, firstName: true, lastName: true } });
const userE = await prisma.user.findUnique({ where: { phone: phoneE }, select: { id: true, userName: true, firstName: true, lastName: true } });

console.log(
  JSON.stringify(
    {
      product: { id: product.id, slug: product.slug, name: product.productName, category: subCat?.categoryName ?? '' },
      seller: { userName: seller.userName, name: `${seller.firstName} ${seller.lastName}`.trim() },
      buyerC: { phone: phoneC, token: tokenC, userId: userC.id },
      buyerE: { phone: phoneE, token: tokenE, userId: userE.id },
      reviewId,
      admin: { username: ADMIN_USER, password: ADMIN_PASS, token: adminToken },
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
