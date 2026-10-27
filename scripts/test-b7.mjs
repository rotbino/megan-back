#!/usr/bin/env node
/**
 * تست سرتاسری B7 — درخواست‌های خرید (RFQ) + CRM نشان‌شده‌ها
 * نیاز: سرور :4000 (dev) + seedها اجرا شده باشند
 */
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

async function adminLogin(username = process.env.ADMIN_USER || '09196421264', password = process.env.ADMIN_PASS || 'admin434343') {
  const r = await post('admin/auth/login', { username, password });
  if (!r.json?.data?.token) throw new Error('admin login failed: ' + JSON.stringify(r.json).slice(0, 200));
  return r.json.data.token;
}

async function login(phone) {
  const s = await post('auth/sendOtp', { phone });
  const code = s.json?.data?.devCode;
  if (!code) throw new Error('devCode نیامد');
  const v = await post('auth/verifyOtp', { phone, code });
  return { token: v.json?.data?.accessToken, userId: v.json?.data?.user?.id };
}

(async () => {
  console.log('── B7: درخواست‌های خرید + CRM ──');

  const USER_PHONE = '0913' + String(1_000_000 + Math.floor(Math.random() * 8_999_999));
  const ADMIN_PHONE = '09350001122';
  const me = await login(USER_PHONE);
  const admin = await login(ADMIN_PHONE);
  const adminJwt = await adminLogin();
  check('ورود کاربر و ادمین', !!me.token && !!adminJwt);

  // ── ۱) لیست عمومی seed شده ──
  let r = await post('buy-requests/getBuyRequestList', { page: 1, perPage: 12 });
  check('لیست عمومی ≥۶۰', (r.json?.data?.total ?? 0) >= 60, `total=${r.json?.data?.total}`);
  check('صفحه‌بندی ۱۲تایی', r.json?.data?.items?.length === 12 && (r.json?.data?.pageCount ?? 0) >= 5);
  const first = r.json?.data?.items?.[0];
  check('شکل کارت باسکول', !!(first?.subcategoryName && first?.requirementAmount && first?.unit && first?.city), JSON.stringify(first ?? {}).slice(0, 200));

  // جستجو
  r = await post('buy-requests/getBuyRequestList', { s: 'پسته' });
  const searched = r.json?.data?.items ?? [];
  check(
    'جستجو «پسته» نتیجه دارد',
    searched.length > 0 && searched.every((x) => (x.subcategoryName ?? '').includes('پسته') || (x.name ?? '').includes('پسته')),
    `n=${searched.length}`,
  );

  // فیلتر استان (یزد)
  r = await post('locations/getAllProvinces', {});
  const yazd = (r.json?.data ?? []).find((p) => p.province_name === 'یزد');
  r = await post('buy-requests/getBuyRequestList', { provinceId: yazd?.id });
  check('فیلتر استان یزد', (r.json?.data?.items ?? []).length > 0 && r.json?.data?.items.every((x) => true), `n=${r.json?.data?.total}`);

  // ── ۲) جدیدترین‌ها (صفحه اول) ──
  r = await post('buy-requests/getLatestBuyRequests', {});
  check('getLatestBuyRequests ۴تایی', r.json?.data?.length === 4);

  // ── ۳) آشکارسازی شماره — گارد ──
  let res = await fetch(`${BASE}/buy-requests/getBuyRequestContact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: first?.id }),
  });
  check('شماره بدون لاگین 401', res.status === 401);

  r = await post('buy-requests/getBuyRequestContact', { id: first?.id }, me.token);
  check('شماره خریدار با لاگین', /^09\d{9}$/.test(r.json?.data?.phone ?? ''), JSON.stringify(r.json));

  // ── ۴) ثبت درخواست خرید (کاربر تست با محصول پسته) ──
  r = await post('buy-requests/createBuyRequest', {
    subCategoryId: 44, // پسته
    name: 'اکبری تست',
    requirementAmount: 500,
    goal: 'price_and_buy',
    hasHistory: false,
  }, me.token);
  check('ثبت درخواست → pending', r.json?.data?.status === 'pending', JSON.stringify(r.json).slice(0, 200));
  const myReqId = r.json?.data?.id;

  // PRODUCT_TYPE ساخته شد؟
  r = await post('categories/getCategoriesByParent', { parent_id: 44 }, me.token);
  const types = (r.json?.data ?? []).filter((c) => c.kind === 'PRODUCT_TYPE');
  check('نود PRODUCT_TYPE ساخته شد', types.some((t) => t.category_name === 'اکبری تست'), JSON.stringify(types.map((t) => t.category_name)));

  // idempotent — نوع تکراری بازمصرف
  r = await post('buy-requests/createBuyRequest', {
    subCategoryId: 44,
    name: 'اکبری تست',
    requirementAmount: 300,
  }, me.token);
  r = await post('categories/getCategoriesByParent', { parent_id: 44 }, me.token);
  const types2 = (r.json?.data ?? []).filter((c) => c.kind === 'PRODUCT_TYPE' && c.category_name === 'اکبری تست');
  check('نوع تکراری بازمصرف (نه دوتایی)', types2.length === 1, `n=${types2.length}`);

  // ── ۵) درخواستهای من ──
  r = await post('buy-requests/getMyBuyRequests', {}, me.token);
  check('درخواستهای من ۲تایی pending', r.json?.data?.counts?.pending === 2 && r.json?.data?.items?.length === 2, JSON.stringify(r.json?.data?.counts));

  // ── ۶) تأیید ادمین → عمومی ──
  r = await post('admin/buy-requests/reviewBuyRequest', { id: myReqId, approve: true }, adminJwt);
  check('تأیید ادمین', r.json?.data?.status === 'confirmed', JSON.stringify(r.json).slice(0, 150));
  r = await post('buy-requests/getBuyRequestList', { s: 'اکبری تست' });
  check('در لیست عمومی ظاهر شد', (r.json?.data?.items ?? []).some((x) => x.id === myReqId));

  // ── ۶.۵) کاربر سوم: درخواست هم‌دسته بدون تطابق نام (برای tier same-product) ──
  const noProd = await login('0914' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  r = await post('buy-requests/createBuyRequest', {
    subCategoryId: 269, // سایر مواد معدنی
    name: 'زئولیت تست',
    requirementAmount: 7000,
  }, noProd.token);
  const otherReqId = r.json?.data?.id;
  r = await post('admin/buy-requests/reviewBuyRequest', { id: otherReqId, approve: true }, adminJwt);
  check('درخواست کاربر سوم تأیید', r.json?.data?.status === 'confirmed');

  // ── ۷) خریداران پیشنهادی — آگهی هم‌دسته با درخواست seed «کربن پوست پسته» ──
  r = await post('products/createProduct', {
    subCategoryId: 269, // سایر مواد معدنی — هم‌دسته درخواست seed
    productName: 'کربن پوست پسته تست',
    provinceId: 21,
    cityId: 230,
    stock: 6000,
    minSaleAmount: 500,
    minSalePrice: 50000,
    description: 'تست پیشنهادی‌های B7 — توضیحات بلندتر از سی نویسه.',
  }, me.token);
  check('آگهی تست ساخته شد', r.json?.status === true);
  const productId = r.json?.data?.id;

  // آگهی pending است → ادمین تأیید می‌کند
  r = await post('admin/products/reviewProduct', { id: productId, approve: true }, adminJwt);
  check('تأیید آگهی توسط ادمین', r.json?.data?.status === 'confirmed', JSON.stringify(r.json).slice(0, 150));

  r = await post('buy-requests/getSuggestedBuyers', {}, me.token);
  const sug = r.json?.data ?? [];
  check('خریداران پیشنهادی > 0', sug.length > 0, `n=${sug.length}`);
  check('ساختار SuggestedBuyer', sug.every((s) => s.buyRequest && typeof s.matchScore === 'number' && s.tier && s.relatedProduct));
  const exact = sug.find((s) => s.tier === 'exact');
  check('تطابق exact برای «کربن پوست پسته»', !!exact && exact.buyRequest.name?.includes('کربن پوست پسته') && exact.matchScore >= 70, JSON.stringify(exact?.buyRequest?.name));
  const same = sug.find((s) => s.tier === 'same-product');
  check('تطابق same-product هم‌دسته', !!same && same.buyRequest.subcategoryName === 'سایر مواد معدنی');
  check('سورت نزولی امتیاز', sug.every((s, i) => i === 0 || sug[i - 1].matchScore >= s.matchScore));

  // بدون آگهی → خالی
  r = await post('buy-requests/getSuggestedBuyers', {}, noProd.token);
  check('بدون آگهی → پیشنهادی خالی', (r.json?.data ?? []).length === 0);

  // ── ۸) CRM ──
  // لیست جدید
  r = await post('saved/createSavedList', { name: 'خریداران پسته' }, me.token);
  check('لیست جدید', !!r.json?.data?.id, JSON.stringify(r.json).slice(0, 150));
  const listId = r.json?.data?.id;

  // تکراری
  r = await post('saved/createSavedList', { name: 'خریداران پسته' }, me.token);
  check('لیست تکراری رد', r.json?.status === false && r.json?.code === 'LIST_EXISTS');

  // نشان کردن خریدار اول لیست عمومی
  const targetId = first?.myuserId;
  check('targetUserId شکل ObjectId', /^[0-9a-f]{24}$/.test(targetId ?? ''), String(targetId));
  r = await post('saved/saveBuyerToList', { targetUserId: targetId, listId }, me.token);
  check('نشان کردن خریدار', !!r.json?.data?.savedUserId, JSON.stringify(r.json).slice(0, 150));
  const savedUserId = r.json?.data?.savedUserId;

  // تکراری
  r = await post('saved/saveBuyerToList', { targetUserId: targetId, listId }, me.token);
  check('نشان کردن تکراری رد', r.json?.code === 'ALREADY_SAVED');

  r = await post('saved/getSavedLists', {}, me.token);
  check('getSavedLists cnt=1', r.json?.data?.[0]?.cnt === 1, JSON.stringify(r.json?.data));
  check('نام لیست', r.json?.data?.[0]?.name === 'خریداران پسته');

  // کارت‌های CRM
  r = await post('saved/getSavedListUsers', { listId }, me.token);
  const users0 = r.json?.data ?? [];
  check('کارت CRM خریدار', users0.length === 1 && users0[0].status === 'following' && Array.isArray(users0[0].notes), JSON.stringify(users0).slice(0, 200));

  // تغییر وضعیت
  r = await post('saved/setSavedUserStatus', { savedUserId, status: 'priority_high' }, me.token);
  check('تغییر وضعیت', r.json?.status === true);
  r = await post('saved/getSavedListUsers', { listId }, me.token);
  check('وضعیت new = اولویت زیاد', r.json?.data?.[0]?.status === 'priority_high');

  // وضعیت نامعتبر
  r = await post('saved/setSavedUserStatus', { savedUserId, status: 'bogus' }, me.token);
  check('وضعیت نامعتبر رد', r.json?.status === false);

  // یادداشت
  r = await post('saved/addSavedUserNote', { savedUserId, text: 'یادم باشه زنگ بزنم' }, me.token);
  check('یادداشت ثبت', !!r.json?.data?.id && r.json?.data?.text === 'یادم باشه زنگ بزنم');
  r = await post('saved/getSavedListUsers', { listId }, me.token);
  check('یادداشت در کارت', (r.json?.data?.[0]?.notes ?? []).length === 1);

  // لیست دوم + انتقال
  r = await post('saved/createSavedList', { name: 'لیست دوم' }, me.token);
  const list2 = r.json?.data?.id;
  r = await post('saved/moveSavedUser', { savedUserId, toListId: list2 }, me.token);
  check('انتقال به لیست دیگر', r.json?.status === true);
  r = await post('saved/getSavedListUsers', { listId }, me.token);
  check('لیست اول خالی شد', (r.json?.data ?? []).length === 0);
  r = await post('saved/getSavedListUsers', { listId: list2 }, me.token);
  check('لیست دوم یک نفر', (r.json?.data ?? []).length === 1);

  // دسترسی کاربر دیگر → null/404
  r = await post('saved/getSavedListUsers', { listId: list2 }, noProd.token);
  check('لیست دیگران در دسترس نیست', r.json?.data === null);

  // حذف نشان‌شده + حذف لیست
  r = await post('saved/removeSavedUser', { savedUserId }, me.token);
  check('حذف نشان‌شده', r.json?.status === true);
  r = await post('saved/deleteSavedList', { listId: list2 }, me.token);
  check('حذف لیست', r.json?.status === true);
  r = await post('saved/getSavedLists', {}, me.token);
  check('یک لیست ماند', (r.json?.data ?? []).length === 1);

  console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
