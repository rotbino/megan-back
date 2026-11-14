/**
 * تابع serverless ورسل — هر درخواست /api/* به همین تابع می‌رسد (نام
 * فایل [...path] یعنی catch-all؛ آدرس اصلی درخواست روی req.url سالم
 * می‌ماند و مسیریابی را خودِ Fastify/Nest با پیشوند api/v1 انجام می‌دهد).
 *
 * چرا از dist لود می‌شود نه src؟ بیلدر ورسل TypeScript را با esbuild
 * ترنسپایل می‌کند که «emitDecoratorMetadata» را نمی‌سازد → تزریق وابستگی
 * نست (design:paramtypes) می‌شکند. dist با nest build (tsc واقعی) در
 * postinstall ساخته می‌شود — متادیتا سالم است. (scripts/vercel-postinstall.js)
 *
 * پیش از لود اپ، متغیرهای حیاتی چک می‌شوند تا نبودِ تنظیمات پروژه در
 * داشبورد ورسل، پیام روشن بدهد — نه خطای مبهم FUNCTION_INVOCATION_FAILED.
 */
let readyPromise = null;

function jsonError(res, code, message) {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ status: false, code, message }));
}

module.exports = async (req, res) => {
  try {
    // ── چک متغیرهای حیاتی (همان منطق src/common/config/env.ts) ──
    const missing = [];
    if (!process.env.DATABASE_URL) missing.push('DATABASE_URL (آدرس Atlas)');
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      missing.push('JWT_SECRET (حداقل ۱۶ نویسه)');
    }
    const driver =
      process.env.APP_PROFILE === 'local'
        ? 'local'
        : process.env.STORAGE_DRIVER || 'arvan';
    if (
      driver === 'arvan' &&
      !(
        process.env.ARVAN_ENDPOINT &&
        process.env.ARVAN_ACCESS_KEY &&
        process.env.ARVAN_SECRET_KEY &&
        process.env.ARVAN_BUCKET_NAME
      )
    ) {
      missing.push('ARVAN_ENDPOINT، ARVAN_ACCESS_KEY، ARVAN_SECRET_KEY، ARVAN_BUCKET_NAME (کلیدهای آروان)');
    }
    if (missing.length) {
      return jsonError(
        res,
        'ENV_MISSING',
        'متغیرهای محیطی در Settings → Environment Variables پروژهٔ ورسل ست نشده‌اند: ' +
          missing.join('، ') +
          ' — مقادیر همان فایل .env لوکال است.',
      );
    }

    // ── لود یک‌بارهٔ اپ (نمونهٔ گرم بین درخواست‌ها حفظ می‌شود) ──
    if (!readyPromise) {
      readyPromise = require('../dist/serverless-app.js').ready;
    }
    const fastify = await readyPromise;

    // هندلر خام Fastify — همان چیزی که http.createServer درونش می‌گذارد
    fastify.routing(req, res);
  } catch (err) {
    // بوتی که شکست خورد را در فراخوانی بعدی دوباره تلاش کنیم
    readyPromise = null;
    jsonError(
      res,
      'BOOTSTRAP_FAILED',
      'راه‌اندازی بک‌اند روی ورسل شکست خورد: ' + (err && err.message ? err.message : String(err)),
    );
  }
};
