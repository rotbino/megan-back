#!/usr/bin/env node
/**
 * تست دستی فاز A4 پنل ادمین — مدیریت آگهی‌ها و درخواست‌های خرید:
 *  ۱) ورود ادمین + ساخت کاربر تست با آگهی/درخواست واقعی (OTP devCode)
 *  ۲) getProductList — ساختار/شمارنده تب‌ها/جستجو (نام+موبایل)/فیلتر وضعیت-فروشنده-نردبان
 *  ۳) getProductDetail — رکورد کامل + فروشنده + گالری + ویژگی‌ها + سفارش‌های نردبان
 *  ۴) تست منفی امنیتی — توکن کاربر عادی و بدون توکن روی admin/products|buy-requests/*
 *  ۵) reviewProduct — رد بدون دلیل → REASON_REQUIRED؛ رد با دلایل؛ تأیید؛ ALREADY_REVIEWED
 *  ۶) setProductStatus — confirmed→rejected (پنهان از عمومی)؛ برگشت به confirmed (بازگشت)
 *  ۷) setLadder — روشن (هدیه amount=0 + سفارش در جزئیات) / خاموش / روی pending رد
 *  ۸) deleteProduct — حذف نرم + پنهان از عمومی + files_removed
 *  ۹) درخواست‌های خرید: لیست/شمارنده/جستجو با موبایل + reviewBuyRequest + deleteBuyRequest
 *
 * اجرا: node scripts/test-admin-a4.mjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const ADMIN_USER = process.env.ADMIN_USER || '09196421264';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin434343';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function post(path, body, token) {
  const url = `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
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
  const code = s.json?.data?.devCode;
  if (!code) throw new Error('devCode نیامد');
  const v = await post('auth/verifyOtp', { phone, code });
  const token = v.json?.data?.accessToken;
  // شناسه کاربر از پروفایل (verifyOtp فقط توکن برمی‌گرداند)
  const profile = token ? await post('users/getProfile', {}, token) : null;
  return { token, userId: profile?.json?.data?.user?.id };
}

const rnd = String(Date.now()).slice(-7);
const USER_PHONE = '0912' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));

(async () => {
  console.log('── A4: مدیریت آگهی‌ها و درخواست‌های خرید ──');

  // ── ۱) ورود ادمین + کاربر تست ──────────────────────────────────────────────
  const aLogin = await post('/admin/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  check('ورود ادمین', aLogin.json?.status === true && Boolean(aLogin.json?.data?.token));
  const token = aLogin.json?.data?.token;

  const me = await login(USER_PHONE);
  check('ورود کاربر تست (OTP)', Boolean(me.token));

  // دو آگهی در انتظار + یک درخواست خرید
  const mk = (name) => post('products/createProduct', {
    subCategoryId: 44, // پسته
    productName: name,
    provinceId: 21, cityId: 230,
    stock: 300, minSaleAmount: 20, minSalePrice: 400000,
    description: `تست A4 — ${name} — توضیحات بلندتر از سی نویسه برای اعتبارسنجی.`,
    features: [{ key: 'بسته بندی', value: 'کیلویی' }],
  }, me.token);
  const p1 = await mk(`پسته اکبری تست A4 ${rnd} الف`);
  const p2 = await mk(`پسته احمدآقایی تست A4 ${rnd} ب`);
  const id1 = p1.json?.data?.id;
  const id2 = p2.json?.data?.id;
  check('ثبت دو آگهی pending', Boolean(id1 && id2), `${id1}, ${id2}`);

  const brq = await post('buy-requests/createBuyRequest', {
    subCategoryId: 44,
    name: `پسته تست A4 ${rnd}`,
    requirementAmount: 500,
    goal: 'price_and_buy',
    hasHistory: false,
  }, me.token);
  const reqId = brq.json?.data?.id;
  check('ثبت درخواست خرید pending', Boolean(reqId));

  // ── ۲) getProductList ───────────────────────────────────────────────────────
  const list = await post('/admin/products/getProductList', { search: `تست A4 ${rnd}` }, token);
  check('getProductList — ساختار', Array.isArray(list.json?.data?.items) && list.json?.data?.total >= 2);
  check('getProductList — شمارنده تب‌ها', typeof list.json?.data?.counts?.pending === 'number' && list.json?.data?.counts?.all >= 2,
    JSON.stringify(list.json?.data?.counts));
  const row = (list.json?.data?.items ?? []).find((r) => r.id === id1);
  check('ردیف join‌شده — دسته/مکان/فروشنده', Boolean(
    row?.sub_category_name === 'پسته' && row?.province_name && row?.seller?.phone === USER_PHONE,
  ), JSON.stringify(row ?? {}).slice(0, 220));
  check('بدون هش رمز در پاسخ', !JSON.stringify(list.json).includes('passwordHash'));

  // جستجو با موبایل فروشنده
  const byPhone = await post('/admin/products/getProductList', { search: USER_PHONE }, token);
  check('جستجو با موبایل فروشنده', (byPhone.json?.data?.items ?? []).some((r) => r.id === id1));

  // فیلتر وضعیت + فروشنده همزمان
  const pend = await post('/admin/products/getProductList', { status: 'pending', sellerId: me.userId }, token);
  check('فیلتر وضعیت pending + فروشنده', (pend.json?.data?.items ?? []).length === 2 && pend.json?.data?.total === 2,
    `total=${pend.json?.data?.total}`);

  // فیلتر دسته (زیردرخت 45=خشکبار شامل 44=پسته)
  const cat = await post('/admin/products/getProductList', { categoryId: 45, search: `تست A4 ${rnd}` }, token);
  check('فیلتر دسته با زیردرخت', (cat.json?.data?.items ?? []).length === 2, `n=${cat.json?.data?.items?.length}`);

  // ── ۳) getProductDetail ─────────────────────────────────────────────────────
  const detail = await post('/admin/products/getProductDetail', { id: id1 }, token);
  const d = detail.json?.data;
  check('getProductDetail — ساختار کامل', Boolean(
    d?.description && Array.isArray(d?.photos) && Array.isArray(d?.features) &&
    d?.features?.[0]?.key === 'بسته بندی' && d?.seller?.phone === USER_PHONE && Array.isArray(d?.ladder_orders),
  ), JSON.stringify(d ?? {}).slice(0, 260));

  // ── ۴) تست منفی امنیتی ─────────────────────────────────────────────────────
  const asUser = await post('/admin/products/getProductList', {}, me.token);
  check('توکن کاربر عادی رد شد', asUser.status === 401 || asUser.json?.status === false);
  const noTok = await post('/admin/products/getProductList', {});
  check('بدون توکن 401', noTok.status === 401);
  const asUser2 = await post('/admin/buy-requests/getBuyRequestList', {}, me.token);
  check('توکن کاربر عادی روی buy-requests رد شد', asUser2.status === 401 || asUser2.json?.status === false);

  // ── ۵) reviewProduct ────────────────────────────────────────────────────────
  const noReason = await post('/admin/products/reviewProduct', { id: id1, approve: false }, token);
  check('رد بدون دلیل → REASON_REQUIRED', noReason.json?.code === 'REASON_REQUIRED',
    JSON.stringify(noReason.json).slice(0, 140));

  const REASONS = ['تصاویر بی کیفیت و نامناسب (تصاویری نامرتبط با محصول، تصاویر شخصی و ...)'];
  const rejected = await post('/admin/products/reviewProduct', { id: id1, approve: false, rejectionReasons: REASONS }, token);
  check('رد با دلایل → rejected', rejected.json?.data?.status === 'rejected', JSON.stringify(rejected.json).slice(0, 140));

  const again = await post('/admin/products/reviewProduct', { id: id1, approve: true }, token);
  check('بازبینی دوباره → ALREADY_REVIEWED', again.json?.code === 'ALREADY_REVIEWED');

  const approved = await post('/admin/products/reviewProduct', { id: id2, approve: true }, token);
  check('تأیید → confirmed', approved.json?.data?.status === 'confirmed');

  // کاربر دلایل را در پنلش می‌بیند
  const myProducts = await post('products/getMyProducts', {}, me.token);
  const mine = (myProducts.json?.data?.items ?? []).find((r) => r.id === id1);
  check('دلایل رد در پنل کاربر', Array.isArray(mine?.rejectionReasons) && mine.rejectionReasons[0] === REASONS[0]);

  // ── ۶) setProductStatus ─────────────────────────────────────────────────────
  const toRej = await post('/admin/products/setProductStatus', { id: id2, status: 'rejected', rejectionReasons: REASONS }, token);
  check('confirmed→rejected با دلیل', toRej.json?.data?.status === 'rejected');

  let pub = await post('products/getProductList', { s: `تست A4 ${rnd}` }, null);
  check('رد‌شده از لیست عمومی پنهان', !(pub.json?.data?.items ?? []).some((r) => r.id === id2));

  const back = await post('/admin/products/setProductStatus', { id: id2, status: 'confirmed' }, token);
  check('بازگردانی → confirmed', back.json?.data?.status === 'confirmed');
  pub = await post('products/getProductList', { s: `تست A4 ${rnd}` }, null);
  check('بازگشته در لیست عمومی', (pub.json?.data?.items ?? []).some((r) => r.id === id2));

  const noReasonStatus = await post('/admin/products/setProductStatus', { id: id1, status: 'rejected' }, token);
  check('setProductStatus رد بدون دلیل → خطا', noReasonStatus.json?.code === 'REASON_REQUIRED');

  // ── ۷) setLadder ────────────────────────────────────────────────────────────
  const lad = await post('/admin/products/setLadder', { id: id2, active: true }, token);
  check('نردبان روشن (هدیه)', lad.json?.data?.is_ladder === true && Boolean(lad.json?.data?.ladder_expires_at));

  pub = await post('products/getProductList', { s: `تست A4 ${rnd}`, sort: 'related' }, null);
  const ladRow = (pub.json?.data?.items ?? []).find((r) => r.id === id2);
  check('نردبان در صدر «مرتبط‌ترین» عمومی', pub.json?.data?.items?.[0]?.id === id2, JSON.stringify(pub.json?.data?.items?.map((i) => i.id)));

  const detLad = await post('/admin/products/getProductDetail', { id: id2 }, token);
  const giftOrder = (detLad.json?.data?.ladder_orders ?? []).find((o) => o.amount === 0);
  check('سفارش نردبان amount=0 (هدیه ادمین) در جزئیات', Boolean(giftOrder?.by_admin_gift));

  const ladOnPending = await post('/admin/products/setLadder', { id: id1, active: true }, token);
  check('نردبان روی آگهی non-confirmed رد', ladOnPending.json?.code === 'PRODUCT_NOT_CONFIRMED');

  const ladOff = await post('/admin/products/setLadder', { id: id2, active: false }, token);
  check('نردبان خاموش', ladOff.json?.data?.is_ladder === false && ladOff.json?.data?.ladder_expires_at === null);
  const ladFilter = await post('/admin/products/getProductList', { ladder: false, sellerId: me.userId }, token);
  check('فیلتر ladder=false', (ladFilter.json?.data?.items ?? []).length === 2);

  // ── ۸) deleteProduct ────────────────────────────────────────────────────────
  const del = await post('/admin/products/deleteProduct', { id: id1 }, token);
  check('deleteProduct → deleted', del.json?.data?.status === 'deleted' && del.json?.data?.files_removed === 0);
  pub = await post('products/getProductList', { s: `تست A4 ${rnd}` }, null);
  check('حذف‌شده از عمومی پنهان', !(pub.json?.data?.items ?? []).some((r) => r.id === id1));

  // ── ۹) درخواست‌های خرید ─────────────────────────────────────────────────────
  const rlist = await post('/admin/buy-requests/getBuyRequestList', { search: `تست A4 ${rnd}` }, token);
  check('getBuyRequestList — ساختار', Array.isArray(rlist.json?.data?.items) && rlist.json?.data?.total >= 1);
  check('شمارنده تب‌های درخواست', typeof rlist.json?.data?.counts?.pending === 'number' && rlist.json?.data?.counts?.all >= 1,
    JSON.stringify(rlist.json?.data?.counts));
  const rrow = (rlist.json?.data?.items ?? []).find((r) => r.id === reqId);
  check('ردیف درخواست join‌شده', Boolean(rrow?.category_name === 'پسته' && rrow?.buyer?.phone === USER_PHONE && rrow?.requirement_amount === 500),
    JSON.stringify(rrow ?? {}).slice(0, 240));

  const byPhone2 = await post('/admin/buy-requests/getBuyRequestList', { search: USER_PHONE }, token);
  check('جستجو درخواست با موبایل خریدار', (byPhone2.json?.data?.items ?? []).some((r) => r.id === reqId));

  const rNoReason = await post('/admin/buy-requests/reviewBuyRequest', { id: reqId, approve: false }, token);
  check('رد درخواست بدون دلیل → REASON_REQUIRED', rNoReason.json?.code === 'REASON_REQUIRED');

  const rRej = await post('/admin/buy-requests/reviewBuyRequest', { id: reqId, approve: false, rejectionReason: 'مقیاس خرده‌فروشی قابل قبول نیست.' }, token);
  check('رد درخواست با دلیل', rRej.json?.data?.status === 'rejected');

  const rBack = await post('/admin/buy-requests/getBuyRequestList', { status: 'rejected', userId: me.userId }, token);
  check('فیلتر وضعیت rejected + خریدار', (rBack.json?.data?.items ?? []).some((r) => r.id === reqId));

  const rDel = await post('/admin/buy-requests/deleteBuyRequest', { id: reqId }, token);
  check('deleteBuyRequest → deleted', rDel.json?.data?.status === 'deleted');

  // پاک‌سازی آگهی دوم — فضای تست تمیز بماند
  await post('/admin/products/deleteProduct', { id: id2 }, token);

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('💥 خطای اجرای تست:', e);
  process.exit(1);
});
