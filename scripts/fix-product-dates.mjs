// بازگردانی مهرهای زمانی دقیق باسکول روی آگهی‌های ایمپورت‌شده (گزارش مالک ۱۳-۱۱):
// شمارندهٔ بازدید (و reaperها) updated_at را به «اکنون» برده بودند — «۲ دقیقه پیش»
// روی آگهی‌های چندساله. این اسکریپت فهرست آگهی‌های هر کاربر ایمپورت‌شده را از
// خود باسکول می‌گیرد و سه مهر را عیناً بازمی‌نویسد:
//   created_at  ← p_created_at   (ثبت آگهی)
//   updated_at  ← updated_at     (آخرین آپدیت)
//   price_updated_at ← last_price_update (آپدیت قیمت) + price_validity_days=3650
// اجرا:  node scripts/fix-product-dates.mjs           → فقط گزارش (خشک)
//        node scripts/fix-product-dates.mjs --apply   → اعمال
import { config } from 'dotenv';
config({ override: true });

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const API = 'https://www.buskool.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE = 20;
const DELAY = Math.max(250, Number(process.env.BUSKOOL_DELAY_MS ?? 5000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// همان bkDate سرویس: «YYYY-MM-DD HH:mm:ss» بدون منطقه → UTC
const bkDate = (s) => {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
};

async function bkCall(path, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          Origin: API,
          Referer: `${API}/`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500 * attempt);
    }
  }
}

const users = await prisma.user.findMany({
  where: { bUserName: { not: null } },
  select: { userName: true },
});
console.log(`${APPLY ? '⚡ اعمال' : '🔍 خشک (بدون --apply فقط گزارش)'} — کاربران ایمپورت‌شده: ${users.length}\n`);

let fixed = 0;
let already = 0;
let missing = 0;

for (const { userName } of users) {
  await sleep(DELAY);
  // همان صفحه‌بندی ایمپورتر
  const items = [];
  for (let from = 0; ; from += PAGE) {
    const resp = await bkCall('/get_product_list_by_user_name', {
      user_name: userName,
      status: 2,
      is_public: true,
      from_record_number: from,
      to_record_number: from + PAGE,
    });
    const batch = (resp?.products ?? []).filter((p) => p?.main && !p.main.is_rejected && !p.main.deleted_at);
    items.push(...batch);
    if (batch.length < PAGE) break;
  }
  if (!items.length) {
    console.log(`@${userName}: آگهی عمومی ندارد`);
    continue;
  }

  for (const it of items) {
    const m = it.main;
    const want = {
      created: bkDate(m.p_created_at),
      updated: bkDate(m.updated_at),
      price: bkDate(m.last_price_update),
    };
    const cur = await prisma.product.findUnique({
      where: { id: m.id },
      select: { createdAt: true, updatedAt: true, priceUpdatedAt: true },
    });
    if (!cur) {
      missing++;
      console.log(`  #${m.id} «${m.product_name}» در دیتابیس نیست (شاید ایمپورت ناقص مانده)`);
      continue;
    }
    const same =
      (!want.created || cur.createdAt.getTime() === want.created.getTime()) &&
      (!want.updated || cur.updatedAt.getTime() === want.updated.getTime()) &&
      (!want.price || cur.priceUpdatedAt?.getTime() === want.price.getTime());
    if (same) {
      already++;
      continue;
    }
    fixed++;
    console.log(
      `  #${m.id} «${String(m.product_name).slice(0, 24)}» @${userName}: ` +
        `ثبت ${cur.createdAt.toISOString().slice(0, 10)}→${want.created?.toISOString().slice(0, 10) ?? '?'} | ` +
        `آپدیت ${cur.updatedAt.toISOString().slice(0, 10)}→${want.updated?.toISOString().slice(0, 10) ?? '?'} | ` +
        `قیمت ${cur.priceUpdatedAt?.toISOString().slice(0, 10) ?? 'null'}→${want.price?.toISOString().slice(0, 10) ?? 'null'}`,
    );
    if (APPLY && (want.created || want.updated)) {
      // دستور خام — update عادی پریسما @updatedAt را به «اکنون» می‌گذارد
      await prisma.$runCommandRaw({
        update: 'Product',
        updates: [
          {
            q: { _id: m.id },
            u: {
              $set: {
                ...(want.created ? { created_at: { $date: want.created.toISOString() } } : {}),
                ...(want.updated ? { updated_at: { $date: want.updated.toISOString() } } : {}),
                ...(want.price ? { price_updated_at: { $date: want.price.toISOString() } } : {}),
                // پنجرهٔ اعتبار بلند — همان ایمپورتر (بج «قیمت منقضی شده» پنل نیفتد)
                price_validity_days: 3650,
              },
            },
          },
        ],
      });
    }
  }
  console.log(`@${userName}: ${items.length} آگهی بررسی شد`);
}

console.log(
  `\nخلاصه: ${fixed} آگهی نیاز به اصلاح داشت • ${already} از قبل درست • ${missing} پیدا نشد` +
    (APPLY ? ' — اعمال شد ✅' : ' — هنوز اعمال نشده؛ برای نوشتن --apply بدهید'),
);

await prisma.$disconnect();
