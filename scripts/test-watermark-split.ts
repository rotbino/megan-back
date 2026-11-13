/**
 * تست E2E سیاست واترمارک دو‌نسخه‌ای (خواستهٔ مالک ۱۴-۱۱) — اجرا با bun:
 *
 *   bun scripts/test-watermark-split.ts
 *
 * «عکسهای آگهی که در ابرآروان ذخیره می کنی رو روشون واتر مارک رو بنداز اما
 * روی تصاویر معادل که در لوکال ذخیره می شن واتر مارک ننداز. می خوام یه سورس
 * بدون واترماک در لوکال داشته باشم که اگر یه موقع واتر مارکت نیاز بشه عوض
 * بشه عکس اصلی رو داشته باشم.»
 *
 * سه لایه را روی اجزای واقعی (سرویس واقعی، درایور بوت واقعی، باکت واقعی
 * آروان و دیسک واقعی) ثابت می‌کند — چیزی را mock نمی‌کند:
 *   ۱. پایپ‌لاین: processFile با واترمارک، دو خروجی می‌دهد؛ mainClean عیناً
 *      همان خروجیِ «بدون واترمارک» است (سورس تمیز، بدون افت نسل).
 *   ۲. مسیریابی درایور: put(key, main, mime, cc, mainClean) → ابر main را
 *      می‌گیرد و دیسک mainClean را.
 *   ۳. پاک‌سازی: حذف هر دو طرف.
 */
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStorage } from '../src/uploads/storage';
import { UploadsService } from '../src/uploads/uploads.service';
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
check('WATERMARK_ENABLED روشن است (خواستهٔ ۱۴-۱۱)', storage.WATERMARK_ENABLED === true);
check('STORAGE_MIRROR_LOCAL روشن است', storage.MIRROR_LOCAL === true);
check('درایور = arvan', storage.DRIVER === 'arvan');

// ── ۱. پایپ‌لاین دو‌نسخه‌ای ──────────────────────────────────────────────────
console.log('۱) processFile — دو نسخه از یک عکس:');
// عکس تستی واقعی (گرادیان + شکل‌ها، ۸۰۰×۶۰۰) — بزرگ‌تر از آستانهٔ واترمارک
const img = await sharp({
  create: { width: 800, height: 600, channels: 3, background: '#264653' },
})
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">` +
          `<circle cx="400" cy="300" r="220" fill="#e9c46a"/>` +
          `<rect x="120" y="120" width="180" height="130" fill="#2a9d8f"/></svg>`,
      ),
    },
  ])
  .jpeg({ quality: 90 })
  .toBuffer();

// سرویس واقعی با dependencyهای دست‌انداز (processFile به prisma/cache دست نمی‌زند)
const svc = new UploadsService(null as never, null as never);
const processFile = (buf: Buffer, mime: string, wm: boolean) =>
  (svc as unknown as { processFile: (b: Buffer, m: string, w: boolean) => Promise<{
    main: Buffer; mainClean: Buffer; thumb: Buffer | null; thumbClean: Buffer | null;
    width: number; height: number; watermarked: boolean; mainMime: string;
  }> }).processFile(buf, mime, wm);

const clean = await processFile(img, 'image/jpeg', false);
const marked = await processFile(img, 'image/jpeg', true);

check('بدون درخواست واترمارک: mainClean همان main است (یک‌نسخه‌ای)', Buffer.compare(clean.mainClean, clean.main) === 0);
check('بدون درخواست واترمارک: watermarked=false', clean.watermarked === false);
check('با درخواست واترمارک: watermarked=true', marked.watermarked === true);
check('با درخواست واترمارک: main با mainClean فرق دارد (لاترمارک در پیکسل‌های ابری است)', Buffer.compare(marked.main, marked.mainClean) !== 0);
check(
  'سورس تمیز = عیناً خروجیِ حالت بدون واترمارک (بدون افت نسل)',
  Buffer.compare(marked.mainClean, clean.main) === 0,
  `اندازه‌ها: ${marked.mainClean.length} در برابر ${clean.main.length}`,
);
check('تامبنیل ابری واترمارک دارد، تامبنیل آینه نه', Buffer.compare(marked.thumb ?? Buffer.of(), marked.thumbClean ?? Buffer.of()) !== 0);
check('تامبنیل تمیز = عیناً تامبنیل حالت بدون واترمارک', Buffer.compare(marked.thumbClean ?? Buffer.of(), clean.thumb ?? Buffer.of()) === 0);

const markedMeta = await sharp(marked.main).metadata();
const cleanMeta = await sharp(marked.mainClean).metadata();
check(
  'ابعاد دو نسخه یکسان است (همان کلید/نمایش)',
  markedMeta.width === cleanMeta.width && markedMeta.height === cleanMeta.height,
  `${markedMeta.width}×${markedMeta.height} در برابر ${cleanMeta.width}×${cleanMeta.height}`,
);
check('ابعاد خروجی همان ورودی مقیاس‌شده است (۸۰۰×۶۰۰)', markedMeta.width === 800 && markedMeta.height === 600);

// مسیر PNG شفاف — لایهٔ واترمارک روی PNG هم می‌نشیند
const png = await sharp({ create: { width: 500, height: 400, channels: 4, background: '#00000000' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><circle cx="250" cy="200" r="160" fill="#e76f51"/></svg>') }])
  .png()
  .toBuffer();
const pngMarked = await processFile(png, 'image/png', true);
check('PNG شفاف هم دو‌نسخه‌ای می‌شود (png ابری / png تمیز)', pngMarked.watermarked === true && Buffer.compare(pngMarked.main, pngMarked.mainClean) !== 0 && pngMarked.mainMime === 'image/png');

// ── ۲. مسیریابی درایور — ابر واترمارک‌دار، دیسک تمیز ─────────────────────────
console.log('۲) MirroredStorage — ابر=واترمارک‌دار، دیسک=تمیز:');
const driver = buildStorage();
const root = storage.UPLOAD_PATH;
const key = `users/wm-split-e2e/test-${Date.now().toString(36)}/probe.jpg`;

const url = await driver.put(key, marked.main, 'image/jpeg', undefined, marked.mainClean);
check('put برگشت URL آروان (نه localhost)', /^https?:\/\/.+arvanstorage/.test(url), url);

const localPath = join(root, key);
check(`فایل لوکال با همان مسیر/نام ساخته شد (${key})`, existsSync(localPath));
const localBytes = await readFile(localPath).catch(() => null);
check('دیسک «نسخهٔ تمیز» را دارد (بدون واترمارک — سورس مالک)', localBytes !== null && Buffer.compare(localBytes, marked.mainClean) === 0);

const remote = await fetch(url).catch(() => null);
check('آروان همان کلید را عمومی سرو می‌کند (HTTP)', remote?.ok === true, `status=${remote?.status}`);
const remoteBytes = remote ? Buffer.from(await remote.arrayBuffer()) : null;
check('ابر «نسخهٔ واترمارک‌دار» را دارد', remoteBytes !== null && Buffer.compare(remoteBytes, marked.main) === 0);
check('بایت‌های ابر و دیسک متفاوت‌اند (تفکیک واقعی، نه کپی همان)', remoteBytes !== null && localBytes !== null && Buffer.compare(remoteBytes, localBytes) !== 0);

// تامبنیل هم همین‌طور
const thumbKey = `${key}.thumb.jpg`;
await driver.put(thumbKey, marked.thumb ?? Buffer.of(), 'image/jpeg', undefined, marked.thumbClean ?? Buffer.of());
const localThumb = await readFile(join(root, thumbKey)).catch(() => null);
check('تامبنیل دیسک تمیز است', localThumb !== null && marked.thumbClean !== null && Buffer.compare(localThumb, marked.thumbClean) === 0);
const remoteThumb = await fetch(url.replace(/[^/]+$/, '') + (thumbKey.split('/').pop() ?? '')).catch(() => null);
const remoteThumbBytes = remoteThumb ? Buffer.from(await remoteThumb.arrayBuffer()) : null;
check('تامبنیل ابری واترمارک‌دار است', remoteThumbBytes !== null && marked.thumb !== null && Buffer.compare(remoteThumbBytes, marked.thumb) === 0);

// ── ۳. پاک‌سازی ──────────────────────────────────────────────────────────────
console.log('۳) پاک‌سازی:');
await driver.delete(key);
await driver.delete(thumbKey).catch(() => undefined);
check('فایل‌های لوکال حذف شدند', !existsSync(localPath) && !existsSync(join(root, thumbKey)));
const gone = await fetch(url).catch(() => null);
check('آبجکت آروان هم حذف شد', !gone?.ok, `status=${gone?.status}`);
await rm(join(root, 'users/wm-split-e2e'), { recursive: true, force: true }).catch(() => undefined);

console.log(`\nنتیجه: ${pass} پاس / ${fail} خطا`);
process.exit(fail > 0 ? 1 : 0);
