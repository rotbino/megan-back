#!/usr/bin/env node
/**
 * تست E2E بسته‌های اشتراک — login → getMyPackage (رایگان ۱۰) →
 * getBuyRequestContact (PACKAGE_REQUIRED برای رایگان) → سفارش ساخت →
 * (ادمین) reviewPackageOrder → getMyPackage (فعال/نامحدود) → capacity=-1
 */
const BASE = 'http://127.0.0.1:4000/api/v1';

async function api(path, body, token) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function assert(cond, label, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  // ۱) لاگین کاربر تستی
  const phone = process.env.TEST_PHONE || '09120000001';
  const login = await api('auth/login', { phone });
  const token = login.json?.data?.accessToken;
  assert(Boolean(token), `login (${phone})`, login.json?.message ?? '');

  // ۲) بسته من — باید رایگان با ظرفیت ۱۰ باشد
  const mine = await api('packages/getMyPackage', {}, token);
  assert(mine.json?.data?.pakageType === 0, 'getMyPackage: pakageType=0 (رایگان)');
  assert(mine.json?.data?.features?.productCapacity === 10, 'ظرفیت رایگان = ۱۰', String(mine.json?.data?.features?.productCapacity));
  assert(mine.json?.data?.features?.canSeeBuyers === false, 'canSeeBuyers=false برای رایگان');

  // ۳) ظرفیت محصولات من — باید ۱۰ برگردد
  const products = await api('products/getMyProducts', {}, token);
  assert(products.json?.data?.capacity === 10, 'getMyProducts capacity=10', String(products.json?.data?.capacity));

  // ۴) گیت خریداران — تماس باید PACKAGE_REQUIRED بدهد
  const list = await api('buy-requests/getBuyRequestList', { page: 1 });
  const firstId = list.json?.data?.items?.[0]?.id;
  if (firstId) {
    const contact = await api('buy-requests/getBuyRequestContact', { id: firstId }, token);
    assert(contact.status === 403 && contact.json?.code === 'PACKAGE_REQUIRED', 'گیت خریداران: PACKAGE_REQUIRED (403)', contact.json?.message?.slice(0, 60) ?? '');
  } else {
    console.log('⚠️ درخواست خرید تاییدشده‌ای برای تست تماس نیست — رد شد');
  }

  // ۵) خریداران پیشنهادی — برای رایگان باید خالی باشد
  const suggested = await api('buy-requests/getSuggestedBuyers', {}, token);
  assert(Array.isArray(suggested.json?.data) && suggested.json.data.length === 0, 'getSuggestedBuyers خالی برای رایگان');

  console.log('\n— تست ادمین (فعال‌سازی بسته) —');
  // ۶) ادمین: ساخت سفارش مستقیم در DB توسط API هم ممکن نیست؛ سفارش واقعی نیاز به فیش دارد.
  //    بررسی صف ادمین بدون توکن → 401
  const noAuth = await api('admin/packages/getPackageOrders', {});
  assert(noAuth.status === 401 || noAuth.status === 403, 'admin/packages بدون توکن رد می‌شود', String(noAuth.status));

  console.log('\nاول یک سفارش با فیش بساز: bash scripts/test-packages-order.mjs بعد این تست را کامل کن.');
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
