/**
 * تست د-۹ — حضور واقعی v2 (خروج فوری/بیکن leave/لاگ‌اوت/قطع سوکت) + بج پیام‌های خوانده‌نشده.
 *
 * اجرا: node scripts/test-presence-v2-unread.mjs   (بک‌اند باید روشن باشد)
 * سوکت‌تست از socket.io-client فرانت (repos/megan-web) قرض گرفته می‌شود.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

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
  return { token, refreshToken: v.json?.data?.refreshToken, userId: p.json?.data?.user?.id, userName: p.json?.data?.user?.user_name, phone };
}

const backRequire = createRequire(import.meta.url);
const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();
const jwt = backRequire('../node_modules/jsonwebtoken');

// socket.io-client از فرانت (تنها جایی که نصب است)
const webRequire = createRequire('/home/z/my-project/repos/megan-web/package.json');
const { io } = webRequire('socket.io-client');

// ─── ادمین موقت تست ─────────────────────────────────────────────────────────
const TEST_ADMIN_USER = 'test_presence_v2_admin';
const TEST_ADMIN_PASS = randomBytes(12).toString('base64url');

async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64url')}`;
}

/** وضعیت آنلاینِ یک کاربر از دید عمومی (userName) */
async function onlineOf(userName) {
  const st = await post('presence/status', { userNames: [userName] });
  const it = (st.json?.data?.items ?? []).find((i) => i.userName === userName);
  return it?.online;
}

/** اتصال WS تست — resolve بعد از connect */
function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const sock = io('http://localhost:4000', {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
    });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', (e) => reject(e));
  });
}

// ─── ۱) حضور واقعی — خروج فوری ─────────────────────────────────────────────
console.log('\n■ حضور v2 — خروج فوری (نه پنجره ۹۰ثانیه‌ای)');
const A = await login('0912' + String(3_100_000 + Math.floor(Math.random() * 6_800_000)));
const B = await login('0913' + String(3_100_000 + Math.floor(Math.random() * 6_800_000)));
check('ورود دو کاربر تست', Boolean(A.token && B.token && A.userId && B.userId));

await post('presence/heartbeat', {}, A.token);
check('heartbeat → A آنلاین', (await onlineOf(A.userName)) === true);

// بیکن leave با توکن معتبر → فوری آفلاین (بدون انتظار)
const lv = await post('presence/leave', {}, A.token);
check('leave پاسخ موفق', lv.json?.status === true && lv.json?.data?.offline === true);
check('بعد از leave → A همان لحظه آفلاین', (await onlineOf(A.userName)) === false);

// برگشت با نبض → آنلاین دوباره (خروج پاک می‌شود)
await post('presence/heartbeat', {}, A.token);
check('نبض بعد از خروج → A دوباره آنلاین', (await onlineOf(A.userName)) === true);

// توکن منقضی — امضا معتبر؛ بیکن leave باید بپذیرد (پایان نشست سمت سرور)
const expiredToken = jwt.sign(
  { sub: A.userId, phone: A.phone, role: 'USER' },
  process.env.JWT_SECRET,
  { expiresIn: '-1h' },
);
const lvExp = await post('presence/leave', {}, expiredToken);
check('leave با توکن منقضی پذیرفته شد', lvExp.json?.status === true && lvExp.json?.data?.offline === true);
check('توکن منقضی → A آفلاین همان لحظه', (await onlineOf(A.userName)) === false);

// heartbeat با توکن منقضی رد می‌شود (۴۰۱) — امنیت دست‌نخورده
const hbBad = await post('presence/heartbeat', {}, expiredToken);
check('heartbeat با توکن منقضی ۴۰۱ می‌دهد', hbBad.status === 401, `status=${hbBad.status}`);

// برگشت و لاگ‌اوت → خروج فوری سمت سرور (قطع سوکت + مهر offline)
await post('presence/heartbeat', {}, A.token);
check('A برگشت (آنلاین)', (await onlineOf(A.userName)) === true);
const lo = await post('auth/logout', { refreshToken: A.refreshToken }, A.token);
check('logout پاسخ موفق', lo.json?.status === true);
check('بعد از logout → A همان لحظه آفلاین', (await onlineOf(A.userName)) === false);

// لاگ‌اوت نشست A را باطل کرد → ورود دوباره برای ادامه تست‌ها
const A2 = await login(A.phone);
A.token = A2.token;
A.refreshToken = A2.refreshToken;
check('ورود دوباره A بعد از لاگ‌اوت', Boolean(A.token));

// ─── ۲) حضور با سوکت — قطع آخرین سوکت = آفلاین ─────────────────────────────
console.log('\n■ حضور v2 — سوکت WS');
await post('presence/heartbeat', {}, B.token);
const s1 = await wsConnect(B.token).catch((e) => null);
check('سوکت ۱ وصل شد', Boolean(s1));
check('با سوکت → B آنلاین', (await onlineOf(B.userName)) === true);

const s2 = await wsConnect(B.token).catch((e) => null);
check('سوکت ۲ (تب دوم) وصل شد', Boolean(s2));
s1.disconnect();
await new Promise((r) => setTimeout(r, 400));
check('قطع یک تب → B هنوز آنلاین (تب دوم باز)', (await onlineOf(B.userName)) === true);

s2.disconnect();
await new Promise((r) => setTimeout(r, 400));
check('قطع آخرین سوکت → B همان لحظه آفلاین', (await onlineOf(B.userName)) === false);

// ─── ۳) بج خوانده‌نشده (چت + پشتیبانی) ──────────────────────────────────────
console.log('\n■ بج پیام‌های خوانده‌نشده');
const uc0 = await post('chat/unreadCount', {}, A.token);
check('unreadCount بدون پیام = 0', uc0.json?.data?.count === 0, JSON.stringify(uc0.json?.data));

const ucGuest = await post('chat/unreadCount', {});
check('unreadCount مهمان → ۴۰۱', ucGuest.status === 401, `status=${ucGuest.status}`);

// B گفتگوی مستقیم با A → دو پیام خوانده‌نشده
const th = await post('chat/startThread', { userName: A.userName }, B.token);
check('گفتگوی مستقیم شروع شد', th.json?.status === true);
const threadId = th.json?.data?.id;
await post('chat/sendMessage', { threadId, text: 'سلام — پیام اول برای تست بج.' }, B.token);
await post('chat/sendMessage', { threadId, text: 'پیام دوم.' }, B.token);
const uc1 = await post('chat/unreadCount', {}, A.token);
check('دو پیام جدید → count=2 (chat=2)', uc1.json?.data?.count === 2 && uc1.json?.data?.chat === 2, JSON.stringify(uc1.json?.data));

// باز کردن مکالمه = خواندن → بج صفر
await post('chat/getThreadMessages', { threadId }, A.token);
const uc2 = await post('chat/unreadCount', {}, A.token);
check('باز کردن مکالمه → بج صفر شد', uc2.json?.data?.count === 0, JSON.stringify(uc2.json?.data));

// پیام پشتیبانی ادمین → بج support
await prisma.adminUser.upsert({
  where: { username: TEST_ADMIN_USER },
  update: { isActive: true, passwordHash: await makeHash(TEST_ADMIN_PASS) },
  create: { username: TEST_ADMIN_USER, passwordHash: await makeHash(TEST_ADMIN_PASS), role: 'ADMIN', isActive: true },
});
const al = await post('admin/auth/login', { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
const adminToken = al.json?.data?.token ?? al.json?.data?.accessToken;
check('ورود ادمین تست', Boolean(adminToken));

const am = await post('admin/messages/sendToUser', { userId: A.userId, text: 'پیام پشتیبانی برای تست بج.' }, adminToken);
check('ادمین پیام فرستاد', am.json?.status === true);
const uc3 = await post('chat/unreadCount', {}, A.token);
check('پیام پشتیبانی → count=1 (support=1)', uc3.json?.data?.count === 1 && uc3.json?.data?.support === 1, JSON.stringify(uc3.json?.data));

await post('chat/markMyAdminMessagesRead', {}, A.token);
const uc4 = await post('chat/unreadCount', {}, A.token);
check('خواندن پشتیبانی → بج صفر', uc4.json?.data?.count === 0);

// ─── ۴) ادمین — شمار/فیلتر با حضور واقعی ───────────────────────────────────
console.log('\n■ ادمین — شمار/فیلتر آنلاین (v2)');
await post('presence/heartbeat', {}, A.token);
const ul1 = await post('admin/users/getUserList', { page: 1, perPage: 50 }, adminToken);
const c1 = ul1.json?.data?.onlineCount;
check('A آنلاین → در شمار ادمین', (c1 ?? 0) >= 1, `onlineCount=${c1}`);
const rowA = (ul1.json?.data?.items ?? []).find((u) => u.id === A.userId);
check('ردیف A آنلاین است', rowA?.online === true);

await post('presence/leave', {}, A.token);
const ul2 = await post('admin/users/getUserList', { page: 1, perPage: 50 }, adminToken);
const c2 = ul2.json?.data?.onlineCount;
check('خروج A → شمار ادمین فوری کم شد', c2 === (c1 ?? 0) - 1, `قبل=${c1} بعد=${c2}`);

const ulOn = await post('admin/users/getUserList', { online: true, page: 1, perPage: 50 }, adminToken);
const onIds = new Set((ulOn.json?.data?.items ?? []).map((u) => u.id));
check('فیلتر آنلاین: A نیست، B هم نیست (هر دو رفته‌اند)', !onIds.has(A.userId) && !onIds.has(B.userId));

const ulOff = await post('admin/users/getUserList', { online: false, page: 1, perPage: 50 }, adminToken);
const offIds = new Set((ulOff.json?.data?.items ?? []).map((u) => u.id));
check('فیلتر آفلاین: A و B هستند', offIds.has(A.userId) && offIds.has(B.userId));

// getSeller هم خروج را فوری می‌بیند
await post('presence/heartbeat', {}, A.token);
const selOn = await post('products/getSeller', { userName: A.userName });
const selOffAfter = await post('presence/leave', {}, A.token);
const selOff = await post('products/getSeller', { userName: A.userName });
check(
  'getSeller: آنلاین قبل از خروج، آفلاین بعد از خروج',
  selOn.json?.data?.user?.online === true && selOff.json?.data?.user?.online === false,
  `on=${selOn.json?.data?.user?.online} off=${selOff.json?.data?.user?.online}`,
);

// ─── پاکسازی ────────────────────────────────────────────────────────────────
console.log('\n■ پاکسازی');
await prisma.chatMessage.deleteMany({ where: { threadId } });
await prisma.chatThread.deleteMany({ where: { id: threadId } });
await prisma.adminMessage.deleteMany({ where: { userId: A.userId } });
for (const u of [A, B]) {
  if (u.userId) {
    await prisma.refreshToken.deleteMany({ where: { userId: u.userId } });
    await prisma.user.delete({ where: { id: u.userId } }).catch(() => {});
  }
}
await prisma.adminUser.update({ where: { username: TEST_ADMIN_USER }, data: { isActive: false } });
await prisma.$disconnect();
console.log('  🧹 دیتای تست پاک شد');

console.log(`\n═══ نتیجه: ${pass} پاس / ${fail} خطا ═══`);
process.exit(fail > 0 ? 1 : 0);
