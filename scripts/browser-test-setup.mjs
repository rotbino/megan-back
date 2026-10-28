/**
 * آماده‌سازی دیتای تست مرورگر د-۹:
 *  • Y = کاربر خریدار (لاگین در مرورگر با localStorage)
 *  • X = فروشنده‌ی یک آگهی confirmed (برای چت/آنلاین/بج)
 * خروجی: /tmp/browser-test-data.json
 * اجرا: node scripts/browser-test-setup.mjs
 */
const BASE = 'http://localhost:4000/api/v1';

async function post(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function login(phone) {
  await post('auth/sendOtp', { phone });
  const v = await post('auth/verifyOtp', { phone, code: '1234' });
  const token = v.json?.data?.accessToken;
  const refreshToken = v.json?.data?.refreshToken;
  const p = await post('users/getProfile', {}, token);
  return { token, refreshToken, userId: p.json?.data?.user?.id, userName: p.json?.data?.user?.user_name, phone };
}

const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

// Y — خریدار تازه
const Y = await login('0914' + String(4_100_000 + Math.floor(Math.random() * 5_800_000)));

// X — مالک یک آگهی confirmed با حداقل ۳ حرف نام
const product = await prisma.product.findFirst({
  where: { status: 'confirmed' },
  orderBy: { id: 'desc' },
  select: { id: true, productName: true, slug: true, userId: true, subCategoryId: true, categoryId: true },
});
const category = await prisma.category.findUnique({
  where: { id: product.subCategoryId },
  select: { categoryName: true },
});
const seller = await prisma.user.findUnique({ where: { id: product.userId }, select: { id: true, userName: true, phone: true, firstName: true, lastName: true } });
const X = await login(seller.phone);

// نبض X تا ۹۰ ثانیه «آنلاین» بماند (تست نشان سبز)
await post('presence/heartbeat', {}, X.token);

// پیام‌های اولیه از X به Y — گفتگوی مستقیم (برای بج قبل از باز کردن چت)
const th = await post('chat/startThread', { userName: Y.userName }, X.token);
const threadId = th.json?.data?.id;
await post('chat/sendMessage', { threadId, text: 'سلام! قیمت روز را همین‌جا اعلام می‌کنم.' }, X.token);
await post('chat/sendMessage', { threadId, text: 'برای حجم بالا تخفیف هم داریم.' }, X.token);

// URL صفحه آگهی — الگوی کارت محصول فرانت: /product-view/{slug}/{نام دسته}/{id}
const productUrl = `/product-view/${encodeURIComponent(product.slug)}/${encodeURIComponent(category?.categoryName ?? '')}/${product.id}`;

const data = {
  Y, X: { ...X, id: seller.id, userName: seller.userName, firstName: seller.firstName, lastName: seller.lastName },
  product: { id: product.id, name: product.productName, slug: product.slug, categoryName: category?.categoryName ?? '' },
  threadId,
  productUrl,
};

const fs = await import('node:fs');
fs.writeFileSync('/tmp/browser-test-data.json', JSON.stringify(data, null, 2));
await prisma.$disconnect();
console.log(JSON.stringify({ ...data, Y: { ...data.Y, token: '…' }, X: { ...data.X, token: '…' } }, null, 2));
console.log('\nproductUrl:', data.productUrl);
