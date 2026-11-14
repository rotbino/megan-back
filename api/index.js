/**
 * تابع serverless ورسل — پلِ (req, res) ورسل به اپ Nest+Fastify.
 *
 * چرا این‌جا؟ پریست zero-config ورسل (کامپایل src/main.ts با خط لولهٔ خودش)
 * برای این پروژه پیش از اجرای کد کرش می‌کرد (FUNCTION_INVOCATION_FAILED بدون
 * حتی یک لاگ از اپ). این ورودی JS خام است: اسکریپت‌سازی TS ورسل دور زده
 * می‌شود و dist کامپایل‌شده با tsc (متادیتای دیکوریتور سالم) لود می‌شود —
 * همان الگویی که در بیلد postinstall ساخته شده است.
 *
 * درخواست‌ها با fastify.inject (light-my-request) تزریق می‌شوند؛ بدون
 * listen و بدون سوکت. وب‌سوکت چت روی ورسل کار نمی‌کند (محدودیت پلتفرم).
 */
// بیکن اول — اگر require های بعدی شکست بخورند، گزارش می‌رود (تشخیص موقت)
const { beacon } = require('../dist/vercel-boot-diag');
const { getApp } = require('../dist/serverless-app');

/** هدرهای hop-by-hop که نباید به پاسخ کپی شوند */
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

let fastifyPromise = null;

async function getFastify() {
  if (!fastifyPromise) {
    fastifyPromise = getApp().then((app) => app.getHttpAdapter().getInstance());
  }
  return fastifyPromise;
}

module.exports = async function handler(req, res) {
  try {
    const fastify = await getFastify();

    // بدنهٔ درخواست — خام و بدون دست‌کاری (multipart هم همین‌طور می‌رسد)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = chunks.length ? Buffer.concat(chunks) : undefined;

    const forwardedFor = req.headers['x-forwarded-for'];
    const remoteAddress =
      (typeof forwardedFor === 'string' && forwardedFor.split(',')[0].trim()) ||
      req.socket?.remoteAddress ||
      '127.0.0.1';

    const reply = await fastify.inject({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload,
      remoteAddress,
    });

    const headers = { ...reply.headers };
    for (const h of HOP_HEADERS) delete headers[h];

    res.writeHead(reply.statusCode, headers);
    res.end(reply.rawPayload);
  } catch (err) {
    // خطای ساخت اپ/تزریق — پاسخ حداقلی + بیکن برای ریشه‌یابی
    void beacon('api-handler-error', { err: String(err?.stack ?? err) }).catch(() => {});
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: false,
        message: 'serverless handler error',
        detail: String(err?.message ?? err).slice(0, 500),
      }),
    );
  }
};
