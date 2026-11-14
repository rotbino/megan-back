/**
 * تابع serverless ورسل — پلِ (req, res) ورسل به اپ Nest+Fastify.
 *
 * معماری: NestJS 12 فقط ESM است و require آن روی ران‌تایم ورسل خطای
 * ERR_REQUIRE_ESM می‌دهد؛ به همین دلیل اپ در زمان build با esbuild در
 * «یک فایل CJS» (‎.serverless/serverless-bundle.cjs از dist تلفیق‌شده با
 * tsc) بافته می‌شود و این‌جا لود می‌شود. درخواست‌ها با fastify.inject
 * (light-my-request) تزریق می‌شوند؛ بدون listen و بدون سوکت — وب‌سوکت چت
 * روی ورسل کار نمی‌کند (محدودیت پلتفرم؛ بک‌اند لوکال کامل است).
 *
 * خطاها به‌جای صفحهٔ خام ورسل، با مرحله (stage) و جزئیات در JSON برمی‌گردند
 * و هدر x-megan-diag می‌گوید بوت تا کجا پیش رفته است.
 */
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
    fastifyPromise = Promise.resolve()
      .then(() => require('../.serverless/serverless-bundle.cjs')) // require سنگین — تنبل
      .then((m) => m.getApp())
      .then((app) => app.getHttpAdapter().getInstance())
      .catch((err) => {
        fastifyPromise = null; // شکست؟ فراخوانی بعدی از نو
        throw err;
      });
  }
  return fastifyPromise;
}

function fail(res, stage, err) {
  res.setHeader('x-megan-diag', stage);
  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      status: false,
      stage,
      detail: String(err?.stack ?? err).slice(0, 1500),
    }),
  );
}

module.exports = async function handler(req, res) {
  let diag = 'handler-enter';
  try {
    res.setHeader('x-megan-diag', diag);

    const fastify = await getFastify();
    diag = 'app-ready';
    res.setHeader('x-megan-diag', diag);

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
    headers['x-megan-diag'] = diag;

    res.writeHead(reply.statusCode, headers);
    res.end(reply.rawPayload);
  } catch (err) {
    fail(res, 'handler-error:' + diag, err);
  }
};
