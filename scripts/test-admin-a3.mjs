#!/usr/bin/env node
/**
 * تست دستی فاز A3 پنل ادمین — مدیریت کاربران:
 *  ۱) ورود ادمین + توکن
 *  ۲) getUserList — بدون فیلتر / جستجو / فیلتر فروشنده-وضعیت + شمارنده‌ها
 *  ۳) توکن کاربر عادی روی admin/users/* → رد (تست منفی امنیتی) + بدون توکن → 401
 *  ۴) getUserDetail — ساختار کامل (user/stats/products/transactions/verification)
 *  ۵) setUserActive(false) → ورود کاربر مسدود + نشست باطل + آگهی‌ها از لیست عمومی پنهان
 *  ۶) setUserActive(true) → برگشت همه‌چیز
 *  ۷) setUserRoles — فروشنده/خریدار
 *  ۸) creditWallet — شارژ/کسر با دلیل + رد کسر بیش از موجودی + دیده‌شدن در تراکنش‌ها
 *  ۹) lastLoginAt بعد از ورود کاربر پر می‌شود
 *
 * اجرا: node scripts/test-admin-a3.mjs
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api/v1';
const ADMIN_USER = process.env.ADMIN_USER || '09196421264';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin434343';

let failures = 0;
function check(name, cond, extra = '') {
  const mark = cond ? '✅' : '❌';
  if (!cond) failures++;
  console.log(`${mark} ${name}${extra ? ` — ${extra}` : ''}`);
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── ۱) ورود ادمین ────────────────────────────────────────────────────────────
const login = await post('/admin/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
check('ورود ادمین', login.json?.status === true && Boolean(login.json?.data?.token));
const token = login.json?.data?.token;

// ── ۲) getUserList ───────────────────────────────────────────────────────────
const list = await post('/admin/users/getUserList', {}, token);
check('getUserList — ساختار', Array.isArray(list.json?.data?.items) && list.json?.data?.total >= 0);
const totalAll = list.json?.data?.total ?? 0;
console.log(`   کاربران: ${totalAll}`);

const firstRow = list.json?.data?.items?.[0];
check('getUserList — ردیف با شمارنده‌ها', firstRow ? typeof firstRow.product_count === 'number' && typeof firstRow.verification === 'string' : false);
check('getUserList — بدون هش رمز', !JSON.stringify(list.json).includes('passwordHash'));

// جستجو با موبایل نمونه
const samplePhone = firstRow?.phone;
if (samplePhone) {
  const search = await post('/admin/users/getUserList', { search: samplePhone }, token);
  check('جستجو با موبایل', (search.json?.data?.items ?? []).some((u) => u.phone === samplePhone), samplePhone);
}
// فیلتر فروشنده
const sellers = await post('/admin/users/getUserList', { seller: true, perPage: 5 }, token);
check('فیلتر فروشنده‌ها', (sellers.json?.data?.items ?? []).every((u) => u.is_seller === true), `total=${sellers.json?.data?.total}`);
// فیلتر غیرفعال (فعلاً همه فعال — فقط ساختار)
const inactive = await post('/admin/users/getUserList', { active: false }, token);
check('فیلتر وضعیت غیرفعال', Array.isArray(inactive.json?.data?.items) && inactive.json?.data?.total === 0);
// اعتبارسنجی DTO — perPage مسخره
const bad = await post('/admin/users/getUserList', { perPage: 999 }, token);
check('perPage > 50 رد شد', bad.status === 400);

// ── ۳) تست منفی امنیتی ──────────────────────────────────────────────────────
const rndPhone = `0936${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const userLogin = await post('/auth/login', { phone: rndPhone });
const userToken = userLogin.json?.data?.accessToken;
const neg1 = await post('/admin/users/getUserList', {}, userToken);
check('توکن کاربر عادی رد شد', neg1.status === 401, `status=${neg1.status}`);
const neg2 = await post('/admin/users/getUserDetail', {});
check('بدون توکن → 401', neg2.status === 401);

// ── ۴) getUserDetail ─────────────────────────────────────────────────────────
const detail = await post('/admin/users/getUserDetail', { id: firstRow?.id }, token);
const d = detail.json?.data;
check(
  'getUserDetail — ساختار کامل',
  Boolean(d?.user?.phone) && d?.stats?.products !== undefined && Array.isArray(d?.products) && Array.isArray(d?.transactions) && d?.verification !== undefined,
);
const detail404 = await post('/admin/users/getUserDetail', { id: '000000000000000000000000' }, token);
check('کاربر ناموجود → 404', detail404.status === 404);

// ── ۵-۶) setUserActive — کاربر آزمایشی با آگهی «تأییدشده» ────────────────────
// شمارنده ردیف همه وضعیت‌ها را می‌شمارد؛ برای تست پنهان‌شدن، کاربری با آگهی
// confirmed پیدا می‌کنیم (جزئیات، آمار تفکیک‌شده دارد).
let withProducts = null;
for (const u of (list.json?.data?.items ?? []).filter((x) => x.product_count > 0)) {
  const ud = await post('/admin/users/getUserDetail', { id: u.id }, token);
  if ((ud.json?.data?.stats?.products?.confirmed ?? 0) > 0) {
    withProducts = u;
    break;
  }
}
if (withProducts) {
  // شمار آگهی‌های عمومی این کاربر قبل از غیرفعال‌سازی
  const before = await post('/products/getProductList', { pageSize: 48 });
  const beforeTotal = before.json?.data?.total ?? 0;

  const off = await post('/admin/users/setUserActive', { id: withProducts.id, active: false }, token);
  check('setUserActive(false)', off.json?.status === true);

  // ورود کاربر مسدود؟ (اگر رمز ندارد، ورود بدون رمز → باید FORBIDDEN باشد)
  const blockedLogin = await post('/auth/login', { phone: withProducts.phone });
  check('ورود کاربر غیرفعال مسدود', blockedLogin.status === 403, `status=${blockedLogin.status} code=${blockedLogin.json?.code ?? blockedLogin.json?.message}`);

  // آگهی‌ها از لیست عمومی پنهان؟
  const after = await post('/products/getProductList', { pageSize: 48 });
  check('آگهی‌های کاربر از لیست عمومی پنهان', (after.json?.data?.total ?? 0) < beforeTotal, `${beforeTotal} → ${after.json?.data?.total}`);

  const on = await post('/admin/users/setUserActive', { id: withProducts.id, active: true }, token);
  check('setUserActive(true) — برگشت', on.json?.status === true);

  const restored = await post('/products/getProductList', { pageSize: 48 });
  check('آگهی‌ها برگشت', (restored.json?.data?.total ?? 0) === beforeTotal, `→ ${restored.json?.data?.total}`);

  // ورود دوباره ممکن؟ (کاربر بدون رمز)
  const okLogin = await post('/auth/login', { phone: withProducts.phone });
  check('ورود کاربر فعال‌شده', okLogin.json?.status === true);

  // lastLoginAt پر شد؟
  const detail2 = await post('/admin/users/getUserDetail', { id: withProducts.id }, token);
  check('lastLoginAt ثبت شد', Boolean(detail2.json?.data?.user?.last_login_at));
} else {
  console.log('⚠️ کاربر دارای آگهی پیدا نشد — تست ۵/۶ رد شد');
}

// ── ۷) setUserRoles ──────────────────────────────────────────────────────────
const roles = await post('/admin/users/setUserRoles', { id: firstRow?.id, isSeller: true, isBuyer: false }, token);
check('setUserRoles — فروشنده روشن/خریدار خاموش', roles.json?.data?.is_seller === true && roles.json?.data?.is_buyer === false);
const rolesBack = await post('/admin/users/setUserRoles', { id: firstRow?.id, isSeller: firstRow.is_seller, isBuyer: firstRow.is_buyer }, token);
check('setUserRoles — برگشت به وضعیت اول', rolesBack.json?.status === true);
const roleAdmin = await post('/admin/users/setUserRoles', { id: firstRow?.id, role: 'ADMIN' }, token);
check('ارتقا به ADMIN رد شد (فاز A5)', roleAdmin.status === 403);

// ── ۸) creditWallet ──────────────────────────────────────────────────────────
const beforeWallet = await post('/admin/users/getUserDetail', { id: firstRow?.id }, token);
const bal0 = beforeWallet.json?.data?.user?.wallet_balance ?? 0;

const up = await post('/admin/users/creditWallet', { id: firstRow?.id, amount: 500_000, reason: 'تست شارژ دستی A3' }, token);
check('creditWallet +۵۰۰٫۰۰۰', up.json?.data?.balance === bal0 + 500_000, `${bal0} → ${up.json?.data?.balance}`);

const down = await post('/admin/users/creditWallet', { id: firstRow?.id, amount: -200_000, reason: 'تست کسر دستی A3' }, token);
check('creditWallet −۲۰۰٫۰۰۰', down.json?.data?.balance === bal0 + 300_000);

// کسر بیش از موجودی → خطا (برای کاربری که موجودی‌اش کم است، شمارش منفی فرضی)
const tooMuch = await post('/admin/users/creditWallet', { id: firstRow?.id, amount: -(bal0 + 300_000 + 1_000_000), reason: 'کسر بیش از حد' }, token);
check('کسر بیش از موجودی رد شد', tooMuch.status === 400, `code=${tooMuch.json?.code}`);

// بدون دلیل → 400
const noReason = await post('/admin/users/creditWallet', { id: firstRow?.id, amount: 1000, reason: '' }, token);
check('بدون دلیل رد شد', noReason.status === 400);

// تراکنش «اصلاح کیف پول» در تاریخچه؟
const txDetail = await post('/admin/users/getUserDetail', { id: firstRow?.id }, token);
const hasAdjust = (txDetail.json?.data?.transactions ?? []).some((t) => String(t.title).includes('اصلاح کیف پول'));
check('اصلاح در تاریخچه تراکنش‌ها دیده شد', hasAdjust);

// برگشت موجودی به حالت اول
const revert = bal0 - (bal0 + 300_000);
const back = await post('/admin/users/creditWallet', { id: firstRow?.id, amount: revert, reason: 'برگشت تست A3' }, token);
check('موجودی به حالت اول برگشت', back.json?.data?.balance === bal0);

// ── ۹) reviewVerification — اگر سفارش pending وجود دارد ─────────────────────
const verificationList = await post('/admin/users/getVerificationOrders', { status: 'pending' }, token);
const verificationListAdmin = await post('/admin/users/getUserList', { verified: false }, token);
console.log(`   درخواست‌های احراز pending: ${verificationList.json?.data?.total ?? 'n/a (توکن کاربر)'} / کاربران احرازنشده: ${verificationListAdmin.json?.data?.total ?? 0}`);
// خود تست تأیید/رد در تست مرورگر انجام می‌شود (تغییر وضعیت دیتای واقعی اینجا منطقی نیست)

console.log(failures === 0 ? '\n🎉 همه تست‌های A3 موفق' : `\n💥 ${failures} تست شکست خورد`);
process.exit(failures === 0 ? 0 : 1);
