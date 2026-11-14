/**
 * تست محلی مسیر serverless — همان چیزی که تابع ورسل انجام می‌دهد:
 * http.createServer خام + fastify.routing(req, res) روی خروجی dist.
 * اگر اینجا جواب بگیریم، روی ورسل هم همین رفتار را خواهد داشت.
 */
const http = require('node:http');
const { ready } = require('../dist/serverless-app.js');

(async () => {
  const fastify = await ready;
  const server = http.createServer((req, res) => fastify.routing(req, res));
  server.listen(4100, '127.0.0.1', async () => {
    try {
      const base = 'http://127.0.0.1:4100';
      const r1 = await fetch(`${base}/api/v1/importer/ping`);
      const j1 = await r1.json();
      console.log('ping:', r1.status, JSON.stringify(j1.data).slice(0, 140));

      const r2 = await fetch(`${base}/api/v1/products/getSeller`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: 'baker' }),
      });
      const j2 = await r2.json();
      console.log('getSeller:', r2.status, '| gallery:', (j2.data?.user?.gallery ?? []).length, 'تصویر');

      const r3 = await fetch(`${base}/api/v1/nonexistent`);
      console.log('404 shape:', r3.status, JSON.stringify(await r3.json()).slice(0, 100));
      process.exit(0);
    } catch (e) {
      console.error('SMOKE FAIL:', e.message);
      process.exit(1);
    }
  });
})().catch((e) => {
  console.error('BOOT FAIL:', e.message);
  process.exit(1);
});
