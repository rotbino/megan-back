/**
 * تست فاز ۱ — حضور (presence) + نظرات (reviews) + چت مستقیم + getSeller غنی‌شده
 * + شماره تماس با userName + ادمین (آنلاین/شمار/فیلتر).
 *
 * اجرا: node scripts/test-presence-reviews.mjs   (بک‌اند باید روشن باشد)
 */
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:4000/api/v1';
let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

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
  const s = await post('auth/sendOtp', { phone });
  const v = await post('auth/verifyOtp', { phone, code: s.json?.data?.devCode });
  const token = v.json?.data?.accessToken;
  const p = await post('users/getProfile', {}, token);
  return { token, userId: p.json?.data?.user?.id, userName: p.json?.data?.user?.user_name, phone };
}

const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

// ─── ادمین موقت تست ─────────────────────────────────────────────────────────
const TEST_ADMIN_USER = 'test_presence_admin';
const TEST_ADMIN_PASS = randomBytes(12).toString('base64url');

async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}

// ─── ۱) حضور ─────────────────────────────────────────────────────────────────
console.log('\n■ حضور (presence)');
const A = await login('0912' + String(2_100_000 + Math.floor(Math.random() * 7_800_000)));
const B = await login('0913' + String(2_100_000 + Math.floor(Math.random() * 7_800_000)));
if (!A.token || !B.token) {
  console.log('  🔎 دیباگ لاگین — A:', JSON.stringify({ ...A, token: A.token?.slice(0, 20) }), 'B:', JSON.stringify({ ...B, token: B.token?.slice(0, 20) }));
}
check('ورود دو کاربر تست', Boolean(A.token && B.token && A.userId && B.userId));

const hb = await post('presence/heartbeat', {}, A.token);
check('heartbeat کاربر A', hb.json?.status === true && hb.json?.data?.online === true);

const st1 = await post('presence/status', { ids: [A.userId, B.userId] });
const map1 = new Map((st1.json?.data?.items ?? []).map((i) => [i.id, i]));
check('status: A آنلاین', map1.get(A.userId)?.online === true, JSON.stringify([...map1.entries()]));
check('status: B آفلاین (نبض نداده)', map1.get(B.userId)?.online === false);

const st2 = await post('presence/status', { userNames: [A.userName] });
check('status با userName هم کار می‌کند', (st2.json?.data?.items ?? []).some((i) => i.userName === A.userName && i.online === true));

// ─── ۲) نظرات فروشنده ────────────────────────────────────────────────────────
console.log('\n■ نظرات فروشنده (reviews)');
const rv1 = await post('reviews/addSellerReview', { userName: A.userName, rating: 5, text: 'فروشنده بسیار دقیق و خوش‌قول بود.' }, B.token);
check('ثبت نظر B برای A', rv1.json?.status === true && rv1.json?.data?.rating === 5);

const rvSelf = await post('reviews/addSellerReview', { userName: A.userName, rating: 4, text: 'خودتحسینی!' }, A.token);
check('نظر درباره خودش رد می‌شود', rvSelf.json?.status !== true);

const rvShort = await post('reviews/addSellerReview', { userName: A.userName, rating: 4, text: 'ک' }, B.token);
check('متن خیلی کوتاه رد می‌شود', rvShort.json?.status !== true);

const rv2 = await post('reviews/addSellerReview', { userName: A.userName, rating: 3, text: 'قیمت مناسب و ارسال سریع — نظر به‌روزشده.' }, B.token);
check('ویرایش نظر (upsert) — همان نظر', rv2.json?.status === true && rv2.json?.data?.rating === 3);

const page = await post('reviews/getSellerReviews', { userName: A.userName, page: 1, perPage: 10 }, B.token);
check('خلاصه: count=1 avg=3', page.json?.data?.summary?.count === 1 && page.json?.data?.summary?.avg === 3, JSON.stringify(page.json?.data?.summary));
check('myReview برای B برمی‌گردد', page.json?.data?.myReview?.rating === 3);

const pageGuest = await post('reviews/getSellerReviews', { userName: A.userName });
check('مهمان هم نظرات را می‌بیند (بدون myReview)', pageGuest.json?.status === true && pageGuest.json?.data?.myReview === null);

// ─── ۳) چت مستقیم (بدون آگهی) ───────────────────────────────────────────────
console.log('\n■ چت مستقیم از پروفایل');
const t1 = await post('chat/startThread', { userName: A.userName }, B.token);
check('شروع گفتگو با userName', t1.json?.status === true && t1.json?.data?.productName === null);

const msg = await post('chat/sendMessage', { threadId: t1.json?.data?.id, text: 'سلام، از پروفایلتون نوشتم.' }, B.token);
check('ارسال پیام در گفتگوی مستقیم', msg.json?.status === true);

const t2 = await post('chat/startThread', { userName: A.userName }, B.token);
check('دوباره startThread → همان مکالمه (یکتا)', t2.json?.data?.id === t1.json?.data?.id);

const tSelf = await post('chat/startThread', { userName: B.userName }, B.token);
check('گفتگو با خودش رد می‌شود', tSelf.json?.status !== true);

const convB = await post('chat/getConversations', {}, B.token);
const genThread = (convB.json?.data ?? []).find((c) => c.id === t1.json?.data?.id);
check('گفتگوی مستقیم در لیست مکالمات است', Boolean(genThread));
check('counterpart درست است (A)', genThread?.counterpart?.id === A.userId);

// چت روی آگهی — یک محصول confirmed واقعی
const anyProduct = await prisma.product.findFirst({
  where: { status: 'confirmed', userId: { not: B.userId } },
  select: { id: true, userId: true },
});
if (anyProduct) {
  const owner = await prisma.user.findUnique({ where: { id: anyProduct.userId }, select: { userName: true } });
  if (owner && anyProduct.userId !== B.userId) {
    const tp = await post('chat/startThread', { productId: anyProduct.id }, B.token);
    check('چت روی آگهی هنوز کار می‌کند', tp.json?.status === true && tp.json?.data?.productId === anyProduct.id);
  }
} else {
  console.log('  ⚪ محصول تستی نیست — چت آگهی رد شد');
}

// ─── ۴) getSeller غنی‌شده ───────────────────────────────────────────────────
console.log('\n■ getSeller غنی‌شده');
const seller = await post('products/getSeller', { userName: A.userName });
const su = seller.json?.data?.user ?? {};
check('online در getSeller', su.online === true, JSON.stringify(su));
check('reviewSummary در getSeller', su.reviewSummary?.count === 1 && su.reviewSummary?.avg === 3);
check('responseRate در getSeller (null وقتی مکالمه با خریدار نیست)', su.responseRate === null || typeof su.responseRate === 'number');
check('productCount/totalStock آمده', typeof su.productCount === 'number' && typeof su.totalStock === 'number');

// ─── ۵) شماره تماس با userName ──────────────────────────────────────────────
const ph = await post('products/getSellerPhone', { userName: A.userName }, B.token);
check('getSellerPhone با userName', ph.json?.status === true && ph.json?.data?.phone === A.phone && ph.json?.data?.callLogged === true);

const phNoArg = await post('products/getSellerPhone', {}, B.token);
check('بدون id/userName → خطا', phNoArg.json?.status !== true);

// ─── ۶) ادمین — آنلاین/شمار/فیلتر ──────────────────────────────────────────
console.log('\n■ ادمین — وضعیت آنلاین');
await prisma.adminUser.upsert({
  where: { username: TEST_ADMIN_USER },
  update: { isActive: true, passwordHash: await makeHash(TEST_ADMIN_PASS) },
  create: {
    username: TEST_ADMIN_USER,
    passwordHash: await makeHash(TEST_ADMIN_PASS),
    role: 'ADMIN',
    isActive: true,
  },
});
const al = await post('admin/auth/login', { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
const adminToken = al.json?.data?.token ?? al.json?.data?.accessToken;
check('ورود ادمین تست', Boolean(adminToken));

const ul = await post('admin/users/getUserList', { page: 1, perPage: 20 }, adminToken);
const uItems = ul.json?.data?.items ?? [];
check('ردیف‌ها online/last_seen_at دارند', uItems.every((u) => typeof u.online === 'boolean' && ('last_seen_at' in u)));
check('onlineCount در پاسخ', typeof ul.json?.data?.onlineCount === 'number' && ul.json?.data?.onlineCount >= 1, `onlineCount=${ul.json?.data?.onlineCount}`);
check('A در لیست آنلاین است', uItems.find((u) => u.id === A.userId)?.online === true);
check('B در لیست آفلاین است', uItems.find((u) => u.id === B.userId)?.online === false);

const ulOn = await post('admin/users/getUserList', { online: true, page: 1, perPage: 50 }, adminToken);
const onIds = new Set((ulOn.json?.data?.items ?? []).map((u) => u.id));
check('فیلتر online=true فقط آنلاین‌ها', onIds.has(A.userId) && !onIds.has(B.userId));

const ulOff = await post('admin/users/getUserList', { online: false, page: 1, perPage: 50 }, adminToken);
const offIds = new Set((ulOff.json?.data?.items ?? []).map((u) => u.id));
check(
  'فیلتر online=false شامل B و نه A',
  offIds.has(B.userId) && !offIds.has(A.userId),
  `BIn=${offIds.has(B.userId)} AIn=${offIds.has(A.userId)} total=${ulOff.json?.data?.total}`,
);

const ud = await post('admin/users/getUserDetail', { id: A.userId }, adminToken);
check('getUserDetail online دارد', ud.json?.data?.user?.online === true && typeof ud.json?.data?.user?.last_seen_at !== 'undefined');

// ─── پاکسازی ────────────────────────────────────────────────────────────────
console.log('\n■ پاکسازی');
await prisma.chatMessage.deleteMany({ where: { threadId: t1.json?.data?.id } });
await prisma.chatThread.deleteMany({ where: { id: t1.json?.data?.id } });
await prisma.sellerReview.deleteMany({ where: { sellerId: A.userId } });
await prisma.callLog.deleteMany({ where: { callerId: B.userId } });
if (anyProduct) {
  const tpThreads = await prisma.chatThread.findMany({ where: { productId: anyProduct.id, buyerId: B.userId } });
  for (const th of tpThreads) {
    await prisma.chatMessage.deleteMany({ where: { threadId: th.id } });
    await prisma.chatThread.delete({ where: { id: th.id } });
  }
}
if (A.userId) await prisma.user.update({ where: { id: A.userId }, data: { lastSeenAt: null } });
if (B.userId) await prisma.user.update({ where: { id: B.userId }, data: { lastSeenAt: null } });
await prisma.adminUser.update({ where: { username: TEST_ADMIN_USER }, data: { isActive: false } });
await prisma.$disconnect();
console.log('  🧹 دیتای تست پاک شد');

console.log(`\n═══ نتیجه: ${pass} پاس / ${fail} خطا ═══`);
process.exit(fail > 0 ? 1 : 0);
