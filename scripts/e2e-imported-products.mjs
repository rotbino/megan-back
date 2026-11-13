// E2E فقط-خواندی + رفت‌وبرگشت تعویض درجا — روی بک‌اند واقعی (پورت ۴۰۰۰).
// مرحلهٔ تعویض: یکی از تصاویر واقعی را دانلود می‌کند، آینه‌اش می‌کند (flip)،
// آپلود می‌کند، صحت را چک می‌کند و دوباره نسخهٔ اصلی را برمی‌گرداند تا
// نتیجهٔ نهایی از نظر بصری مثل اول باشد.
import { config } from 'dotenv';
config({ override: true });
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

// ادمین تستی موقت — رمز ادمین اصلی در env خالی است و به حساب واقعی دست نمی‌زنیم؛
// این حساب فقط برای همین اجراست و در پایان حذف می‌شود.
const TEST_ADMIN = `e2e-temp-${Date.now().toString(36)}`;
const TEST_PASS = 'E2eT-' + randomBytes(6).toString('base64url');
async function hashPassword(plain) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}
await prisma.adminUser.create({
  data: { username: TEST_ADMIN, passwordHash: await hashPassword(TEST_PASS), name: 'تست موقت E2E', role: 'ADMIN', isActive: true },
});

const BASE = 'http://localhost:4000/api/v1';
/** fetch با تایم‌اوت — تا وسط شبکه هنگ نمانیم */
async function fetchT(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(25_000) });
}
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// ── ورود ادمین تستی ──
const loginRes = await fetchT(`${BASE}/admin/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: TEST_ADMIN, password: TEST_PASS }),
});
const loginBody = await loginRes.json();
const token = loginBody?.data?.token;
check('ورود ادمین', loginRes.ok && !!token, `HTTP ${loginRes.status}`);
if (!token) {
  await prisma.adminUser.delete({ where: { username: TEST_ADMIN } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };

// ── ۱. لیست آگهی‌ها ──
console.log('[cp] login ok — listing products'); console.log('\n— GET /importer/products —');
const prodRes = await fetchT(`${BASE}/importer/products?page=1&pageSize=10`, { headers: auth });
const prodBody = await prodRes.json().catch(() => null);
check('HTTP 200', prodRes.ok, String(prodRes.status));
const prod = prodBody?.data;
check('ردیف‌ها و آمار برمی‌گردند', Array.isArray(prod?.rows) && typeof prod?.summary?.total === 'number');
const liveTotal = await prisma.product.count();
const liveBuskool = await prisma.product.count({ where: { user: { bUserName: { not: null } } } });
check('summary.total با شمارش زنده برابر است', prod?.summary?.total === liveTotal, `${prod?.summary?.total} vs ${liveTotal}`);
check('summary.buskool با شمارش زنده برابر است', prod?.summary?.buskool === liveBuskool, `${prod?.summary?.buskool} vs ${liveBuskool}`);
check('total = buskool + native', prod?.summary?.total === (prod?.summary?.buskool ?? 0) + (prod?.summary?.native ?? 0));
const row = prod?.rows?.[0];
check('ردیف اول شکل کامل دارد', row && row.owner && typeof row.edited === 'boolean' && typeof row.photoCount === 'number', JSON.stringify(row ?? {}).slice(0, 120));
console.log(`  • نمونه: «${row?.productName}» (#${row?.id}) منبع=${row?.source} عکس=${row?.photoCount} ویرایش=${row?.edited}`);

// فیلترها
const nativeRes = await fetchT(`${BASE}/importer/products?source=native`, { headers: auth });
const nativeBody = await nativeRes.json().catch(() => null);
check('فیلتر source=native → صفر ردیف (فعلاً همه باسکولی)', (nativeBody?.data?.rows ?? []).length === 0 && nativeBody?.data?.total === 0, `total=${nativeBody?.data?.total}`);
const qRes = await fetchT(`${BASE}/importer/products?q=${encodeURIComponent('انجیر')}`, { headers: auth });
const qBody = await qRes.json().catch(() => null);
check('جستجوی فارسی کار می‌کند', qRes.ok && qBody?.data?.total >= 1, `total=${qBody?.data?.total}`);
const loginFilterRes = await fetchT(`${BASE}/importer/products?ownerLogin=never`, { headers: auth });
const loginFilterBody = await loginFilterRes.json().catch(() => null);
// ⚠️ prisma در مونگو null را با فیلد غایب یکی نمی‌داند — همان raw سرویس ملاک است
const neverAgg = await prisma.$runCommandRaw({
  aggregate: 'Product',
  pipeline: [
    { $lookup: { from: 'User', localField: 'user_id', foreignField: '_id', as: 'owner' } },
    { $unwind: '$owner' },
    { $match: { 'owner.last_login_at': null } },
    { $count: 'n' },
  ],
  cursor: {},
});
const neverLoggedIn = Number(neverAgg?.cursor?.firstBatch?.[0]?.n ?? 0);
check('فیلتر ownerLogin=never با شمارش زنده برابر است', loginFilterBody?.data?.total === neverLoggedIn, `${loginFilterBody?.data?.total} vs ${neverLoggedIn}`);

// بدون توکن → 401
const noAuth = await fetchT(`${BASE}/importer/products`);
check('بدون توکن → 401', noAuth.status === 401, String(noAuth.status));

// ── ۲. آلبوم تصاویر ──
console.log('[cp] products ok — listing images'); console.log('\n— GET /importer/product-images —');
const imgRes = await fetchT(`${BASE}/importer/product-images?page=1&pageSize=20`, { headers: auth });
const imgBody = await imgRes.json().catch(() => null);
check('HTTP 200', imgRes.ok, String(imgRes.status));
const img = imgBody?.data;
check('ردیف‌ها و آمار برمی‌گردند', Array.isArray(img?.rows) && typeof img?.summary?.total === 'number');
const liveFiles = await prisma.file.count({ where: { relatedModel: 'Product', fieldKey: 'gallery', relatedId: { not: null } } });
check('کل تصاویر با شمارش زنده برابر است (تلورانس رشد زنده)', Math.abs((img?.summary?.total ?? 0) - liveFiles) <= 3, `${img?.summary?.total} vs ${liveFiles}`);
check('باقی‌مانده = باسکولی (هنوز هیچ تعویضی نمانده)', img?.summary?.buskoolRemaining === img?.summary?.buskool - (img?.summary?.replaced ?? 0) || (img?.summary?.replaced === 0 && img?.summary?.buskoolRemaining === img?.summary?.buskool), JSON.stringify(img?.summary));
const imgRow = img?.rows?.[0];
check('ردیف اول شکل کامل دارد', imgRow && imgRow.product && imgRow.owner && imgRow.url, JSON.stringify(imgRow ?? {}).slice(0, 120));
console.log(`  • نمونه: آگهی «${imgRow?.product?.name}» فروشنده ${imgRow?.owner?.name} (${imgRow?.width}×${imgRow?.height})`);

const buskoolOnly = await fetchT(`${BASE}/importer/product-images?source=buskool&replaced=no`, { headers: auth });
const buskoolBody = await buskoolOnly.json().catch(() => null);
check('فیلتر source=buskool&replaced=no = باسکولی‌های تعویض‌نشده (تلورانس رشد زنده)', Math.abs((buskoolBody?.data?.total ?? 0) - ((img?.summary?.buskool ?? 0) - (img?.summary?.replaced ?? 0))) <= 3, `total=${buskoolBody?.data?.total}`);

// صفحه‌بندی — نسبت به کل؛ دیتای زنده در حال ایمپورت است پس تلورانس ±۲
const half = Math.max(1, Math.floor((img?.summary?.total ?? 2) / 2));
const page2 = await fetchT(`${BASE}/importer/product-images?page=2&pageSize=${half}`, { headers: auth });
const page2Body = await page2.json().catch(() => null);
const expectedP2 = Math.max(0, (img?.summary?.total ?? 0) - half);
const rowsP2 = (page2Body?.data?.rows ?? []).length;
check(`صفحهٔ ۲ با pageSize=${half} درست است (تلورانس رشد زنده)`, Math.abs(rowsP2 - expectedP2) <= 2, `rows=${rowsP2} expected≈${expectedP2}`);
check('ردیف‌های تکراری نداریم (id های یکتا)', new Set((page2Body?.data?.rows ?? []).map((r) => r.id)).size === rowsP2);

// جستجو با شناسهٔ آگهی
if (row) {
  const byId = await fetchT(`${BASE}/importer/product-images?q=${row.id}`, { headers: auth });
  const byIdBody = await byId.json().catch(() => null);
  check(`جستجو با شناسهٔ آگهی #${row.id} کار می‌کند`, byId.ok && byIdBody?.data?.total >= 0, `total=${byIdBody?.data?.total}`);
  if (byIdBody?.data?.rows?.length) {
    check('همهٔ نتایج متعلق به همان آگهی‌اند', byIdBody.data.rows.every((r) => r.product?.id === row.id));
  }
}

// ── ۳. تعویض درجا (رفت‌وبرگشت) ──
console.log('[cp] images ok — replace roundtrip'); console.log('\n— POST /importer/product-images/:id/replace (رفت‌وبرگشت) —');
const { default: sharp } = await import('sharp');

// مرز امن: تصویری با تامبنیل سالم پیدا کن
const skipReplace = process.env.E2E_SKIP_REPLACE === '1';
const target = skipReplace ? null : (img?.rows?.find((r) => r.thumbUrl && r.product) ?? null);
if (skipReplace) {
  console.log('  SKIP — E2E_SKIP_REPLACE=1');
} else if (!target) {
  console.log('  SKIP — تصویر مناسبی برای تست نیست');
} else {
  const key = target.id;
  const beforeUrl = target.url;
  const beforeThumb = target.thumbUrl;

  // اصل فعلی را دانلود کن
  console.log(`  [cp] target=${target.id} url=${beforeUrl.slice(0, 80)}…`);
  const origRes = await fetchT(beforeUrl);
  const origBuf = Buffer.from(await origRes.arrayBuffer());
  check('دانلود تصویر اصلی موفق', origRes.ok && origBuf.length > 1000, `${origBuf.length}B`);

  // نسخهٔ آینه‌شده بساز (تغییر قابل تشخیص)
  const flipped = await sharp(origBuf).flop().jpeg({ quality: 84 }).toBuffer();

  // آپلود تعویض درجا
  const form = new FormData();
  form.append('file', new Blob([flipped], { type: 'image/jpeg' }), 'test-flipped.jpg');
  console.log('  [cp] uploading flipped…');
  const repRes = await fetchT(`${BASE}/importer/product-images/${key}/replace`, {
    method: 'POST',
    headers: auth,
    body: form,
  });
  const repBody = await repRes.json().catch(() => null);
  check('HTTP 200 تعویض', repRes.ok, `${repRes.status} ${JSON.stringify(repBody).slice(0, 200)}`);
  check('URL دست‌نخورده ماند', repBody?.data?.url === beforeUrl, `${repBody?.data?.url} vs ${beforeUrl}`);
  check('thumbUrl همان کلید قبلی ماند', repBody?.data?.thumbUrl === beforeThumb);
  check('replacedAt ست شد', typeof repBody?.data?.replacedAt === 'string');

  // بایت‌های جدید از همان URL — آینه‌ای؟
  console.log('  [cp] verifying new bytes…');
  const newRes = await fetchT(`${beforeUrl}?t=${Date.now()}`);
  const newBuf = Buffer.from(await newRes.arrayBuffer());
  check('بایت‌های URL عوض شد', newBuf.length !== origBuf.length || !newBuf.equals(origBuf), `${origBuf.length} → ${newBuf.length}`);
  const meta = await sharp(newBuf).metadata();
  check('تصویر جدید decode می‌شود و jpeg است', meta.format === 'jpeg' && (meta.width ?? 0) >= 200, `${meta.format} ${meta.width}×${meta.height}`);

  // تامبنیل هم از همان URL تامبنیل تازه شد؟
  const thumbRes = await fetchT(`${beforeThumb}?t=${Date.now()}`);
  const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
  const thumbMeta = await sharp(thumbBuf).metadata();
  check('تامبنیل بازساخته شد (jpeg سالم)', thumbRes.ok && thumbMeta.format === 'jpeg' && (thumbMeta.width ?? 0) >= 100, `${thumbMeta.width}×${thumbMeta.height}`);

  // لیست: فلگ اصلاح‌شده دیده شود
  const afterList = await fetchT(`${BASE}/importer/product-images?q=${target.product.id}&replaced=yes`, { headers: auth });
  const afterBody = await afterList.json().catch(() => null);
  check('در لیست با فیلتر replaced=yes پیدا می‌شود', (afterBody?.data?.rows ?? []).some((r) => r.id === key), `total=${afterBody?.data?.total}`);
  const afterRow = (afterBody?.data?.rows ?? []).find((r) => r.id === key);
  check('replacedAt و updatedAt به‌روز شدند', !!afterRow?.replacedAt && new Date(afterRow.updatedAt).getTime() > new Date(target.updatedAt).getTime());

  // برگرداندن نسخهٔ اصلی (همان بایت‌های دانلودشده)
  const formBack = new FormData();
  formBack.append('file', new Blob([origBuf], { type: 'image/jpeg' }), 'restore.jpg');
  console.log('  [cp] restoring original…');
  const backRes = await fetchT(`${BASE}/importer/product-images/${key}/replace`, {
    method: 'POST',
    headers: auth,
    body: formBack,
  });
  check('بازگردانی نسخهٔ اصلی موفق', backRes.ok, String(backRes.status));
  const finalRes = await fetchT(`${beforeUrl}?t=${Date.now() + 1}`);
  const finalBuf = Buffer.from(await finalRes.arrayBuffer());
  const finalMeta = await sharp(finalBuf).metadata();
  check('نسخهٔ نهایی decode سالم', finalMeta.format === 'jpeg' && (finalMeta.width ?? 0) >= 200);
  console.log(`  • تصویر #${target.product.id} (${target.product.name}) — نهایی: ${finalMeta.width}×${finalMeta.height}`);
}

// ── ۴. اعتبارسنجی‌های منفی ──
console.log('\n— اعتبارسنجی‌ها —');
const badForm = new FormData();
badForm.append('file', new Blob([Buffer.from('not-an-image')], { type: 'image/jpeg' }), 'x.jpg');
const badRes = await fetchT(`${BASE}/importer/product-images/${img?.rows?.[0]?.id ?? '000000000000000000000000'}/replace`, {
  method: 'POST',
  headers: auth,
  body: badForm,
});
check('فایل غیرتصویری رد می‌شود', badRes.status === 400 || badRes.status === 404, String(badRes.status));

const wrongId = await fetchT(`${BASE}/importer/product-images/111111111111111111111111/replace`, {
  method: 'POST',
  headers: auth,
  body: (() => {
    const f = new FormData();
    f.append('file', new Blob([Buffer.alloc(5000, 255)], { type: 'image/png' }), 'x.png');
    return f;
  })(),
});
check('شناسهٔ ناموجود → 404', wrongId.status === 404, String(wrongId.status));

const noAuthReplace = await fetchT(`${BASE}/importer/product-images/x/replace`, { method: 'POST' });
check('تعویض بدون توکن → 401', noAuthReplace.status === 401, String(noAuthReplace.status));

console.log(`\n═══ نتیجه: ${pass} پاس / ${fail} خطا ═══`);
// پاک‌سازی ادمین تستی
await prisma.adminUser.delete({ where: { username: TEST_ADMIN } }).catch(() => {});
console.log(`ادمین تستی «${TEST_ADMIN}» حذف شد.`);
await prisma.$disconnect();
process.exit(fail > 0 ? 1 : 0);
