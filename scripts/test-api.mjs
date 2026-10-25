#!/usr/bin/env node
/**
 * تست سرتاسری اندپوینت‌های فاز B0..B3 — اجرا: node scripts/test-api.mjs
 * پیش‌نیاز: سرور روی :4000 در حال اجرا (node dist/main.js)
 */
const BASE = 'http://localhost:4000';
const PHONE = '09123456789';

let passed = 0;
let failed = 0;

function show(title, ok, extra = '') {
  const mark = ok ? '✔' : '✖';
  if (ok) passed++; else failed++;
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
  // ── health ──
  const health = await fetch(BASE + '/health').then((r) => r.json());
  show('GET /health', health?.status === true && health?.data?.db === 'up');

  // ── validation: شماره غلط ──
  const badPhone = await post('/auth/sendOtp', { phone: '12345' });
  show('sendOtp شماره نامعتبر → 400 فارسی', badPhone.status === 400 && badPhone.json?.status === false && /موبایل/.test(badPhone.json?.message ?? ''));

  // ── sendOtp ──
  const send = await post('/auth/sendOtp', { phone: PHONE });
  const devCode = send.json?.data?.devCode;
  show('sendOtp → devCode در development', send.status === 201 || send.status === 200, `devCode=${devCode}`);
  show('sendOtp پیام فارسی', send.json?.message === 'کد تایید ارسال شد.');

  // ── verifyOtp غلط ──
  const wrong = await post('/auth/verifyOtp', { phone: PHONE, code: '00000' });
  show('verifyOtp کد غلط → 400 OTP_WRONG', wrong.status === 400 && wrong.json?.code === 'OTP_WRONG');

  // ── verifyOtp درست ──
  const verify = await post('/auth/verifyOtp', { phone: PHONE, code: devCode });
  const { accessToken, refreshToken, user, isNewUser } = verify.json?.data ?? {};
  show('verifyOtp → توکن‌ها + کاربر', Boolean(accessToken && refreshToken && user?.phone === PHONE), `isNewUser=${isNewUser}`);

  // ── getProfile با توکن ──
  const profile = await post('/users/getProfile', {}, accessToken);
  show('getProfile با توکن', profile.json?.status === true && profile.json?.data?.user?.phone === PHONE);

  // ── getProfile بدون توکن ──
  const noAuth = await post('/users/getProfile', {});
  show('getProfile بدون توکن → 401', noAuth.status === 401 && noAuth.json?.status === false);

  // ── updateProfile ──
  const upd = await post('/users/updateProfile', {
    first_name: 'سامی',
    last_name: 'جابر',
    sex: 'آقا',
    is_seller: true,
    profile: { description: 'پخش عمده خشکبار', activity_domain: 'خشکبار', is_company: false },
  }, accessToken);
  const updUser = upd.json?.data?.user;
  show('updateProfile → نام/جنسیت/نقش', updUser?.first_name === 'سامی' && updUser?.is_seller === true);
  show('updateProfile → user_name تولید شد', typeof updUser?.user_name === 'string' && updUser.user_name.length >= 6, updUser?.user_name);
  show('updateProfile → profile embedded', upd.json?.data?.profile?.description === 'پخش عمده خشکبار');

  // ── getUserByPhone ──
  const byPhone = await post('/users/getUserByPhone', { phone: PHONE });
  show('getUserByPhone → اطلاعات عمومی', byPhone.json?.data?.first_name === 'سامی' && byPhone.json?.data?.user_name === updUser?.user_name);

  // ── refreshToken چرخشی ──
  const refresh = await post('/auth/refreshToken', { refreshToken });
  const newAccess = refresh.json?.data?.accessToken;
  show('refreshToken → جفت جدید', Boolean(newAccess && refresh.json?.data?.refreshToken));
  const refreshOld = await post('/auth/refreshToken', { refreshToken });
  show('refreshToken قبلی باطل شد', refreshOld.status === 401 && refreshOld.json?.code === 'REFRESH_INVALID');

  // ── logout ──
  const logout = await post('/auth/logout', { refreshToken: refresh.json?.data?.refreshToken });
  show('logout', logout.json?.status === true);

  // ── categories ──
  const tree = await post('/categories/getAllCategories');
  const roots = tree.json?.data ?? [];
  const agriculture = roots.find((c) => c.category_name === 'کشاورزی');
  show('getAllCategories → ۱۰ ریشه', roots.length === 10, `roots=${roots.length}`);
  const khoshkbar = agriculture?.children?.find((c) => c.category_name === 'خشکبار');
  const peste = khoshkbar?.children?.find((c) => c.category_name === 'پسته');
  show('درخت ۳ سطحی: کشاورزی←خشکبار←پسته (id=44)', peste?.id === 44 && peste?.min === 500 && peste?.example === 'فندقی');

  const children = await post('/categories/getCategoriesByParent', { parent_id: 76 });
  show('getCategoriesByParent(76) → فرزندان کشاورزی', (children.json?.data?.length ?? 0) >= 8, `count=${children.json?.data?.length}`);

  // کش: دومین فراخوانی باید فوری و همان نتیجه باشد
  const t0 = Date.now();
  const tree2 = await post('/categories/getAllCategories');
  show('کش: getAllCategories دوباره → همان نتیجه', JSON.stringify(tree2.json?.data) === JSON.stringify(roots), `${Date.now() - t0}ms`);

  // ── locations ──
  const provs = await post('/locations/getAllProvinces');
  const esfahan = (provs.json?.data ?? []).find((p) => p.province_name === 'اصفهان');
  show('getAllProvinces → ۳۱ استان', (provs.json?.data?.length ?? 0) === 31);
  show('اصفهان id=4', esfahan?.id === 4);

  const kermanCities = await post('/locations/getCitiesByProvince', { province_id: 21 });
  const babak = (kermanCities.json?.data ?? []).find((c) => c.city_name === 'شهر بابک');
  show('getCitiesByProvince(21=کرمان) → شهرها', (kermanCities.json?.data?.length ?? 0) >= 25, `count=${kermanCities.json?.data?.length}`);
  show('شهر بابک id=230 بدون فاصله اضافی', babak?.id === 230 && !babak?.city_name.startsWith(' '));

  const allCities = await post('/locations/getCitiesByProvince', {});
  show('getCitiesByProvince بدون پارامتر → همه ۴۷۴ شهر', (allCities.json?.data?.length ?? 0) === 474);

  // ── swagger ──
  const docs = await fetch(BASE + '/docs/').then((r) => r.status);
  const swaggerJson = await fetch(BASE + '/docs-json').then((r) => r.json()).catch(() => null);
  show('Swagger /docs بالا است', docs === 200);
  show('Swagger /docs-json شامل همه اندپوینت‌ها', Object.keys(swaggerJson?.paths ?? {}).length >= 11, `paths=${Object.keys(swaggerJson?.paths ?? {}).length}`);

  console.log(`\n════════ نتیجه: ${passed} پاس / ${failed} خطا ════════`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('✖ خطای تست:', err);
  process.exit(1);
});
