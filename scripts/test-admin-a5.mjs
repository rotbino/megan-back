#!/usr/bin/env node
/**
 * تست دستی فاز A5 پنل ادمین — داشبورد عملیاتی + لاگ AdminAction + مدیریت ادمین‌ها:
 *  ۱) ورود ادمین بوت‌استرپ (SUPER_ADMIN) + ساخت کاربر تست با آگهی واقعی
 *  ۲) getStats کامل — شمارنده‌ها + صف‌ها + روند ۳۰ روزه (۳۰ نقطه) + درآمد
 *  ۳) getRecentActivity — عملیات اخیر + ثبت‌نام‌های اخیر
 *  ۴) ثبت خودکار AdminAction: setProductStatus → لاگ با actor/action/target/payload
 *  ۵) getAdminActions — فیلتر مسیر (contains) + فیلتر adminId + payload پاک‌سازی‌شده
 *  ۶) مدیریت ادمین‌ها: createAdmin + ورود ادمین جدید + ADMIN بدون دسترسی admins/*
 *     + setAdminActive (قفل ورود) + resetAdminPassword + گاردهای خودکار/آخرین سوپر
 *  ۷) شارژها از مسیر ادمین: getChargeOrders + رد بدون دلیل + تأیید (شارژ اعمال)
 *  ۸) تست منفی امنیتی: توکن کاربر عادی روی admin/* + بدون توکن
 *  ۹) مسیرهای قدیمی ادمینِ توکن‌کاربر حذف شده‌اند (404)
 *
 * اجرا: node scripts/test-admin-a5.mjs
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
  return { token: v.json?.data?.accessToken };
}

async function adminLogin(username, password) {
  const r = await post('admin/auth/login', { username, password });
  return { status: r.status, token: r.json?.data?.token, admin: r.json?.data?.admin };
}

async function makeJpeg(label) {
  const { default: sharp } = await import('sharp');
  const W = 1100, H = 750;
  const shapes = Array.from({ length: 120 }, (_, i) => {
    const x = (i * 137) % W, y = (i * 89) % H;
    return `<circle cx="${x}" cy="${y}" r="${8 + (i % 11) * 4}" fill="hsl(${(i * 13) % 360},72%,${35 + (i % 6) * 9}%)" opacity="0.85"/>`;
  }).join('');
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e8e2d6"/>
      ${shapes}
      <text x="36" y="70" font-size="40" fill="#222">${label} — فیش تست A5</text>
    </svg>`,
  );
  return sharp(svg).jpeg({ quality: 82 }).toBuffer();
}

async function sendReceipt(path, token, packageKey, jpegBuf) {
  const fd = new FormData();
  if (packageKey) fd.append('packageKey', packageKey);
  if (jpegBuf) fd.append('receipt', new Blob([jpegBuf], { type: 'image/jpeg' }), 'receipt.jpg');
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const rnd = String(Date.now()).slice(-7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('── A5: داشبورد عملیاتی + لاگ ادمین + مدیریت ادمین‌ها ──');

  // ── ۰) ورود ادمین بوت‌استرپ + کاربر تست ──────────────────────────────
  const boot = await adminLogin(ADMIN_USER, ADMIN_PASS);
  check('ورود ادمین بوت‌استرپ (SUPER_ADMIN)', !!boot.token && boot.admin?.role === 'SUPER_ADMIN');
  const token = boot.token;
  const bootstrapAdminId = boot.admin?.id;

  const user = await login('0914' + String(1_000_000 + Math.floor(Math.random() * 8_999_999)));
  const userToken = user.token;
  check('ورود کاربر تست', !!userToken);

  // آگهی pending برای عملیات بعدی
  const prod = await post('products/createProduct', {
    subCategoryId: 44,
    productName: `پسته تست A5 ${rnd}`,
    provinceId: 21, cityId: 230,
    stock: 100, minSaleAmount: 10, minSalePrice: 500000,
    description: `تست A5 — لاگ عملیات ادمین ${rnd} — توضیحات بلندتر از سی نویسه.`,
    features: [{ key: 'بسته بندی', value: 'کیلویی' }],
  }, userToken);
  const productId = prod.json?.data?.id;
  check('ثبت آگهی pending', Boolean(productId));

  // ── ۱) getStats کامل ──────────────────────────────────────────────────
  let r = await post('admin/dashboard/getStats', {}, token);
  const stats = r.json?.data;
  check('getStats موفق', r.json?.status === true);
  check('شمارنده‌های کلیدی', stats?.users?.total > 0 && stats?.products?.total > 0 && stats?.buyRequests >= 0);
  check('صف‌های انتظار', 'pendingProducts' in (stats?.queues ?? {}) && 'pendingBuyRequests' in (stats?.queues ?? {}) && 'pendingVerifications' in (stats?.queues ?? {}) && 'pendingCharges' in (stats?.queues ?? {}));
  check('صف آگهی در انتظار ≥۱', (stats?.queues?.pendingProducts ?? 0) >= 1);
  const trends = stats?.trends ?? [];
  check('روند ۳۰ روزه — ۳۰ نقطه', Array.isArray(trends) && trends.length === 30, `n=${trends.length}`);
  check('روند — ساختار نقطه', trends.every((t) => typeof t.date === 'string' && t.date.length === 10 && 'registrations' in t && 'products' in t && 'buyRequests' in t && 'ladderRevenue' in t && 'chargeRevenue' in t));
  check('امروز در روند هست', trends[29]?.date === new Date().toISOString().slice(0, 10), trends[29]?.date);
  check('درآمد کل (نردبان+شارژ)', 'revenue' in stats && 'ladderTotal' in stats.revenue && 'chargeTotal' in stats.revenue && 'last30Days' in stats.revenue);
  check('روند آگهی امروز ≥۱ (آگهی همین الان)', (trends[29]?.products ?? 0) >= 1);

  // ── ۲) getRecentActivity ──────────────────────────────────────────────
  r = await post('admin/dashboard/getRecentActivity', {}, token);
  const activity = r.json?.data;
  check('getRecentActivity موفق', r.json?.status === true);
  check('ثبت‌نام‌های اخیر', Array.isArray(activity?.recentUsers) && activity.recentUsers.length > 0);

  // ── ۳) ثبت خودکار AdminAction — یک mutation انجام بده ────────────────
  r = await post('admin/products/setProductStatus', { id: productId, status: 'confirmed' }, token);
  check('setProductStatus موفق', r.json?.status === true);

  await sleep(700); // لاگ fire-and-forget

  r = await post('admin/actions/getAdminActions', { action: 'setProductStatus', perPage: 10 }, token);
  const logItems = r.json?.data?.items ?? [];
  const mine = logItems.find((x) => String(x.targetId) === String(productId));
  check('لاگ خودکار ثبت شد', Boolean(mine), JSON.stringify(logItems.slice(0, 2)).slice(0, 200));
  check('لاگ — actor درست', mine?.admin?.id === bootstrapAdminId && mine?.admin?.role === 'SUPER_ADMIN');
  check('لاگ — مسیر عملیات', mine?.action === 'admin/products/setProductStatus');
  check('لاگ — نوع هدف', mine?.targetType === 'product');
  check('لاگ — payload خلاصه', mine?.payload && String(mine.payload.status) === 'confirmed' && String(mine.payload.id) === String(productId));
  check('لاگ — پیام موفقیت', typeof mine?.message === 'string' && mine.message.length > 0);

  // فیلتر adminId
  r = await post('admin/actions/getAdminActions', { adminId: bootstrapAdminId, perPage: 5 }, token);
  check('فیلتر adminId', (r.json?.data?.items ?? []).length > 0 && r.json?.data?.items.every((x) => x.admin?.id === bootstrapAdminId));

  // عملیات خواندنی لاگ نمی‌شود
  await post('admin/actions/getAdminActions', { perPage: 1 }, token);
  await sleep(400);
  r = await post('admin/actions/getAdminActions', { action: 'getAdminActions' }, token);
  check('عملیات خواندنی لاگ نمی‌شود', (r.json?.data?.total ?? 0) === 0);

  // ── ۴) مدیریت ادمین‌ها ────────────────────────────────────────────────
  const newAdminUser = `0935${String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(1)}`;
  r = await post('admin/admins/createAdmin', {
    username: newAdminUser,
    name: 'ادمین تست A5',
    role: 'ADMIN',
    password: 'a5-pass-12345',
  }, token);
  check('createAdmin موفق', r.json?.status === true && r.json?.data?.username === newAdminUser && !r.json?.data?.passwordHash);
  const newAdminId = r.json?.data?.id;

  // نام تکراری
  r = await post('admin/admins/createAdmin', { username: newAdminUser, name: 'تکراری', role: 'ADMIN', password: 'a5-pass-12345' }, token);
  check('نام کاربری تکراری رد', r.json?.code === 'ADMIN_USERNAME_TAKEN');

  // ورود ادمین جدید
  let na = await adminLogin(newAdminUser, 'a5-pass-12345');
  check('ورود ادمین جدید', !!na.token && na.admin?.role === 'ADMIN');

  // ادمین عادی (ADMIN) به مدیریت ادمین‌ها دست ندارد
  r = await post('admin/admins/getAdminList', {}, na.token);
  check('ADMIN به admins/* دست ندارد (403)', r.status === 403 && r.json?.code === 'ADMIN_ROLE_REQUIRED');
  // ولی به بقیه پنل دست دارد
  r = await post('admin/users/getUserList', { page: 1, perPage: 1 }, na.token);
  check('ADMIN به پنل عادی دست دارد', r.json?.status === true);

  // getAdminList توسط سوپر
  r = await post('admin/admins/getAdminList', {}, token);
  const adminsList = r.json?.data?.items ?? [];
  check('getAdminList موفق', r.json?.status === true && adminsList.length >= 2);
  check('getAdminList — بدون هش', adminsList.every((a) => !('passwordHash' in a)));
  check('getAdminList — شمارش عملیات', adminsList.every((a) => typeof a.actionCount === 'number'));
  const created = adminsList.find((a) => a.id === newAdminId);
  check('ادمین جدید در لیست', Boolean(created));

  // غیرفعال‌کردن خود خودم رد
  r = await post('admin/admins/setAdminActive', { adminId: bootstrapAdminId, active: false }, token);
  check('غیرفعال‌کردن خود خودم رد', r.json?.code === 'ADMIN_SELF_DEACTIVATE');

  // غیرفعال‌کردن آخرین سوپر رد
  const otherSuper = adminsList.find((a) => a.role === 'SUPER_ADMIN' && a.id !== bootstrapAdminId);
  if (otherSuper) {
    r = await post('admin/admins/setAdminActive', { adminId: otherSuper.id, active: false }, token);
    check('آخرین سوپر فعال دیگر رد', r.json?.code === 'LAST_SUPER_ADMIN' || r.json?.status === true);
  }

  // غیرفعال‌کردن ادمین جدید → ورودش قفل
  r = await post('admin/admins/setAdminActive', { adminId: newAdminId, active: false }, token);
  check('setAdminActive موفق', r.json?.status === true && r.json?.data?.isActive === false);
  na = await adminLogin(newAdminUser, 'a5-pass-12345');
  check('ورود ادمین غیرفعال رد (403)', na.status === 403 || !na.token);

  // resetAdminPassword → ورود با رمز جدید
  r = await post('admin/admins/resetAdminPassword', { adminId: newAdminId, newPassword: 'a5-newpass-99' }, token);
  check('resetAdminPassword موفق', r.json?.status === true);
  // فعال‌سازی مجدد + ورود با رمز جدید
  await post('admin/admins/setAdminActive', { adminId: newAdminId, active: true }, token);
  na = await adminLogin(newAdminUser, 'a5-newpass-99');
  check('ورود با رمز جدید', !!na.token);
  // رمز قدیمی دیگر کار نمی‌کند
  const oldPass = await adminLogin(newAdminUser, 'a5-pass-12345');
  check('رمز قدیمی رد', !oldPass.token);

  // رمز کوتاه رد
  r = await post('admin/admins/resetAdminPassword', { adminId: newAdminId, newPassword: 'short' }, token);
  check('رمز کوتاه رد (validation)', r.status === 400);

  // لاگ عملیات ادمین ثبت شده؟ (createAdmin)
  r = await post('admin/actions/getAdminActions', { action: 'createAdmin', perPage: 5 }, token);
  const createLog = (r.json?.data?.items ?? []).find((x) => x.payload?.username === newAdminUser);
  check('لاگ createAdmin ثبت شد', Boolean(createLog));
  check('لاگ createAdmin — payload بدون رمز', createLog && String(createLog.payload?.password) === '[حذف شد]');

  // ── ۵) شارژها از مسیر ادمین ───────────────────────────────────────────
  const jpeg = await makeJpeg('p100');
  let j = await sendReceipt('wallet/createChargeOrder', userToken, 'p100', jpeg);
  check('سفارش شارژ pending', j.json?.status === true && j.json?.data?.status === 'pending');

  r = await post('admin/wallet/getChargeOrders', { status: 'pending' }, token);
  const chargeItems = r.json?.data?.items ?? [];
  const myOrder = chargeItems.find((o) => o.user?.phone && j.json?.data && o.id === j.json.data.id) ?? chargeItems[0];
  check('صف شارژ ادمین', chargeItems.length >= 1 && Boolean(myOrder?.receipt));

  // رد بدون دلیل
  r = await post('admin/wallet/reviewChargeOrder', { orderId: myOrder.id, approve: false }, token);
  check('رد بدون دلیل → REASON_REQUIRED', r.json?.code === 'REASON_REQUIRED');

  // تأیید → شارژ اعمال (p100 = ۱۰۰هزار + ۰٪)
  const before = (await post('wallet/getWallet', {}, userToken)).json?.data?.balance;
  r = await post('admin/wallet/reviewChargeOrder', { orderId: myOrder.id, approve: true }, token);
  check('تأیید شارژ موفق', r.json?.status === true);
  const after = (await post('wallet/getWallet', {}, userToken)).json?.data?.balance;
  check('شارژ اعمال شد (+۱۰۰هزار)', after - before === 100_000, `${before} → ${after}`);

  // لاگ بازبینی شارژ
  await sleep(700);
  r = await post('admin/actions/getAdminActions', { action: 'reviewChargeOrder', perPage: 5 }, token);
  check('لاگ reviewChargeOrder', (r.json?.data?.items ?? []).length >= 1 && r.json?.data?.items[0]?.targetType === 'charge_order');

  // ── ۶) تست منفی امنیتی ────────────────────────────────────────────────
  r = await post('admin/actions/getAdminActions', {}, userToken);
  check('توکن کاربر عادی روی admin/actions → 401', r.status === 401);
  r = await post('admin/wallet/getChargeOrders', {}, userToken);
  check('توکن کاربر عادی روی admin/wallet → 401', r.status === 401);
  r = await post('admin/dashboard/getStats', {});
  check('بدون توکن → 401', r.status === 401);
  r = await post('admin/admins/createAdmin', { username: '09350009999', name: 'هکر', role: 'SUPER_ADMIN', password: 'hack-123456' }, userToken);
  check('کاربر عادی createAdmin → 401', r.status === 401);

  // ── ۷) مسیرهای قدیمی حذف شده‌اند ─────────────────────────────────────
  const legacyPaths = [
    'products/reviewProduct',
    'buy-requests/reviewBuyRequest',
    'wallet/getChargeOrders',
    'wallet/reviewChargeOrder',
    'verification/getVerificationOrders',
    'verification/reviewVerification',
    'uploads/listOrphans',
  ];
  for (const p of legacyPaths) {
    const res = await post(p, {}, userToken);
    check(`مسیر قدیمی حذف: ${p}`, res.status === 404, `status=${res.status}`);
  }

  // ── ۸) پاک‌سازی: ادمین تست غیرفعال + آگهی حذف ────────────────────────
  await post('admin/admins/setAdminActive', { adminId: newAdminId, active: false }, token);
  await post('admin/products/deleteProduct', { id: productId }, token);

  console.log(fail === 0 ? `\n🎉 همه تست‌های A5 موفق (${pass}/${pass + fail})` : `\n💥 ${fail} تست شکست خورد (${pass}/${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('💥 خطای اجرای تست:', e);
  process.exit(1);
});
