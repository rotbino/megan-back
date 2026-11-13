/**
 * تست E2E آینهٔ لوکال درایور ابری (خواستهٔ مالک ۱۳-۱۱) — اجرا با bun:
 *
 *   bun scripts/test-storage-mirror.ts
 *
 * «موقع ایمپورت غیر از اینکه تصاویر بصورت آنلاین در ابرآروان ذخیره میشه،
 * در محل ذخیرهٔ کد بک‌اند هم ذخیره بشه در فولدر آپلودز، دقیقاً همون مسیر و
 * همون اسم.» این تست همان درایور واقعی بوت (buildStorage) را با credentials
 * واقعی .env می‌سازد و روی باکت واقعی آروان و دیسک واقعی می‌نویسد/می‌خواند/
 * پاک می‌کند — چیزی را mock نمی‌کند. فلگ واترمارک هم چک می‌شود (از ۱۴-۱۱
 * روشن است — فقط نسخهٔ ابری؛ تست کامل تفکیک: test-watermark-split.ts).
 */
import { existsSync } from 'node:fs';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStorage } from '../src/uploads/storage';
import { storage } from '../src/common/config/env';

const sharp = (await import('sharp')).default;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── ۰. فلگ‌ها ────────────────────────────────────────────────────────────────
console.log('۰) فلگ‌های env:');
check('STORAGE_MIRROR_LOCAL روشن است (پیش‌فرض خواستهٔ ۱۳-۱۱)', storage.MIRROR_LOCAL === true);
check('WATERMARK_ENABLED روشن است (فقط نسخهٔ ابری — خواستهٔ ۱۴-۱۱)', storage.WATERMARK_ENABLED === true);
check('درایور = arvan (تست روی مسیر ابری واقعی)', storage.DRIVER === 'arvan');

// ── ۱. درایور ────────────────────────────────────────────────────────────────
console.log('۱) نوشتن از طریق buildStorage (همان مسیر بوت):');
const driver = buildStorage();
const root = storage.UPLOAD_PATH;
const key = `users/mirror-e2e/test-${Date.now().toString(36)}/probe.jpg`;

// عکس تستی واقعی (گرادیان + نویز سبک) — نه بایت ساختگی
const img = await sharp({
  create: { width: 800, height: 600, channels: 3, background: '#2d6a4f' },
})
  .jpeg({ quality: 90 })
  .toBuffer();

const url = await driver.put(key, img, 'image/jpeg');
check('put برگشت URL آروان (نه localhost)', /^https?:\/\/.+arvanstorage/.test(url), url);

const localPath = join(root, key);
check(`فایل لوکال با همان مسیر/نام ساخته شد (${key})`, existsSync(localPath));
const localBytes = await readFile(localPath).catch(() => null);
check('بایت‌های لوکال دقیقاً همان بایت‌های نوشته‌شده است', Buffer.compare(localBytes ?? Buffer.of(), img) === 0);

const remote = await fetch(url).catch(() => null);
check('آروان همان کلید را عمومی سرو می‌کند (HTTP)', remote?.ok === true, `status=${remote?.status}`);
const remoteBytes = remote ? Buffer.from(await remote.arrayBuffer()) : null;
check('بایت‌های آروان همان است', remoteBytes !== null && Buffer.compare(remoteBytes, img) === 0);

// ── ۲. بازنویسی همان کلید (تعویض درجا) ───────────────────────────────────────
console.log('۲) بازنویسی همان کلید (رفتار «تعویض درجا»):');
const img2 = await sharp({
  create: { width: 640, height: 480, channels: 3, background: '#b08968' },
})
  .jpeg({ quality: 88 })
  .toBuffer();
await driver.put(key, img2, 'image/jpeg', 'public, max-age=3600');
const local2 = await readFile(localPath).catch(() => null);
check('فایل لوکال هم همان لحظه بازنویسی شد', local2 !== null && Buffer.compare(local2, img2) === 0);
const remote2 = await fetch(`${url}?r=${Date.now()}`).catch(() => null);
const remote2Bytes = remote2 ? Buffer.from(await remote2.arrayBuffer()) : null;
check('آروان هم بایت تازه دارد', remote2Bytes !== null && Buffer.compare(remote2Bytes, img2) === 0);

// ── ۳. حذف ──────────────────────────────────────────────────────────────────
console.log('۳) حذف:');
await driver.delete(key);
check('فایل لوکال حذف شد', !existsSync(localPath));
const gone = await fetch(url).catch(() => null);
check('آبجکت آروان هم حذف شد', !gone?.ok, `status=${gone?.status}`);
// پوشهٔ خالی آزمایشی را هم جمع کن
await rm(join(root, 'users/mirror-e2e'), { recursive: true, force: true }).catch(() => undefined);

// ── ۴. خطای آینه آپلود اصلی را نمی‌شکند ─────────────────────────────────────
console.log('۴) سیاست خطا (آینه بهترین‌حال):');
// شبیه‌سازی خطای واقعی دیسک: پوشهٔ مقصد read-only → writeFile با EACCES می‌شکند.
// (نکتهٔ جانبی که همین‌جا ثابت شد: آروان خودش کلید حاوی «..» را با
//  SignatureDoesNotMatch رد می‌کند — کلیدهای واقعی سیستم هرگز چنین نیستند.)
import { chmod } from 'node:fs/promises';
const roDir = join(root, 'users/mirror-e2e-ro/test');
await mkdir(roDir, { recursive: true });
await chmod(roDir, 0o555);
let survived = false;
let badUrl = '';
let warned = false;
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0] ?? '').includes('آینهٔ لوکال')) warned = true;
};
try {
  badUrl = await driver.put('users/mirror-e2e-ro/test/x.jpg', img, 'image/jpeg');
  survived = true;
} catch {
  survived = false;
} finally {
  console.warn = origWarn;
}
check('خطای دیسک آینه، آپلود آروان را نشکست', survived);
check('هشدار آینه لاگ شد (مالک باخبر می‌شود)', warned);
check('URL برگشتی آروان است (نه دیسک)', /^https?:\/\/.+arvanstorage/.test(badUrl), badUrl);
await chmod(roDir, 0o755);
if (survived) await driver.delete('users/mirror-e2e-ro/test/x.jpg').catch(() => undefined);
await rm(join(root, 'users/mirror-e2e-ro'), { recursive: true, force: true }).catch(() => undefined);

console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
process.exit(fail > 0 ? 1 : 0);
