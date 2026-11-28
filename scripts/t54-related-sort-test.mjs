// تست دور ۳: سورت «مرتبط‌ترین» با کاربر واردشدهٔ دارای شهر — دو مسیر (SQL خالص + اتریبیوتی)
// ۱) کاربری در شهری که آگهی سیب دارد پیدا می‌شود (مهاباد/اشنویه/…)
// ۲) توکن با JWT_SECRET امضا می‌شود؛ getList با sort=related:
//    • بدون توکن (مهمان) → fallback نردبان+تازگی
//    • با توکن → آگهی‌های شهر خود کاربر باید اول بیایند (مسیر اتریبیوتی و SQL)
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';

const envFile = readFileSync('/home/z/my-project/repos/megan-back/.env', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }),
);

const prisma = new PrismaClient();
const API = 'http://127.0.0.1:4000/api/v1/catalog/v2/getList';
process.env.DATABASE_URL = env.DATABASE_URL; // Prisma از process.env می‌خواند

async function call(body, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return j.data;
}

async function main() {
  // کاربر فعالِ دارای شهر — ترجیحاً شهری با آگهی سیب (آذربایجان غربی)
  const appleCityIds = await prisma.location.findMany({
    where: { type: 'city', name: { in: ['مهاباد', 'اشنویه', 'ارومیه', 'بوکان', 'شهر سیب'] } },
    select: { buskolId: true, name: true },
  });
  const cityNames = new Map(appleCityIds.map((c) => [c.buskolId, c.name]));
  let user = null;
  for (const [cityId, name] of cityNames) {
    const u = await prisma.user.findFirst({
      where: { cityId, isActive: true },
      select: { id: true, phone: true, role: true, cityId: true, provinceId: true },
    });
    if (u) { user = u; console.log('کاربر پیدا شد در', name, 'cityId', cityId); break; }
  }
  if (!user) {
    // هر کاربری با شهر — مسیر SQL را حداقل تست کنیم
    user = await prisma.user.findFirst({ where: { cityId: { not: null }, isActive: true }, select: { id: true, phone: true, role: true, cityId: true, provinceId: true } });
    console.log('کاربر با شهر دیگر:', user.cityId);
  }

  const token = jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, env.JWT_SECRET, { expiresIn: '1h' });

  // ── مسیر اتریبیوتی: سیب ──
  const guestApple = await call({ sort: 'related', nodeKey: 'agri.fruit.apple', perPage: 5 });
  const userApple = await call({ sort: 'related', nodeKey: 'agri.fruit.apple', perPage: 5 }, token);
  console.log('\n── سیب (مسیر اتریبیوتی) — total:', userApple.total);
  console.log('مهمان:', guestApple.items.map((i) => `${i.city_name}`).join(' | '));
  console.log('کاربر :', userApple.items.map((i) => `${i.city_name}${i.resolved_attrs?.ctype ? ' ' + i.resolved_attrs.ctype : ''}`).join(' | '));

  // ── مسیر SQL خالص: همهٔ دسته‌ها ──
  const guestAll = await call({ sort: 'related', perPage: 5 });
  const userAll = await call({ sort: 'related', perPage: 5 }, token);
  console.log('\n── همهٔ دسته‌ها (SQL) — total:', userAll.total, '(مهمان:', guestAll.total + ')');
  const userCity = await prisma.location.findUnique({ where: { id: `city:${user.cityId}` }, select: { name: true } });
  console.log('شهر کاربر:', userCity?.name);
  console.log('مهمان:', guestAll.items.map((i) => i.city_name).join(' | '));
  console.log('کاربر :', userAll.items.map((i) => i.city_name).join(' | '));
  const firstAllFromUserCity = userAll.items.every((i) => i.city_name === userCity?.name);
  console.log('هر ۵ آگهی اولِ کاربر از شهر خودش؟', firstAllFromUserCity ? 'PASS ✓' : 'CHECK — بعضی از شهر دیگر');

  // ── سورت‌های دیگر سالم؟ ──
  for (const s of ['newest', 'price-asc', 'moq-asc', 'stock-desc']) {
    const r = await call({ sort: s, nodeKey: 'agri.fruit.apple', perPage: 3 });
    console.log(`sort=${s} →`, r.total, 'اول:', r.items[0]?.product_name);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
