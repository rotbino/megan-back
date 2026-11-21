#!/usr/bin/env node
/**
 * بازسازی ایندکس‌های گم‌شده (۲۲-۱۱): تلاش prisma db push برای مدل جدید
 * PendingImportUser روی drift شناخته‌شدهٔ User_referral_code_key (nullهای
 * تکراری — از قبل از تسک ۲۸) افتاد؛ اما پیش از خطا، سه ایندکس قدیمیِ
 * بدون نامِ Prisma را انداخته بود:
 *   • File_wm_review_queue_idx (صف بررسی واترمارک — scripts/create-wm-queue-index.mjs)
 *   • user_id_status_idx / user_id_created_at_idx روی WebImportSession
 * این اسکریپت همهٔ ایندکس‌هایی را که اسکیما انتظار دارد ولی روی Atlas
 * نیستند می‌سازد (idempotent) — به‌جز referral_code که با دادهٔ فعلی ممکن نیست.
 * اجرا: node scripts/restore-indexes.mjs
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const root = new URL('../', import.meta.url).pathname;
dotenv.config({ path: `${root}.env`, override: true });

const client = new MongoClient(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db();

/** [کالکشن, نام, کلید, گزینه‌ها] — دقیقاً همان چیزی که اسکیما می‌خواهد */
const WANTED = [
  // ── بازسازی قربانیان این db push ──
  ['File', 'File_wm_review_queue_idx', { related_model: 1, field_key: 1, watermark_fixed_at: 1, watermark_reviewed_at: 1, has_watermark: 1, related_id: 1 }, {}],
  ['WebImportSession', 'WebImportSession_user_id_status_idx', { user_id: 1, status: 1 }, {}],
  ['WebImportSession', 'WebImportSession_user_id_created_at_idx', { user_id: 1, created_at: -1 }, {}],
  // ── ایندکس‌هایی که push قصد ساختشان را داشت و نرسید ──
  ['User', 'User_import_source_idx', { import_source: 1 }, {}],
  ['User', 'User_referred_by_id_idx', { referred_by_id: 1 }, {}],
  ['AffiliateProfile', 'AffiliateProfile_myuser_id_key', { myuser_id: 1 }, { unique: true }],
  ['AffiliateProfile', 'AffiliateProfile_parent_manager_id_idx', { parent_manager_id: 1 }, {}],
  ['AffiliateProfile', 'AffiliateProfile_role_is_active_idx', { role: 1, is_active: 1 }, {}],
  ['AffiliateEarning', 'AffiliateEarning_affiliate_id_created_at_idx', { affiliate_id: 1, created_at: -1 }, {}],
  ['AffiliateEarning', 'AffiliateEarning_payer_id_idx', { payer_id: 1 }, {}],
  ['AffiliateMessage', 'AffiliateMessage_affiliate_id_created_at_idx', { affiliate_id: 1, created_at: -1 }, {}],
];

let created = 0;
let skipped = 0;
for (const [col, name, key, opts] of WANTED) {
  const existing = await db.collection(col).listIndexes().toArray().catch(() => []);
  if (existing.some((i) => i.name === name)) {
    console.log(`• ${col}.${name} از قبل هست`);
    skipped++;
    continue;
  }
  try {
    await db.collection(col).createIndex(key, { name, ...opts });
    console.log(`✓ ${col}.${name} ساخته شد${opts.unique ? ' (unique)' : ''}`);
    created++;
  } catch (e) {
    console.error(`✖ ${col}.${name}: ${String(e.code ?? '')} ${e.message?.slice(0, 120)}`);
  }
}
console.log(`\nجمع: ${created} ساخته شد، ${skipped} از قبل بود`);
await client.close();
