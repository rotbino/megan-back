#!/usr/bin/env node
/**
 * تست API اولویت + یادآور «پیگیری بعدی N روز دیگر» (خواسته مالک ۷-۱۱).
 * جریان: لاگین OTP ثابت → ساخت پروندهٔ тест → ذخیرهٔ درخواست خرید با اولویت و
 * یادآور → تغییر اولویت/یادآور → خواندن مجدد → پاک‌سازی کامل دادهٔ تست.
 *
 * اجرا: npm run test:priority   (بک‌اند باید روی :4000 در حال اجرا باشد)
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const PHONE = process.env.TEST_PHONE ?? '09150000001';

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

const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}`);
};

async function main() {
  // ورود با OTP ثابت (فقط محیط dev/test)
  await post('auth/sendOtp', { phone: PHONE });
  const v = await post('auth/verifyOtp', { phone: PHONE, code: '1234' });
  const token = v.json?.data?.accessToken;
  check('ورود با OTP', Boolean(token));
  if (!token) process.exit(1);

  // دادهٔ تست قبلی را تمیز کن (اجرای چندبارهٔ تست)
  const before = (await post('follow/getAllItems', {}, token)).json?.data ?? [];
  for (const it of before) await post('follow/removeItem', { itemId: it.id }, token);

  // اولین درخواست خرید عمومی — هدف ذخیره
  const reqs = await post('buy-requests/getBuyRequestList', { perPage: 5 }, token);
  const req = (reqs.json?.data?.items ?? [])[0];
  check('دریافت فهرست درخواست‌های خرید', Boolean(req));
  if (!req) process.exit(1);

  // پرونده + ذخیره با اولویت بالا و یادآور ۲ روز
  const folder = await post('follow/createFolder', { name: `تست اولویت ${Date.now() % 1000}` }, token);
  const folderId = folder.json?.data?.id;
  check('ساخت پروندهٔ تست', Boolean(folderId));

  const up = await post(
    'follow/upsertItem',
    {
      folderId,
      targetType: 'buy_request',
      targetId: req.id,
      status: 'reviewing',
      priority: 1,
      nextFollowDays: 2,
    },
    token,
  );
  const item = up.json?.data;
  check('ذخیره با اولویت ۱ + یادآور ۲ روز', item?.priority === 1 && Boolean(item?.nextFollowAt));
  // یادآور از نیمه‌شب امروز + ۲ روز → دقیقاً «۲ روز دیگر»
  const due = item?.nextFollowAt ? new Date(item.nextFollowAt.replace(' ', 'T')) : null;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = due ? Math.round((due.getTime() - midnight.getTime()) / 86_400_000) : null;
  check('یادآور دقیقاً N روز دیگر (۲)', days === 2);

  // تغییر اولویت به کم + اعتبارسنجی مقدار نامعتبر
  check('تغییر اولویت به ۳', (await post('follow/setItemPriority', { itemId: item.id, priority: 3 }, token)).status < 300);
  check('رد مقدار نامعتبر (۵)', (await post('follow/setItemPriority', { itemId: item.id, priority: 5 }, token)).status === 400);

  // یادآور: ۵ روز → حذف (۰)
  check('ثبت یادآور ۵ روز', (await post('follow/setNextFollow', { itemId: item.id, days: 5 }, token)).status < 300);
  check('رد روز نامعتبر (۴۰۰ روز)', (await post('follow/setNextFollow', { itemId: item.id, days: 400 }, token)).status === 400);
  check('حذف یادآور (days=0)', (await post('follow/setNextFollow', { itemId: item.id, days: 0 }, token)).status < 300);

  // خواندن مجدد — وضعیت نهایی مورد
  const all = await post('follow/getAllItems', {}, token);
  const after = (all.json?.data ?? []).find((x) => x.id === item.id);
  check('خواندن اولویت (۳) و حذف یادآور', after?.priority === 3 && after?.nextFollowAt === null);

  // پاک‌سازی دادهٔ تست
  await post('follow/removeItem', { itemId: item.id }, token);
  await post('follow/deleteFolder', { folderId }, token);
  const left = (await post('follow/getAllItems', {}, token)).json?.data ?? [];
  check('پاک‌سازی کامل دادهٔ تست', left.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} پاس`);
  if (failed.length) {
    console.error('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('TEST ERROR:', e.message);
  process.exit(1);
});
