/**
 * باندل serverless با esbuild — چرا؟
 *
 * NestJS 12 فقط ESM است ("type": "module"). خروجی tsc ما CJS است و
 * require('@nestjs/core') روی ران‌تایم ورسل (Node 22 + لودر اختصاصی) خطای
 * ERR_REQUIRE_ESM می‌دهد — همان کرش خام FUNCTION_INVOCATION_FAILED.
 * esbuild کل گراف (کد ما + نست + فستیفای و…) را با interop در «یک فایل
 * CJS» درهم می‌بافد؛ در ران‌تایم فقط requireهای CJS باقی می‌مانند.
 *
 * فقط ماژول‌های بومی/تولیدشده external می‌مانند (هر دو CJS‌اند و nft
 * خودشان را همراه تابع trace می‌کند):
 *   - sharp (باینری بومی)
 *   - @prisma/client (کلاینت تولیدی + موتور کوئری)
 *   - @aws-sdk/client-s3 (کشف پلاگین پویا دارد)
 *
 * ورودی dist است (نه src) — یعنی متادیتای دیکوریتورها از قبل با tsc
 * سالم منتشر شده و esbuild فقط JS را باز‌بسته‌بندی می‌کند.
 */
const { build } = require('esbuild');
const { rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outdir = path.join(root, '.serverless');

rmSync(outdir, { recursive: true, force: true });

build({
  entryPoints: [path.join(root, 'dist/serverless-app.js')],
  outfile: path.join(outdir, 'serverless-bundle.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node22'],
  sourcemap: false,
  minify: false, // خوانایی لاگ‌های خطای ران‌تایم مهم‌تر از حجم است
  // بومی/تولیدشده + پکیج‌های اختیاری نست که نصب نیستند (importهای تنبلِ
  // آن‌ها فقط با استفاده از همان فیچر اجرا می‌شوند — microservices،
  // اداپتر express و درگاه‌های وب‌سوکتِ @nestjs/websockets که نداریم)
  external: [
    'sharp',
    '@prisma/client',
    '@aws-sdk/client-s3',
    '@nestjs/microservices',
    '@nestjs/platform-express',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    '@fastify/view',
  ],
  // در باندل CJS، import.meta.url تعریف ندارد (مثلاً @nestjs/swagger موقع
  // لود createRequire(import.meta.url) می‌زند) — با __filename واقعی جایگزین
  // می‌شود تا مسیرهای تنبلِ swagger-ui درست‌کار بمانند. (مقدار define فقط
  // identifier می‌پذیرد، پس عبارت در banner ساخته می‌شود.)
  banner: {
    js: 'const __megan_import_meta_url__ = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__megan_import_meta_url__',
  },
  logLevel: 'info',
}).then(() => {
  console.log('[bundle-serverless] باندل CJS آماده است ✓');
});
