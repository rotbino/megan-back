#!/usr/bin/env node
/**
 * تست دودی تغییرات سهمیه (خواسته مالک ۶-۱۱) — اجرا: node scripts/test-quota.mjs
 * سرور باید روی :4000 در حال اجرا باشد.
 *  ۱) ورود با حساب تازه (OTP ثابت) → توکن
 *  ۲) getMyOfferQuota → شکل جدید مینیمال: فقط isFeatured/pakageType/walletBalance
 *  ۳) sendSupplyOffer بدون بسته → PACKAGE_REQUIRED (گیت بسته می‌ماند، سهمیه حذف شده)
 *  ۴) groupSendSupplyOffer بدون بسته → PACKAGE_REQUIRED
 */
const BASE = 'http://localhost:4000/api/v1';
const PHONE = `09123${Math.floor(100000 + Math.random() * 899999)}`;

let passed = 0;
let failed = 0;
function show(title, ok, extra = '') {
  const mark = ok ? '✔' : '✖';
  if (ok) passed++;
  else failed++;
  console.log(`${mark} ${title}${extra ? ` — ${extra}` : ''}`);
}

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  const health = await fetch(BASE + '/health').then((r) => r.json());
  show('health', health?.status === true);

  // ── ورود با حساب تازه ──
  await post('/auth/sendOtp', { phone: PHONE });
  const verify = await post('/auth/verifyOtp', { phone: PHONE, code: '1234' });
  const token = verify.json?.data?.accessToken;
  show('ورود (OTP ثابت)', [200, 201].includes(verify.status) && Boolean(token), PHONE);

  // ── getMyOfferQuota — شکل جدید مینیمال ──
  const quota = await post('/buyers/getMyOfferQuota', {}, token);
  const q = quota.json?.data ?? {};
  const hasNewShape =
    [200, 201].includes(quota.status) &&
    typeof q.isFeatured === 'boolean' &&
    typeof q.pakageType === 'number' &&
    typeof q.walletBalance === 'number';
  const noOldFields = q.dailyLimit === undefined && q.left === undefined && q.groupSend === undefined && q.usedToday === undefined;
  show(
    'getMyOfferQuota شکل جدید (isFeatured/pakageType/walletBalance)',
    hasNewShape && noOldFields,
    JSON.stringify(q),
  );

  // ── sendSupplyOffer بدون بسته → PACKAGE_REQUIRED (نه OFFER_LIMIT) ──
  const one = await post(
    '/buyers/sendSupplyOffer',
    { buyerId: '000000000000000000000000', message: 'این یک پیام آزمایشی است' },
    token,
  );
  show(
    'sendSupplyOffer بدون بسته → PACKAGE_REQUIRED',
    [200, 201, 403].includes(one.status) && one.json?.code === 'PACKAGE_REQUIRED',
    `${one.status} ${one.json?.code ?? ''}`,
  );

  // ── groupSendSupplyOffer بدون بسته → PACKAGE_REQUIRED ──
  const group = await post(
    '/buyers/groupSendSupplyOffer',
    { buyerIds: ['000000000000000000000000'], message: 'این یک پیام آزمایشی است' },
    token,
  );
  show(
    'groupSendSupplyOffer بدون بسته → PACKAGE_REQUIRED',
    [200, 201, 403].includes(group.status) && group.json?.code === 'PACKAGE_REQUIRED',
    `${group.status} ${group.json?.code ?? ''}`,
  );

  // ── دایرکتوری خریداران همچنان برمی‌گردد (فرانت تب‌ها به آن وابسته‌اند) ──
  const dir = await post('/buyers/directory', { page: 1, perPage: 5 });
  show(
    'directory خریداران فعال',
    [200, 201].includes(dir.status) && Array.isArray(dir.json?.data?.items),
    `${dir.status} — total: ${dir.json?.data?.total}`,
  );

  console.log(`\n→ ${passed} پاس، ${failed} خطا`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('خطای تست:', e);
  process.exit(1);
});
