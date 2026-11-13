// تست E2E خواندن کالکشن منبع user-buskool — همان مسیر ImporterService
// (تشخیص ستون + find/sort/skip/limit از طریق $runCommandRaw).
// فقط خواندنی: هیچ نوشتنی روی دیتابیس انجام نمی‌شود.
// اجرا: node scripts/test-source-read.mjs
// پس‌زمینه: باگ ۱۳-۱۱ «ردیفی در کالکشن user-buskool از offset=1 نبود» —
// دامپ واقعی فیلد userName (camelCase) دارد ولی پیش‌فرض قبلی user_name بود.
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TABLE = process.env.IMPORT_SOURCE_TABLE?.trim() || 'user-buskool';
const ENV_USER = process.env.IMPORT_SOURCE_USERNAME_COLUMN?.trim();
const ENV_PHONE = process.env.IMPORT_SOURCE_PHONE_COLUMN?.trim();

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

// ── همان منطق تشخیص ستون سرویس (sourceFields) ──
const peek = await prisma.$runCommandRaw({ find: TABLE, limit: 1, batchSize: 1 });
const doc = peek?.cursor?.firstBatch?.[0];
const keys = doc ? Object.keys(doc) : [];
let userNameCol =
  ['userName', 'user_name', 'username'].find((k) => keys.includes(k)) ??
  keys.find((k) => /^user[-_]?name$/i.test(k)) ??
  'userName';
let phoneCol =
  ['phone', 'mobile', 'phone_number'].find((k) => keys.includes(k)) ??
  keys.find((k) => /^(phone|mobile|cell)[-_]?(number)?$/i.test(k)) ??
  'phone';
if (ENV_USER) userNameCol = ENV_USER;
if (ENV_PHONE) phoneCol = ENV_PHONE;
console.log(`کلیدهای سند نمونه (${keys.length}):`, keys.join(', '));
console.log(`ستون تشخیص‌داده‌شده: یوزرنیم=${userNameCol} | تلفن=${phoneCol}`);

// ── همان sourceRead سرویس ──
async function sourceRead(offset, limit) {
  const res = await prisma.$runCommandRaw({
    find: TABLE,
    sort: { _id: 1 }, // ایندکس‌دار — سورت بی‌ایندکس در آتلاس 32MB حافظه می‌ترکاند
    skip: offset,
    limit,
    batchSize: limit,
    allowDiskUse: true,
    projection: { [userNameCol]: 1, [phoneCol]: 1 },
  });
  const batch = res?.cursor?.firstBatch ?? [];
  const rows = batch
    .map((d, i) => {
      const userName = String(d[userNameCol] ?? '').trim();
      const rawPhone = d[phoneCol] == null ? '' : String(d[phoneCol]).replace(/[^0-9]/g, '');
      return { userName, phone: /^09\d{9}$/.test(rawPhone) ? rawPhone : null, rawIdx: offset + i };
    })
    .filter((r) => r.userName.length > 0);
  return { rows, rawCount: batch.length };
}

const cnt = await prisma.$runCommandRaw({ count: TABLE });
const total = Number(cnt?.n ?? 0);
console.log(`\nتعداد کل سندها: ${total}`);
check('کالکشن خوانده می‌شود (total > 0)', total > 0);

// ── موردِ باگ: offset=1, limit=2 — باید ۲ ردیف برگردد ──
const r1 = await sourceRead(1, 2);
console.log(`\noffset=1 limit=2 → rawCount=${r1.rawCount}:`, JSON.stringify(r1.rows));
check('باگ اصلی رفع شد: offset=1 دو ردیف برمی‌گرداند', r1.rows.length === 2 && r1.rawCount === 2);
check('ردیف‌ها یوزرنیم معتبر دارند', r1.rows.every((r) => r.userName.length > 1));
check('rawIdx درست است (۱ و ۲)', r1.rows[0]?.rawIdx === 1 && r1.rows[1]?.rawIdx === 2);

// ── ابتدای لیست ──
const r0 = await sourceRead(0, 5);
console.log(`\noffset=0 limit=5 →`, r0.rows.map((r) => `${r.rawIdx}:${r.userName}`).join(' | '));
check('ابتدای لیست ۵ ردیف', r0.rows.length === 5 && r0.rows[0]?.rawIdx === 0);

// ── انتهای لیست ──
const rLast = await sourceRead(total - 2, 5);
const rEnd = await sourceRead(total, 5);
console.log(`\noffset=${total - 2} → ${rLast.rows.map((r) => r.userName).join(' | ')}`);
console.log(`offset=${total} (بعد از پایان) → rawCount=${rEnd.rawCount} rows=${rEnd.rows.length}`);
check('دو ردیف آخر لیست', rLast.rows.length === 2);
check('بعد از پایان لیست خالی است', rEnd.rows.length === 0 && rEnd.rawCount === 0);

// ── استرس: skip بزرگ + بستهٔ ۵۰۰۰تایی (بدترین حالت nextUnimported) ──
// با سورتِ ستون بی‌ایندکس اینجا «Sort exceeded memory limit 32MB» می‌آمد
const t0 = Date.now();
const rMid = await sourceRead(50000, 200);
const rScan = await sourceRead(30000, 5000);
const dt = Date.now() - t0;
console.log(`\noffset=50000 limit=200 → ${rMid.rows.length} ردیف | offset=30000 limit=5000 → ${rScan.rows.length} ردیف | ${dt}ms`);
check('skip بزرگ بدون خطای حافظهٔ سورت (offset=50000)', rMid.rows.length === 200);
check('بستهٔ ۵۰۰۰تایی اسکن nextUnimported (offset=30000)', rScan.rows.length === 5000);
check('سریع است (ایندکس _id — زیر ۱۵ ثانیه)', dt < 15000, `${dt}ms`);

// ── شبیه‌سازی nextUnimported روی ۲۰۰ سند اول (بدون ایمپورت واقعی) ──
const imported = new Set(r0.rows[0] ? [r0.rows[0].userName] : []);
let first = null;
let remaining = 0;
let scanned = 0;
while (scanned < 200) {
  const { rows, rawCount } = await sourceRead(scanned, 100);
  if (!rawCount) break;
  for (const r of rows) {
    if (imported.has(r.userName)) continue;
    remaining++;
    if (!first) first = r;
  }
  scanned += rawCount;
}
console.log(`\nnextUnimported (۲۰۰ سند اول، ردیف ۰ ایمپورت‌شده): first=${first?.userName}@${first?.rawIdx} remaining=${remaining}`);
check('اولین ایمپورت‌نشده دقیقاً rawIdx=1 است', first?.rawIdx === 1);
check('اولین ایمپورت‌نشده همان ردیف دوم است', first?.userName === r0.rows[1]?.userName);
check('remaining = ۱۹۹ (۲۰۰ منهای ۱ ایمپورت‌شده)', remaining === 199);

console.log(`\n${fail === 0 ? '✓ همهٔ تست‌ها پاس' : `✖ ${fail} تست شکست خورد`} (${pass} پاس)`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
