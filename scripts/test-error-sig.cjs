// تست امضای خطای ایمپورتر (سیاست خطای رکورد — خواستهٔ مالک ۱۵-۱۱).
// امضا = «نوعِ» خطا بدون جزئیات رکورد تا قانون «تکرار پیاپی همین خطا» کار کند.
// اجرا: node scripts/test-error-sig.cjs   (بعد از npm run build)
const assert = require('node:assert');
const { importErrorSignature } = require('../dist/importer/importer.service.js');

// ── دسته‌های شناخته‌شده ──
const cases = [
  [new Error('کاربر باسکول @baker پیدا نشد'), 'user-not-found'],
  [new Error('کاربر باسکول @ali_reza1374 پیدا نشد'), 'user-not-found'],
  [
    new Error('buskool /load_profile_by_user_name failed: HTTP 403 on /load_profile_by_user_name (backoff ×4)'),
    'http-403',
  ],
  [new Error('HTTP 404 on /get_product_by_id'), 'http-404'],
  [new Error('HTTP 400 on /get_product_list_by_user_name'), 'http-400'],
  [new Error('HTTP 500 on /x'), 'http-500'],
  [new Error('پاسخ HTML — این اندپوینت کوکی باسکول می‌خواهد (BUSKOOL_COOKIE)'), 'html-cookie'],
  [Object.assign(new Error('Invalid `prisma.user.upsert()` invocation'), { code: 'P2002' }), 'prisma-P2002'],
];

for (const [err, want] of cases) {
  const got = importErrorSignature(err);
  assert.strictEqual(got, want, `${err.message} → «${got}» (می‌خواستیم «${want}»)`);
}

// ── خطاهای ناشناخته: جزئیات رکورد (نام فیلد/عدد/مسیر) حذف می‌شود تا دو خطای
//    «یکسان از رکوردهای مختلف» هم‌امضا باشند — پیش‌نیاز قانون ۱۰ تکرار پیاپی ──
const a = importErrorSignature(new Error("Cannot read properties of undefined (reading 'product_name')"));
const b = importErrorSignature(new Error("Cannot read properties of undefined (reading 'user_info')"));
assert.strictEqual(a, b, `امضای دو خطای هم‌نوع فرق دارد: «${a}» ≠ «${b}»`);
assert.ok(a.startsWith('cannot read properties'), a);

const c = importErrorSignature(new Error('buskool /x failed: timeout after 30000ms'));
const d = importErrorSignature(new Error('buskool /y failed: timeout after 45000ms'));
assert.strictEqual(c, d, `اعداد نباید در امضا بمانند: «${c}» ≠ «${d}»`);

// دو خطای کاملاً متفاوتِ ناشناخته نباید هم‌امضا شوند
const e = importErrorSignature(new Error('Some strange failure'));
const f = importErrorSignature(new Error('A totally different failure'));
assert.notStrictEqual(e, f);

console.log(`\u2713 importErrorSignature — ${cases.length + 3} سناریو درست`);
