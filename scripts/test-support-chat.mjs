#!/usr/bin/env node
/**
 * تست سرتاسری «گفتگوی پشتیبانی» (مدل SupportMessage — خواستهٔ مالک ۸-۱۱ دور ۲۱)
 * نیاز: سرور :4000 در حال اجرا
 *
 * مراحل:
 *  ۱. ادمین موقت تست (با رمز تصادفی) می‌سازد — بعد از تست غیرفعال می‌شود
 *  ۲. دو کاربر تستی OTP می‌گیرند
 *  ۳. کاربران → /support/sendMessage (پیام به پشتیبان)
 *  ۴. ادمین → /admin/support/getThreadList (بج خوانده‌نشده + در انتظار پاسخ)
 *  ۵. ادمین → getThreadMessages (باز کردن = خواندن پیام‌های کاربر)
 *  ۶. ادمین → sendMessage (پاسخ پشتیبان)
 *  ۷. کاربر → getConversation (دیدن پاسخ + علامت خوانده‌شدن)
 *  ۸. داشبورد: getQueues (unreadSupportMessages) + getStats (support.awaitingReply)
 *  ۹. پاکسازی: پیام‌های تست + کاربران تست + ادمین موقت
 */
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:4000/api/v1';

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
  if (!token) {
    console.log(`  ⚠ login(${phone}) failed: sendOtp=${s.status}/${JSON.stringify(s.json)?.slice(0, 120)} verify=${v.status}/${JSON.stringify(v.json)?.slice(0, 120)}`);
  }
  const p = await post('users/getProfile', {}, token);
  return { token, userId: p.json?.data?.user?.id ?? null, phone };
}

// ─── ادمین موقت تست (Prisma بک‌اند + scrypt خودِ پروژه) ─────────────────────
const { PrismaClient } = await import('../node_modules/@prisma/client/default.js');
const { config } = await import('../node_modules/dotenv/dist/index.cjs');
config({ path: '.env', override: true });
const prisma = new PrismaClient();

const TEST_ADMIN_USER = 'test_support_admin';
const TEST_ADMIN_PASS = randomBytes(12).toString('base64url');

async function makeHash(plain) {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt);
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(plain.normalize('NFKC'), salt, 64);
  return `scrypt:${salt}:${key.toString('base64')}`;
}

const cleanup = { userIds: [], adminUsername: TEST_ADMIN_USER };

(async () => {
  console.log('── گفتگوی پشتیبانی (دور ۲۱) ──');

  // ۰) ادمین موقت
  await prisma.adminUser.upsert({
    where: { username: TEST_ADMIN_USER },
    update: { isActive: true, passwordHash: await makeHash(TEST_ADMIN_PASS) },
    create: {
      username: TEST_ADMIN_USER,
      passwordHash: await makeHash(TEST_ADMIN_PASS),
      name: 'ادمین تست پشتیبانی',
      role: 'ADMIN',
      isActive: true,
    },
  });
  const al = await post('admin/auth/login', { username: TEST_ADMIN_USER, password: TEST_ADMIN_PASS });
  const adminToken = al.json?.data?.token;
  check('ورود ادمین موقت', !!adminToken, JSON.stringify(al.json).slice(0, 150));

  // ۱) کاربران تستی
  const u1 = await login('0915' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  const u2 = await login('0919' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  cleanup.userIds.push(u1.userId, u2.userId);
  check('ورود دو کاربر تستی', !!u1.token && !!u2.token && !!u1.userId && !!u2.userId,
    `u1(token=${!!u1.token},id=${u1.userId}) u2(token=${!!u2.token},id=${u2.userId})`);

  // ۲) کاربران پیام می‌دهند
  const Q1 = 'سلام، در ثبت آگهی جدید مشکل دارم ' + u1.phone;
  const Q1b = 'عکس‌ها آپلود نمی‌شود';
  const Q2 = 'سلام، بستهٔ من چند روزه فعال می‌شود؟ ' + u2.phone;
  const s1 = await post('support/sendMessage', { text: Q1 }, u1.token);
  const s1b = await post('support/sendMessage', { text: Q1b }, u1.token);
  const s2 = await post('support/sendMessage', { text: Q2 }, u2.token);
  check('کاربر ۱ — دو پیام', s1.json?.status === true && s1b.json?.status === true);
  check('کاربر ۲ — یک پیام', s2.json?.status === true);

  // ۳) لیست گفتگوهای ادمین
  const tl = await post('admin/support/getThreadList', { filter: 'all' }, adminToken);
  const rows = tl.json?.data?.items ?? [];
  const r1 = rows.find((r) => r.userId === u1.userId);
  const r2 = rows.find((r) => r.userId === u2.userId);
  check('getThreadList — هر دو کاربر', !!r1 && !!r2);
  check('کاربر ۱ — unreadCount=2', r1?.unreadCount === 2, `got=${r1?.unreadCount}`);
  check('کاربر ۱ — awaitingReply=true', r1?.awaitingReply === true);
  check('کاربر ۱ — آخرین پیام متن درست', r1?.lastMessage?.text === Q1b, r1?.lastMessage?.text);
  check('کاربر ۲ — unreadCount=1', r2?.unreadCount === 1, `got=${r2?.unreadCount}`);

  // ۳-ب) فیلترها
  const tlUnread = await post('admin/support/getThreadList', { filter: 'unread' }, adminToken);
  check('فیلتر unread — هر دو', (tlUnread.json?.data?.items ?? []).length === 2);
  const tlAwaiting = await post('admin/support/getThreadList', { filter: 'awaiting' }, adminToken);
  check('فیلتر awaiting — هر دو', (tlAwaiting.json?.data?.items ?? []).length === 2);

  // ۳-پ) جستجو
  const tlSearch = await post('admin/support/getThreadList', { search: u1.phone.slice(0, 7) }, adminToken);
  check('جستجو با موبایل — فقط کاربر ۱', (tlSearch.json?.data?.items ?? []).length === 1 && tlSearch.json?.data?.items?.[0]?.userId === u1.userId);

  // ۴) آمار پشتیبانی
  const st = await post('admin/support/getStats', {}, adminToken);
  check('getStats — threads>=2', (st.json?.data?.threads ?? 0) >= 2);
  check('getStats — unreadMessages>=3', (st.json?.data?.unreadMessages ?? 0) >= 3);
  check('getStats — awaitingReply>=2', (st.json?.data?.awaitingReply ?? 0) >= 2);

  // ۵) باز کردن گفتگوی کاربر ۱ = خواندن پیام‌هایش
  const tm = await post('admin/support/getThreadMessages', { userId: u1.userId }, adminToken);
  check('getThreadMessages — ۲ پیام', (tm.json?.data?.messages ?? []).length === 2);
  check('getThreadMessages — کارت کاربر', tm.json?.data?.user?.id === u1.userId);
  const tl2 = await post('admin/support/getThreadList', { filter: 'all' }, adminToken);
  const r1b = (tl2.json?.data?.items ?? []).find((r) => r.userId === u1.userId);
  check('بعد از باز کردن — unreadCount=0', r1b?.unreadCount === 0, `got=${r1b?.unreadCount}`);
  check('بعد از باز کردن — هنوز awaitingReply=true', r1b?.awaitingReply === true);

  // ۶) پاسخ پشتیبان
  const A1 = 'سلام! مشکل آپلود بررسی شد؛ لطفاً فرمت JPEG امتحان کنید.';
  const sm = await post('admin/support/sendMessage', { userId: u1.userId, text: A1 }, adminToken);
  check('sendMessage — پاسخ پشتیبان', sm.json?.status === true && sm.json?.data?.senderRole === 'admin');
  check('sendMessage — نام ادمین ثبت شد', sm.json?.data?.adminUsername === TEST_ADMIN_USER);
  const tl3 = await post('admin/support/getThreadList', { filter: 'awaiting' }, adminToken);
  const stillAwaiting = (tl3.json?.data?.items ?? []).some((r) => r.userId === u1.userId);
  check('بعد از پاسخ — کاربر ۱ دیگر awaiting نیست', !stillAwaiting);

  // ۷) کاربر ۱ گفتگو را می‌بیند — پاسخ + خوانده‌شده
  const c1 = await post('support/getConversation', {}, u1.token);
  const msgs1 = c1.json?.data?.messages ?? [];
  check('کاربر ۱ — ۳ پیام (۲ پرسش + ۱ پاسخ)', msgs1.length === 3, `got=${msgs1.length}`);
  const last1 = msgs1[msgs1.length - 1];
  check('کاربر ۱ — پاسخ پشتیبان دیده شد', last1?.text === A1 && last1?.senderRole === 'admin');
  check('کاربر ۱ — unreadFromAdmin=1 در همان باز شدن', c1.json?.data?.unreadFromAdmin === 1, `got=${c1.json?.data?.unreadFromAdmin}`);
  const c1b = await post('support/getConversation', {}, u1.token);
  check('باز کردن دوباره — unreadFromAdmin=0', c1b.json?.data?.unreadFromAdmin === 0);

  // ۸) داشبورد — بج منو + صف انتظار
  const q = await post('admin/dashboard/getQueues', {}, adminToken);
  check('getQueues — unreadSupportMessages>=1 (کاربر ۲)', (q.json?.data?.unreadSupportMessages ?? 0) >= 1, `got=${q.json?.data?.unreadSupportMessages}`);
  const ds = await post('admin/dashboard/getStats', {}, adminToken);
  check('getStats داشبورد — support.awaitingReply>=1 (کاربر ۲)', (ds.json?.data?.support?.awaitingReply ?? 0) >= 1, `got=${ds.json?.data?.support?.awaitingReply}`);
  check('getStats داشبورد — support.unreadMessages>=1', (ds.json?.data?.support?.unreadMessages ?? 0) >= 1);

  // ۹) ولیدیشن — متن کوتاه رد می‌شود
  const badText = await post('support/sendMessage', { text: 'کو' }, u1.token);
  check('ولیدیشن — متن زیر ۵ نویسه رد', badText.json?.status === false || badText.status === 400);
  const badUser = await post('admin/support/sendMessage', { userId: '000000000000000000000000', text: 'سلام' }, adminToken);
  check('ولیدیشن — کاربر ناموجود ۴۰۴', badUser.status === 404, `got=${badUser.status}`);

  // ۱۰) بدون توکن رد می‌شود
  const noAuth = await post('support/getConversation', {});
  check('گارد — بدون توکن رد', noAuth.status === 401 || noAuth.json?.status === false, `got=${noAuth.status}`);

  console.log(`\nنتیجه: ${pass} ✅ / ${fail} ❌`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('💥 خطای تست:', e);
  process.exitCode = 1;
}).finally(async () => {
  // پاکسازی — پیام‌های تست + کاربران + ادمین موقت
  try {
    if (cleanup.userIds.length) {
      await prisma.supportMessage.deleteMany({ where: { userId: { in: cleanup.userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    }
    await prisma.adminUser.update({
      where: { username: cleanup.adminUsername },
      data: { isActive: false },
    });
    console.log('🧹 پاکسازی انجام شد.');
  } catch (e) {
    console.error('پاکسازی ناقص:', e.message);
  }
  await prisma.$disconnect();
});
