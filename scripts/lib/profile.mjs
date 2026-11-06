#!/usr/bin/env node
/**
 * پروفایل اجرا (APP_PROFILE) برای اسکریپت‌ها — همان منطق src/common/config/env.ts.
 *
 *   APP_PROFILE=local → DATABASE_URL مؤثر = LOCAL_DATABASE_URL یا مونگوی لوکال
 *                        (آدرس Atlas در .env نادیده گرفته می‌شود)
 *   APP_PROFILE=cloud (پیش‌فرض) → DATABASE_URL همان مقدار .env
 *
 * چرا لازم است؟ Prisma (env("DATABASE_URL")) و درایور mongodb مقدار را
 * مستقیم از process.env می‌خوانند — نه از آبجکت‌های env برنامه. پس سوییچ
 * پروفایل باید مقدار مؤثر را روی process.env.DATABASE_URL هم بنویسد؛
 * در پروفایل cloud مقدار یکسان است و نوشتنش بی‌اثر و بی‌خطر.
 *
 * استفاده:
 *   import { applyProfile, effectiveDbUrl } from './lib/profile.mjs';
 *   dotenv.config({ path: '.env', override: true });
 *   applyProfile();                       // ← بعد از dotenv
 *   // یا برای اسکریپت‌های بدون dotenv:
 *   const url = effectiveDbUrl();
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** خواندن سادهٔ .env در map — اولین تعریف ملاک است (بدون interpolate) */
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

/** آدرس مؤثر دیتابیس با احترام به APP_PROFILE — .env بر process.env اولویت دارد */
export function effectiveDbUrl(envFile = join(root, '.env')) {
  const file = readEnvFile(envFile);
  const pick = (key) => (key in file ? file[key] : process.env[key]);
  if (pick('APP_PROFILE') === 'local') {
    return pick('LOCAL_DATABASE_URL') || 'mongodb://127.0.0.1:27017/megan_local';
  }
  return pick('DATABASE_URL') || '';
}

/** بعد از dotenv.config صدا بزنید — مقدار مؤثر را روی process.env.DATABASE_URL می‌نویسد */
export function applyProfile(envFile) {
  const url = effectiveDbUrl(envFile);
  if (url) process.env.DATABASE_URL = url;
  return url;
}
