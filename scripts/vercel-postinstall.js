/**
 * postinstall — فقط روی ورسل اجرا می‌شود (env VERCEL).
 *
 * چرا؟ تابع api/[...path].js از «dist» لود می‌شود (خروجی tsc واقعی با
 * متادیتای دیکوریتورها). در استقرار zero-config ورسل، پیش از باندل‌شدن
 * توابع فقط «npm install» تضمین‌شده اجرا می‌شود — پس dist را همین‌جا
 * می‌سازیم؛ سپس بیلدر api فایل‌های لازم را همراه تابع باندل می‌کند.
 *
 * لوکال: هیچ کاری نمی‌کند — نصب و npm run build مثل قبل سریع می‌ماند.
 */
const { execSync } = require('node:child_process');
const path = require('node:path');

if (!process.env.VERCEL) process.exit(0);

const root = path.resolve(__dirname, '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });

console.log('[vercel-postinstall] prisma generate …');
run('npx prisma generate');

console.log('[vercel-postinstall] nest build (dist برای تابع serverless) …');
run('npx nest build');

console.log('[vercel-postinstall] dist آماده است ✓');
