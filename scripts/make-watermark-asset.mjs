/**
 * رندر PNG واترمارک از منبع SVG — یک‌بار برای همیشه (خواسته مالک ۸-۱۱ دور ۲۷).
 *
 *   node scripts/make-watermark-asset.mjs
 *
 * چرا PNG و نه SVG در زمان اجرا؟
 *   • <text> لوگو به فونت سیستم میزبان وابسته است (Verdana در سرور لینوکسی
 *     نیست) — رندر یک‌بار در همین اسکریپت با DejaVu Sans Bold نتیجه را قفل
 *     می‌کند و سرورِ هر محیطی همان پیکسل‌ها را می‌بیند.
 *   • feGaussianBlur (هاله) هم توسط librsvg هر محیط ممکن است متفاوت رندر
 *     شود — PNG نهایی این ریسک را حذف می‌کند.
 *   • در زمان اجرا فقط resize + composite سبک اتفاق می‌افتد — سریع و قطعی.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');
const sharp = (await import('sharp')).default;

const svg = await readFile(join(assets, 'watermark-tile.svg'));
const png = await sharp(svg, { density: 216 }) // 3x of 72dpi → 354×150
  .png()
  .toBuffer();

await writeFile(join(assets, 'watermark-tile.png'), png);
const meta = await sharp(png).metadata();
console.log(`✓ assets/watermark-tile.png → ${meta.width}×${meta.height} (${png.length} bytes)`);
