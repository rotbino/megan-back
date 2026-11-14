/**
 * postinstall — فقط روی ورسل اجرا می‌شود (env VERCEL).
 *
 * کارِ اینجا فقط «prisma generate» است: کلاینت Prisma باید قبل از مرحلهٔ
 * build ساخته شود چون tsc به تایپ‌های آن نیاز دارد. خودِ «nest build» لازم
 * نیست — پریست رسمی NestJS ورسل در مرحلهٔ build دستور «npm run build» را
 * اجرا می‌کند (همان nest build).
 *
 * باینری prisma مستقیم از node_modules/.bin صدا زده می‌شود (نه با npx) تا
 * CLI هیچ npm در بیلد ورسل اجرا نشود و هشدار «Unknown env config» نیاید.
 *
 * لوکال: هیچ کاری نمی‌کند — نصب و npm run build مثل قبل سریع می‌ماند.
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

if (!process.env.VERCEL) process.exit(0);

const root = path.resolve(__dirname, '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });

console.log('[vercel-postinstall] prisma generate …');
const prismaBin = path.join('node_modules', '.bin', 'prisma');
run(existsSync(path.join(root, prismaBin)) ? `${prismaBin} generate` : 'npx prisma generate');

console.log('[vercel-postinstall] کلاینت Prisma آماده است ✓');
