#!/usr/bin/env node
/**
 * بکاپ MongoDB (Atlas) — B11 سخت‌سازی
 *
 *   node scripts/backup.mjs [--keep=14] [--out=./backups]
 *
 * پیش‌نیاز: mongodump از MongoDB Database Tools روی PATH
 *   https://www.mongodb.com/try/download/database-tools
 *
 * خروجی: backups/megan-YYYYMMDD-HHmmss.archive.gz (آرشیو فشرده تک‌فایل)
 * نگهداری: به‌طور پیش‌فرض ۱۴ نسخه آخر می‌ماند؛ قدیمی‌ها حذف می‌شوند.
 *
 * کرون پیشنهادی (هر شب ۳:۳۰):
 *   30 3 * * * cd /srv/megan-back && node scripts/backup.mjs >> backups/backup.log 2>&1
 *
 * بازیابی:
 *   mongorestore --uri="$DATABASE_URL" --archive --gzip < backups/megan-….archive.gz
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', override: true });

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const KEEP = Number(arg('keep', 14)) || 14;
const OUT_DIR = resolve(arg('out', './backups'));
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('✗ DATABASE_URL در .env تنظیم نشده است.');
  process.exit(1);
}

// mongodump موجود؟ (بدون آن اسکریپت بلااستفاده است — پیام روشن به‌جای stacktrace)
try {
  execFileSync('command', ['-v', 'mongodump'], { stdio: 'ignore' });
} catch {
  console.error(
    '✗ mongodump پیدا نشد. MongoDB Database Tools را نصب کنید:\n' +
      '  https://www.mongodb.com/try/download/database-tools\n' +
      '(دبیان/اوبونتو: mongodb-database-tools_*.deb — سپس دوباره اجرا کنید)',
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);
const file = join(OUT_DIR, `megan-${stamp}.archive.gz`);

console.log(`▸ بکاپ → ${file}`);
try {
  execFileSync(
    'mongodump',
    [`--uri=${DB_URL}`, `--archive=${file}`, '--gzip', '--quiet'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
} catch (err) {
  console.error('✗ بکاپ ناموفق بود:', err.message);
  process.exit(1);
}

if (!existsSync(file) || statSync(file).size === 0) {
  console.error('✗ فایل بکاپ ساخته نشد یا خالی است.');
  process.exit(1);
}

// حذف نسخه‌های قدیمی‌تر از KEEP (نام‌ها timestamp مرتب دارند)
const archives = readdirSync(OUT_DIR)
  .filter((f) => /^megan-.*\.archive\.gz$/.test(f))
  .sort()
  .reverse();
for (const old of archives.slice(KEEP)) {
  unlinkSync(join(OUT_DIR, old));
  console.log(`▸ حذف نسخه قدیمی: ${old}`);
}

console.log(`✓ بکاپ کامل — ${archives.length} نسخه در ${OUT_DIR}`);
