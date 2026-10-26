#!/usr/bin/env node
/**
 * prisma db push — کراس‌پلتفرم (ویندوز PowerShell / لینوکس / مک).
 *
 * چرا این اسکریپت؟
 *  1. override صریح DATABASE_URL از .env — برخی محیط‌ها (سندباکس/CI) از قبل
 *     DATABASE_URL در env دارند و Prisma مقدار env واقعی را بر .env ترجیح می‌دهد.
 *  2. اجرای مستقیم انتری CLI پرایسما با node — بدون npx/shell تا روی ویندوز هم
 *     بدون دردسر کار کند (اسکریپت قبلی bash بود و روی ویندوز اجرا نمی‌شد).
 *
 * اجرا: npm run db:push            (معادل prisma db push)
 *       npm run db:push -- --accept-data-loss
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), override: true });

if (!process.env.DATABASE_URL) {
  console.error('✖ DATABASE_URL در .env تعریف نشده است');
  process.exit(1);
}

// انتری CLI پرایسما (node_modules/prisma/build/index.js) — مستقیم با node
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
if (!existsSync(prismaCli)) {
  console.error('✖ prisma نصب نیست — اول وابستگی‌ها را نصب کنید: npm install');
  process.exit(1);
}

const args = ['db', 'push', ...process.argv.slice(2)];
const res = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
});
process.exit(res.status ?? 1);
