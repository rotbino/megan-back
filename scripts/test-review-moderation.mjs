/**
 * تست دور دهم — قانون انتشار نظرات (خواسته مالک ۲-۱۱):
 *   ۱) گیت تماس/چت: بدون حداقل یک تماس یا چت با فروشنده، ثبت نظر رد می‌شود
 *      با پیام دقیق «فقط کاربرانی که با فروشنده حداقل تماس یا چت داشته‌اند…».
 *   ۲) نظر ثبت‌شده pending است: بلافاصله فقط برای خود نویسنده (myReview)
 *      نمایش داده می‌شود؛ مهمان/دیگران/خلاصهٔ امتیاز آن را نمی‌بینند.
 *   ۳) تأیید ادمین → عمومی می‌شود (items + summary + getSeller).
 *   ۴) ویرایش نظر → بازگشت به pending (حذف از عمومی).
 *   ۵) رد ادمین → از عمومی حذف، اما نویسنده همچنان می‌بیند (برای اصلاح).
 *   ۶) گیت با تماس (CallLog از getSellerPhone) هم باز می‌شود.
 *
 * اجرا: node scripts/test-review-moderation.mjs   (بک‌اند باید روشن باشد)
 * خودپاک‌شونده: کاربران/نظرات/گفتگوها/تماس‌ها/ادمین تست پاک می‌شوند.
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

const TEST_ADMIN_USER = 'test_review_mod_admin';
const TEST_ADMIN_PASS = randomBytes(12).toString('base64url');

async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64url')}`;
}

// ─── کاربران تست: فروشنده A، خریدار بی‌ارتباط C، خریدار تماسی D ────────────
const rnd = Math.floor(Math.random() * 7_800_000);
const A = await login('0912' + String(2_100_000 + rnd));
const C = await login('0913' + String(2_100_000 + rnd));
const D = await login('0914' + String(2_100_000 + rnd));
check('ورود سه کاربر تست', Boolean(A.token && C.token && D.token));

// ─── ۱) گیت تماس/چت ─────────────────────────────────────────────────────────
console.log('\n■ ۱) گیت تماس/چت — بدون ارتباط، نظر رد می‌شود');
const rvGate = await post('reviews/addSellerReview', { userName: A.userName, rating: 5, text: 'تست بدون تماس و چت!' }, C.token);
check('رد با کد REVIEW_NEEDS_CONTACT', rvGate.json?.code === 'REVIEW_NEEDS_CONTACT', JSON.stringify(rvGate.json));
check(
  'پیام دقیق مالک',
  rvGate.json?.message === 'فقط کاربرانی که با فروشنده حداقل تماس یا چت داشته‌اند می‌توانند نظر ثبت کنند.',
  rvGate.json?.message,
);
const rvGateD = await post('reviews/addSellerReview', { userName: A.userName, rating: 5, text: 'تست بدون تماس و چت!' }, D.token);
check('کاربر D هم (بدون ارتباط) رد می‌شود', rvGateD.json?.code === 'REVIEW_NEEDS_CONTACT');

// ─── ۲) چت → ثبت نظر pending ───────────────────────────────────────────────
console.log('\n■ ۲) چت باز می‌کند؛ نظر pending فقط برای نویسنده');
const th = await post('chat/startThread', { userName: A.userName }, C.token);
check('شروع چت C با A', th.json?.status === true);
await post('chat/sendMessage', { threadId: th.json?.data?.id, text: 'سلام، قیمت برنج هاشمی چنده؟' }, C.token);

const rv1 = await post('reviews/addSellerReview', { userName: A.userName, rating: 5, text: 'بعد از چت: فروشنده خوش‌قول و دقیق بود.' }, C.token);
check('ثبت نظر بعد از چت موفق', rv1.json?.status === true);
check('وضعیت اولیه pending است', rv1.json?.data?.status === 'pending', JSON.stringify(rv1.json?.data));
check('پیام موفقیت «پس از تحقیق و تأیید»', (rv1.json?.message ?? '').includes('تأیید'));

const pubC = await post('reviews/getSellerReviews', { userName: A.userName }, C.token);
check('نویسنده myReview را با status=pending می‌بیند', pubC.json?.data?.myReview?.status === 'pending');
check('pending در items عمومی نیست (حتی برای خود نویسنده)', (pubC.json?.data?.items ?? []).every((i) => i.id !== rv1.json?.data?.id));
check('خلاصهٔ امتیاز pending را حساب نمی‌کند', pubC.json?.data?.summary?.count === 0, JSON.stringify(pubC.json?.data?.summary));

const pubGuest = await post('reviews/getSellerReviews', { userName: A.userName });
check('مهمان pending را نمی‌بیند و myReview ندارد', (pubGuest.json?.data?.items ?? []).length === 0 && pubGuest.json?.data?.myReview === null);

const pubD = await post('reviews/getSellerReviews', { userName: A.userName }, D.token);
check('کاربر دیگر هم pending را نمی‌بیند', (pubD.json?.data?.items ?? []).every((i) => i.id !== rv1.json?.data?.id) && pubD.json?.data?.myReview === null);

// getSeller — امتیاز سرصفحه فقط از تأییدشده‌ها
const seller0 = await post('products/getSeller', { userName: A.userName });
check('getSeller: pending در reviewSummary نیست', (seller0.json?.data?.user?.reviewSummary?.count ?? 0) === 0, JSON.stringify(seller0.json?.data?.user?.reviewSummary));

// ─── ۳) ادمین: فهرست با فیلتر وضعیت + تأیید ────────────────────────────────
console.log('\n■ ۳) ادمین — صف در انتظار + تأیید');
await prisma.adminUser.upsert({
  where: { username: TEST_ADMIN_USER },
  update: { isActive: true, passwordHash: await makeHash(TEST_ADMIN_PASS) },
  create: { username: TEST_ADMIN_USER, passwordHash: await makeHash(TEST_ADMIN_PASS), role: 'ADMIN', isActive: true },
});
const al = await post('admin/auth/login', { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
const adminToken = al.json?.data?.token ?? al.json?.data?.accessToken;
check('ورود ادمین تست', Boolean(adminToken));

const lstPending = await post('admin/reviews/getReviewList', { status: 'pending', page: 1, perPage: 50 }, adminToken);
const inPending = (lstPending.json?.data?.items ?? []).some((i) => i.id === rv1.json?.data?.id);
check('نظر در صف «در انتظار» ادمین است', inPending);
check('آمار pending ≥ 1', (lstPending.json?.data?.stats?.pending ?? 0) >= 1, JSON.stringify(lstPending.json?.data?.stats));
const lstApproved0 = await post('admin/reviews/getReviewList', { status: 'approved', page: 1, perPage: 50 }, adminToken);
check('فیلتر approved آن را ندارد (هنوز)', (lstApproved0.json?.data?.items ?? []).every((i) => i.id !== rv1.json?.data?.id));

const appr = await post('admin/reviews/setReviewStatus', { id: rv1.json?.data?.id, status: 'approved' }, adminToken);
check('تأیید ادمین موفق', appr.json?.status === true && appr.json?.data?.status === 'approved', JSON.stringify(appr.json));

const pub1 = await post('reviews/getSellerReviews', { userName: A.userName });
check('بعد از تأیید: عمومی شد', (pub1.json?.data?.items ?? []).some((i) => i.id === rv1.json?.data?.id));
check('خلاصه: count=1 avg=5', pub1.json?.data?.summary?.count === 1 && pub1.json?.data?.summary?.avg === 5, JSON.stringify(pub1.json?.data?.summary));
const seller1 = await post('products/getSeller', { userName: A.userName });
check('getSeller: reviewSummary حالا ۵/۱', seller1.json?.data?.user?.reviewSummary?.count === 1 && seller1.json?.data?.user?.reviewSummary?.avg === 5, JSON.stringify(seller1.json?.data?.user?.reviewSummary));

// ─── ۴) ویرایش → بازگشت به pending ─────────────────────────────────────────
console.log('\n■ ۴) ویرایش نظر تأییدشده → دوباره صف بررسی');
const rv2 = await post('reviews/addSellerReview', { userName: A.userName, rating: 4, text: 'ویرایش: کالا خوب بود اما ارسال دیر شد.' }, C.token);
check('ویرایش موفق', rv2.json?.status === true && rv2.json?.data?.rating === 4);
check('وضعیت به pending برگشت', rv2.json?.data?.status === 'pending');
const pub2 = await post('reviews/getSellerReviews', { userName: A.userName });
check('از عمومی حذف شد تا دوباره تأیید شود', (pub2.json?.data?.items ?? []).every((i) => i.id !== rv1.json?.data?.id));
check('خلاصه هم صفر شد', pub2.json?.data?.summary?.count === 0);

// دوباره تأیید برای ادامهٔ تست
await post('admin/reviews/setReviewStatus', { id: rv1.json?.data?.id, status: 'approved' }, adminToken);

// ─── ۵) رد ادمین ────────────────────────────────────────────────────────────
console.log('\n■ ۵) رد ادمین — عمومی نه، نویسنده بله');
const rej = await post('admin/reviews/setReviewStatus', { id: rv1.json?.data?.id, status: 'rejected' }, adminToken);
check('رد موفق', rej.json?.status === true && rej.json?.data?.status === 'rejected');
const pub3 = await post('reviews/getSellerReviews', { userName: A.userName }, C.token);
check('ردشده در items عمومی نیست', (pub3.json?.data?.items ?? []).every((i) => i.id !== rv1.json?.data?.id));
check('اما نویسنده myReview با status=rejected می‌بیند', pub3.json?.data?.myReview?.status === 'rejected');

// ─── ۶) گیت با تماس (CallLog) ───────────────────────────────────────────────
console.log('\n■ ۶) تماس (دیدن شماره) هم گیت را باز می‌کند');
const ph = await post('products/getSellerPhone', { userName: A.userName }, D.token);
check('گزارش تماس D با A ثبت شد', ph.json?.status === true && ph.json?.data?.callLogged === true);
const rvD = await post('reviews/addSellerReview', { userName: A.userName, rating: 4, text: 'تلفنی توافق کردیم؛ خوش‌قول بودند.' }, D.token);
check('ثبت نظر بعد از تماس موفق', rvD.json?.status === true && rvD.json?.data?.status === 'pending');

// ─── پاکسازی ────────────────────────────────────────────────────────────────
console.log('\n■ پاکسازی');
const thIds = (await prisma.chatThread.findMany({ where: { OR: [{ sellerId: A.userId }, { buyerId: C.userId }, { buyerId: D.userId }] }, select: { id: true } })).map((t) => t.id);
if (thIds.length) await prisma.chatMessage.deleteMany({ where: { threadId: { in: thIds } } });
await prisma.chatThread.deleteMany({ where: { id: { in: thIds } } });
await prisma.sellerReview.deleteMany({ where: { OR: [{ sellerId: A.userId }, { authorId: C.userId }, { authorId: D.userId }] } });
await prisma.callLog.deleteMany({ where: { OR: [{ callerId: C.userId }, { callerId: D.userId }] } });
await prisma.user.updateMany({ where: { id: { in: [A.userId, C.userId, D.userId] } }, data: { lastSeenAt: null } });
await prisma.adminUser.update({ where: { username: TEST_ADMIN_USER }, data: { isActive: false } });
await prisma.$disconnect();
console.log('  🧹 دیتای تست پاک شد');

console.log(`\n═══ نتیجه: ${pass} پاس / ${fail} خطا ═══`);
process.exit(fail > 0 ? 1 : 0);
