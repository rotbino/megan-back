#!/usr/bin/env node
/**
 * تست e2e شفای مکالمات تکراری (خواسته مالک ۴-۱۱ — دور دوم):
 * «چت یک نفر در لیست فقط یک‌بار بیاید» حتی با دادهٔ قدیمیِ تکراری.
 *
 * سناریو ۱ (مورد واقعی مالک): مکالمهٔ دارای پیام + ترد تکراریِ خالیِ
 *   جدیدتر (ساخت کد قدیمی با جهت معکوس) → نگه‌دارنده باید مکالمهٔ
 *   دارای پیام باشد و ترد خالی حذف شود.
 * سناریو ۲: هر دو ترد پیام دارند، تکراریِ فعال‌تر است → فعال‌تر
 *   نگه‌دارنده می‌شود؛ sendMessage با شناسهٔ تردِ محو‌شونده (کلاینت
 *   کهنه) → پیام باید در نگه‌دارنده بنشیند (redirect)؛ SupplyOffer هم
 *   به نگه‌دارنده اشاره کند.
 * پاکسازی کامل کاربران تستی در پایان.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

const BASE = 'http://127.0.0.1:4000/api/v1';
const p = new PrismaClient();
const j = (r) => r.json();
const post = (path, body, token) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  }).then(j);

let pass = 0;
const fail = [];
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
};

async function makeUser(phone) {
  await post('/auth/sendOtp', { phone });
  const r = await post('/auth/verifyOtp', { phone, code: '1234' });
  if (!r.status) throw new Error(`register ${phone} failed: ${JSON.stringify(r)}`);
  return r.data.accessToken;
}

async function pairThreads(aId, bId) {
  return p.chatThread.findMany({
    where: { OR: [{ sellerId: aId, buyerId: bId }, { sellerId: bId, buyerId: aId }] },
    select: { id: true },
  });
}

async function main() {
  const phoneA = '09901234591';
  const phoneB = '09901234592';
  const tokenA = await makeUser(phoneA);
  const tokenB = await makeUser(phoneB);
  const A = (await p.user.findUnique({ where: { phone: phoneA } })).id;
  const B = (await p.user.findUnique({ where: { phone: phoneB } })).id;
  console.log(`test users: A=${A} B=${B}`);

  try {
    // ═══ سناریو ۱ — مورد واقعی: ترد خالیِ جدیدتر + مکالمهٔ دارای پیام ═══
    console.log('\nسناریو ۱: ترد تکراریِ خالیِ جدیدتر (کد قدیمی، جهت معکوس)');
    const canon1 = await p.chatThread.create({
      data: { productId: null, sellerId: A, buyerId: B, lastMessageAt: new Date(Date.now() - 3_600_000) },
    });
    await p.chatMessage.create({
      data: { threadId: canon1.id, senderId: B, text: 'پیام قدیمی ۱ (از B)', readAt: null },
    });
    const emptyDup = await p.chatThread.create({
      // lastMessageAt نمی‌گذاریم — عین ترد خالی واقعی دیتابیس
      data: { productId: null, sellerId: B, buyerId: A },
    });
    check('قبل از شفا ۲ ترد هست', (await pairThreads(A, B)).length === 2);

    const convA1 = await post('/chat/getConversations', {}, tokenA);
    check('A فقط یک مکالمه دارد', convA1.status && convA1.data.length === 1, `got ${convA1.data?.length}`);
    check('نگه‌دارنده = مکالمهٔ دارای پیام (نه ترد خالی)', convA1.data?.[0]?.id === canon1.id, `got ${convA1.data?.[0]?.id}`);
    check('ترد خالی حذف شد', (await pairThreads(A, B)).length === 1);
    check('پیام روی مکالمهٔ اصلی ماند', (await p.chatMessage.count({ where: { threadId: canon1.id } })) === 1);
    check('آخرین پیام درست است', convA1.data?.[0]?.lastMessage?.text === 'پیام قدیمی ۱ (از B)');

    // ═══ سناریو ۲ — هر دو ترد پیام دارند؛ محو‌شونده فعال‌تر نیست ═══
    console.log('\nسناریو ۲: sendMessage با شناسهٔ کهنه + ادغام دو ترد دارای پیام');
    // canon1 (فعال‌تر: پیام دارد) + ترد دوم با پیام قدیمی‌تر → نگه‌دارنده canon1
    const olderDup = await p.chatThread.create({
      data: { productId: null, sellerId: B, buyerId: A, lastMessageAt: new Date(Date.now() - 7_200_000) },
    });
    await p.chatMessage.create({
      data: { threadId: olderDup.id, senderId: A, text: 'پیام قدیمی ۲ (از A)', readAt: null },
    });
    const offer = await p.supplyOffer.create({
      data: { sellerId: A, buyerId: B, message: 'پیشنهاد تست شفا', threadId: olderDup.id },
    });

    // کلاینت کهنه روی شناسهٔ تردِ محوشونده پیام می‌فرستد → باید روی
    // نگه‌دارنده (canon1) بنشیند و جفت همان‌جا ادغام شود
    const sm = await post('/chat/sendMessage', { threadId: olderDup.id, text: 'پیام جدید روی شناسهٔ کهنه' }, tokenA);
    check('sendMessage پاسخ موفق', sm.status === true, JSON.stringify(sm));
    check('پیام در نگه‌دارنده نشست (redirect)', sm.status && sm.data?.threadId === canon1.id, `got ${sm.data?.threadId}`);
    check('جفت همان‌جا ادغام شد (۱ ترد)', (await pairThreads(A, B)).length === 1);
    const msgsOnKeeper = await p.chatMessage.count({ where: { threadId: canon1.id } });
    check('هر ۳ پیام در نگه‌دارنده اند', msgsOnKeeper === 3, `got ${msgsOnKeeper}`);
    const offerAfter = await p.supplyOffer.findUnique({ where: { id: offer.id } });
    check('پیشنهاد تامین به نگه‌دارنده اشاره می‌کند', offerAfter?.threadId === canon1.id, `got ${offerAfter?.threadId}`);

    // لیست و بج هر دو طرف
    const convA2 = await post('/chat/getConversations', {}, tokenA);
    const convB2 = await post('/chat/getConversations', {}, tokenB);
    check('A همچنان یک مکالمه', convA2.data?.length === 1);
    check('B فقط یک مکالمه دارد', convB2.data?.length === 1, `got ${convB2.data?.length}`);
    check('unread A درست (۱ پیام از B)', convA2.data?.[0]?.unreadCount === 1, `got ${convA2.data?.[0]?.unreadCount}`);
    check('unread B درست (۲ پیام از A)', convB2.data?.[0]?.unreadCount === 2, `got ${convB2.data?.[0]?.unreadCount}`);
    const unreadA = await post('/chat/unreadCount', {}, tokenA);
    check('بج A = ۱', unreadA.data?.chat === 1, JSON.stringify(unreadA.data));
    const unreadB = await post('/chat/unreadCount', {}, tokenB);
    check('بج B = ۲', unreadB.data?.chat === 2, JSON.stringify(unreadB.data));

    // شناسهٔ حذف‌شده → 404 تمیز (نه خطای خام)
    const staleOpen = await post('/chat/getThreadMessages', { threadId: olderDup.id }, tokenA);
    check('شناسهٔ حذف‌شده 404 تمیز می‌دهد', staleOpen.status === false);

    console.log(`\n${pass} passed, ${fail.length} failed`);
    if (fail.length) process.exitCode = 1;
  } finally {
    // ── پاکسازی ──
    await p.chatMessage.deleteMany({ where: { OR: [{ senderId: A }, { senderId: B }] } });
    await p.chatThread.deleteMany({ where: { OR: [{ sellerId: A }, { sellerId: B }, { buyerId: A }, { buyerId: B }] } });
    await p.supplyOffer.deleteMany({ where: { OR: [{ sellerId: A }, { buyerId: B }] } });
    await p.otpCode.deleteMany({ where: { OR: [{ phone: phoneA }, { phone: phoneB }] } }).catch(() => undefined);
    await p.user.deleteMany({ where: { id: { in: [A, B] } } });
    console.log('cleanup done');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
