#!/usr/bin/env node
/**
 * تست سرتاسری «پیام مستقیم ادمین → کاربر» (مدل AdminMessage)
 * نیاز: سرور :4000 در حال اجرا
 *
 * مراحل:
 *  ۱. ادمین موقت تست (با رمز تصادفی) می‌سازد — بعد از تست غیرفعال می‌شود
 *  ۲. سه کاربر تستی OTP می‌گیرند
 *  ۳. sendToUser (تکی) + sendToUsers (چندتایی) + sendToAll (همه با مخاطب)
 *  ۴. سمت کاربر: getMyAdminMessages (items/unread) + markMyAdminMessagesRead
 *  ۵. WS: رویداد chat:adminMessage برای گیرنده آنلاین
 *  ۶. تاریخچه ادمین: getUserMessages + خوانده‌شدن (read_at)
 *  ۷. پاکسازی: ادمین موقت غیرفعال + پیام‌های تست حذف
 */
import { randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = 'http://localhost:4000/api/v1';
const WS_URL = 'http://localhost:4000';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
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
  return { token, userId: p.json?.data?.user?.id ?? null, phone };
}

// ─── ادمین موقت تست (Prisma بک‌اند + scrypt خودِ پروژه) ─────────────────────
const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

const TEST_ADMIN_USER = 'test_msg_admin';
const TEST_ADMIN_PASS = randomBytes(12).toString('base64url');

// scrypt همان backend — از سورس کامپایل‌شده ایمپورت می‌کنیم
async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}

(async () => {
  console.log('── پیام مستقیم ادمین → کاربر ──');

  // ۰) ادمین موقت
  await prisma.adminUser.upsert({
    where: { username: TEST_ADMIN_USER },
    update: { isActive: true, passwordHash: await makeHash(TEST_ADMIN_PASS) },
    create: {
      username: TEST_ADMIN_USER,
      passwordHash: await makeHash(TEST_ADMIN_PASS),
      name: 'ادمین تست پیام',
      role: 'ADMIN',
      isActive: true,
    },
  });
  const al = await post('admin/auth/login', { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
  const adminToken = al.json?.data?.token;
  check('ورود ادمین موقت', !!adminToken, JSON.stringify(al.json).slice(0, 150));

  // ۱) کاربران تستی
  const u1 = await login('0916' + String(2_000_000 + Math.floor(Math.random() * 8_999_999)));
  const u2 = await login('0917' + String(2_000_000 + Math.floor(Math.random() * 8_999_999)));
  const u3 = await login('0918' + String(2_000_000 + Math.floor(Math.random() * 8_999_999)));
  check('ورود سه کاربر تستی', !!u1.token && !!u2.token && !!u3.token);

  // ۲) WS گیرنده آنلاین — u1
  const wsGot = [];
  const sock = io(WS_URL, { auth: { token: u1.token }, transports: ['websocket'] });
  await new Promise((r) => sock.on('connect', r) ?? setTimeout(r, 3000));
  sock.on('chat:adminMessage', (p) => wsGot.push(p));

  // ۳) ارسال تکی به u1
  const S1 = 'پیام تست تکی برای ' + u1.phone;
  const r1 = await post('admin/messages/sendToUser', { userId: u1.userId, text: S1 }, adminToken);
  check('sendToUser — ارسال تکی', r1.json?.status === true && r1.json?.data?.sent === 1, JSON.stringify(r1.json).slice(0, 200));

  // ۴) ارسال چندتایی به هر سه
  const S2 = 'پیام تست گروهی';
  const r2 = await post('admin/messages/sendToUsers', { userIds: [u1.userId, u2.userId, u3.userId, 'invalid_id'], text: S2 }, adminToken);
  check('sendToUsers — ارسال چندتایی (۳ + ۱ نامعتبر)', r2.json?.status === true && r2.json?.data?.sent === 3 && r2.json?.data?.skipped === 1, JSON.stringify(r2.json).slice(0, 200));

  // ۵) ارسال به همه با مخاطب فروشندگان (همه کاربران تستی isSeller=true پیش‌فرض)
  const S3 = 'پیام تست عمومی فروشندگان';
  const r3 = await post('admin/messages/sendToAll', { audience: 'sellers', text: S3 }, adminToken);
  check('sendToAll (sellers) — ارسال انبوه', r3.json?.status === true && r3.json?.data?.sent >= 3 && r3.json?.data?.audience === 'sellers', `sent=${r3.json?.data?.sent} audience=${r3.json?.data?.audience}`);

  // ۵ب) ارسال به همه بدون مخاطب — فقط شمارش (بدون تأیید WS برای این)
  const r3b = await post('admin/messages/sendToAll', { text: 'پیام تست همه کاربران' }, adminToken);
  check('sendToAll (همه) — ارسال انبوه', r3b.json?.status === true && r3b.json?.data?.sent >= 3, `sent=${r3b.json?.data?.sent}`);

  // ۶) اعتبارسنجی متن کوتاه
  const rBad = await post('admin/messages/sendToUser', { userId: u1.userId, text: 'ab' }, adminToken);
  check('متن کوتاه رد می‌شود (validation)', rBad.status === 400 || rBad.json?.status === false);

  // ۷) توکن کاربر عادی روی مسیر ادمین → 401/403
  const rUser = await post('admin/messages/sendToUser', { userId: u1.userId, text: 'تقلب!' }, u1.token);
  check('توکن کاربر عادی رد می‌شود', rUser.status === 401 || rUser.status === 403);

  // ۸) سمت کاربر — صندوق u1
  await new Promise((r) => setTimeout(r, 700)); // فرصت رسیدن WS
  const m1 = await post('chat/getMyAdminMessages', {}, u1.token);
  const inbox = m1.json?.data;
  check('getMyAdminMessages — items/unread', Array.isArray(inbox?.items) && inbox?.unread >= 4 && inbox?.total >= 4, `unread=${inbox?.unread} total=${inbox?.total}`);
  check('متن پیام تکی رسیده', inbox?.items?.some?.((m) => m.text === S1));
  check('ترتیب صعودی (قدیمی → جدید)', (() => {
    const ts = (inbox?.items ?? []).map((m) => new Date(m.createdAt).getTime());
    return ts.every((t, i) => i === 0 || ts[i - 1] <= t);
  })());
  check('WS: رویداد chat:adminMessage رسید', wsGot.length >= 1, `got=${wsGot.length}`);

  // ۹) خواندن
  const mr = await post('chat/markMyAdminMessagesRead', {}, u1.token);
  check('markMyAdminMessagesRead', mr.json?.data?.read >= 4, `read=${mr.json?.data?.read}`);
  const m2 = await post('chat/getMyAdminMessages', {}, u1.token);
  check('unread صفر شد', m2.json?.data?.unread === 0, `unread=${m2.json?.data?.unread}`);

  // ۱۰) تاریخچه ادمین برای u1 — read_at پر شده
  const h = await post('admin/messages/getUserMessages', { userId: u1.userId, page: 1, perPage: 10 }, adminToken);
  const hist = h.json?.data;
  check('getUserMessages — تاریخچه ادمین', hist?.total >= 4 && Array.isArray(hist?.items) && hist?.items?.length >= 4, `total=${hist?.total}`);
  check('read_at بعد از خواندن پر شده', hist?.items?.every?.((m) => m.read_at !== null));
  check('ردیف snake_case (admin_username/read_at)', hist?.items?.[0]?.admin_username === TEST_ADMIN_USER);
  const h2 = await post('admin/messages/getUserMessages', { userId: u2.userId, page: 1, perPage: 10 }, adminToken);
  check('u2 هنوز خوانده‌نشده', h2.json?.data?.unread === 3, `unread=${h2.json?.data?.unread} (گروهی+فروشندگان+همه)`);

  // ۱۱) لاگ AdminAction — sendToUser باید ثبت شده باشد
  const acts = await post('admin/actions/getAdminActions', { page: 1, perPage: 20 }, adminToken);
  const actList = acts.json?.data?.items ?? [];
  const msgActs = actList.filter((a) => String(a.action || '').includes('messages/sendTo'));
  check('AdminAction لاگ شد (messages/sendTo*)', msgActs.length >= 1, JSON.stringify(actList.slice(0, 2)).slice(0, 200));

  sock.close();

  // ─── پاکسازی ───────────────────────────────────────────────────────────────
  // پیام‌های تست این سه کاربر حذف (کاربران تستی باقی می‌مانند — عین بقیه تست‌ها)
  const del = await prisma.adminMessage.deleteMany({
    where: { userId: { in: [u1.userId, u2.userId, u3.userId] } },
  });
  // پیام‌های sendToAll به بقیه کاربران واقعی هم رفت — فقط متن‌های تست را پاک کن
  const del2 = await prisma.adminMessage.deleteMany({
    where: { adminUsername: TEST_ADMIN_USER },
  });
  console.log(`  🧹 پاکسازی: ${del.count + del2.count} پیام تست حذف شد`);

  // ادمین موقت غیرفعال
  await prisma.adminUser.update({
    where: { username: TEST_ADMIN_USER },
    data: { isActive: false },
  });
  console.log('  🧹 ادمین موقت تست غیرفعال شد');

  await prisma.$disconnect();

  console.log(`\n结果: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
