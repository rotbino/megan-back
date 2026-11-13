#!/usr/bin/env node
/**
 * پاک‌سازی پوشه‌های خالیِ آینهٔ لوکال (رفع پای‌های باگ ذخیره‌سازی ۱۴-۱۱).
 *
 * پیش از کامیت «dirname به‌جای محاسبهٔ دستی والد»، LocalStorage.put مسیر والد
 * را با «تا آخرین /» می‌ساخت؛ روی ویندوز (جداکنندهٔ \) این یعنی lastIndexOf('/')
 * = ‎-۱ و slice(0, -1) → برای «هر» فایل یک پوشهٔ خالی هم‌نامِ فایلِ منهای حرف
 * آخر ساخته می‌شد (X.jpg → پوشهٔ X.jp، X.jpg.thumb.jpg → X.jpg.thumb.jp).
 * خود فایل‌ها سالم‌اند؛ فقط این پوشه‌های زائد روی دیسک مانده‌اند.
 *
 * این اسکریپت «همهٔ» پوشه‌های خالی زیر UPLOAD_PATH را بازگشتی (از عمیق‌ترین
 * به بالا) حذف می‌کند — چون هر پوشهٔ واقعی این درخت در لحظهٔ نیاز توسط put()
 * دوباره ساخته می‌شود، حذف پوشهٔ خالی همیشه بی‌خطر است. به دیتابیس دست نمی‌زند.
 *
 *   node scripts/mirror-cleanup-empty-dirs.mjs --dry     # فقط گزارش
 *   node scripts/mirror-cleanup-empty-dirs.mjs           # حذف واقعی
 */
import { existsSync, readFileSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DRY = process.argv.includes('--dry');

// ── فقط UPLOAD_PATH لازم است (همان خوانندهٔ .env بقیهٔ اسکریپت‌ها) ──────────
function readEnvFile(path) {
  const map = {};
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in map)) map[m[1]] = v;
  }
  return map;
}
const envMap = readEnvFile(join(root, '.env'));
const UPLOAD_PATH = envMap.UPLOAD_PATH || './uploads';
const target = join(root, UPLOAD_PATH);

if (!existsSync(target)) {
  console.error(`پوشهٔ آپلود پیدا نشد: ${target}`);
  process.exit(1);
}

let removed = 0;
const removedList = [];

/** پس‌مرتب (post-order): اول فرزندان، بعد خودِ پوشه اگر خالی شد */
function clean(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) clean(join(dir, entry.name));
  }
  if (dir === target) return; // خودِ ریشه نمانَد حذف شود
  if (readdirSync(dir).length === 0) {
    removedList.push(dir);
    if (!DRY) rmdirSync(dir);
    removed++;
  }
}

clean(target);

console.log(`${DRY ? '[خشک] ' : ''}${removed} پوشهٔ خالی ${DRY ? 'پیدا شد' : 'حذف شد'} زیر ${target}`);
if (removedList.length <= 50) {
  for (const d of removedList) console.log(`  ${DRY ? '·' : '✓'} ${d}`);
} else {
  for (const d of removedList.slice(0, 20)) console.log(`  ${DRY ? '·' : '✓'} ${d}`);
  console.log(`  … و ${removedList.length - 20} مورد دیگر`);
}
