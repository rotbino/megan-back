/**
 * تابع serverless ورسل — پلِ (req, res) ورسل به اپ Nest+Fastify.
 *
 * معماری: dist کامپایل‌شده با tsc (متادیتای دیکوریتور سالم) لود می‌شود و
 * درخواست‌ها با fastify.inject (light-my-request) تزریق می‌شوند؛ بدون listen
 * و بدون سوکت. وب‌سوکت چت روی ورسل کار نمی‌کند (محدودیت پلتفرم).
 *
 * لایهٔ تشخیصی (موقت): requireهای سنگین «تنبل» و داخل try هستند تا اگر
 * ماژولی در لود شکست بخورد، همان stack در پاسخ HTTP برگردد (به‌جای صفحهٔ
 * FUNCTION_INVOCATION_FAILED ورسل که هیچ چیزی نمی‌گوید). هدر x-megan-diag
 * هم آخرین مرحلهٔ رسیده را نشان می‌دهد.
 */
let diagLib = null;
try {
  diagLib = require('../dist/vercel-boot-diag');
} catch {
  /* حتی بدون بیکن هم تشخیص از طریق پاسخ HTTP کار می‌کند */
}
const beacon = (stage, extra) =>
  diagLib ? diagLib.beacon(stage, extra).catch(() => {}) : Promise.resolve();

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
      .then(() => require('../dist/serverless-app')) // require سنگین — تنبل
      .then((m) => m.getApp())
      .then((app) => app.getHttpAdapter().getInstance())
      .catch((err) => {
        fastifyPromise = null; // شکست؟ فراخوانی بعدی از نو
        throw err;
      });
  }
  return fastifyPromise;
}

function fail(res, stage, err, diag) {
  res.setHeader('x-megan-diag', stage);
  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      status: false,
      stage,
      diag,
      detail: String(err?.stack ?? err).slice(0, 1500),
    }),
  );
}

module.exports = async function handler(req, res) {
  let diag = 'handler-enter';
  try {
    await beacon('handler-enter');
    res.setHeader('x-megan-diag', diag);

    const fastify = await getFastify();
    diag = 'app-ready';
    await beacon('app-ready');

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
    void beacon('handler-error', { stage: diag, err: String(err?.stack ?? err) });
    fail(res, 'handler-error:' + diag, err, diag);
  }
};
