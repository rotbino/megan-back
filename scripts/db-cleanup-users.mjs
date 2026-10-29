#!/usr/bin/env node
/**
 * پاک‌سازی دیتابیس برای تست دستی — نگه‌داشتن فقط کاربر ادمین:
 *   node scripts/db-cleanup-users.mjs 09196421264
 *
 * حذف: همه کاربران غیر ادمین + تمام داده‌های وابسته‌شان
 * (آگهی، درخواست خرید، نظرات، نظرسنجی، چت، تماس، نشان‌شده‌ها،
 *  کیف پول، احراز هویت، فایل‌ها + بایت‌های آروان، توکن‌ها).
 * داده‌های خود ادمین (آگهی/فایل/پیام‌های دریافتی) دست‌نخورده می‌ماند.
 */
import { readFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';

const ADMIN_PHONE = process.argv[2] || '09196421264';
if (!/^09\d{9}$/.test(ADMIN_PHONE)) {
  console.error('استفاده: node scripts/db-cleanup-users.mjs 09xxxxxxxxx');
  process.exit(1);
}

// ── env خام (الگوی make-admin.mjs) + درایور ذخیره‌سازی آروان ──
const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
// DATABASE_URL همیشه از .env — متغیر shell سندباکس (sqlite) override نکند
const DB_URL = envText.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1];
if (!DB_URL || !DB_URL.startsWith('mongodb')) {
  console.error('DATABASE_URL معتبر در .env یافت نشد');
  process.exit(1);
}

const { buildStorage } = await import(new URL('../dist/uploads/storage.js', import.meta.url).href);
const storage = buildStorage();

const client = new MongoClient(DB_URL);
await client.connect();
const db = client.db();

const summary = {};
const count = async (coll, filter) => db.collection(coll).countDocuments(filter);

// ── ۱. ادمین و سایر کاربران ──
const admin = await db.collection('User').findOne({ phone: ADMIN_PHONE });
if (!admin) {
  console.error(`کاربر ادمین ${ADMIN_PHONE} یافت نشد — خروج بدون تغییر.`);
  process.exit(1);
}
const adminId = admin._id;
const nonAdminUsers = await db.collection('User').find({ _id: { $ne: adminId } }).toArray();
const nonAdminIds = nonAdminUsers.map((u) => u._id);
const inNonAdmin = { $in: nonAdminIds };
console.log(`ادمین نگه‌داشته‌شده: ${ADMIN_PHONE} (${admin.first_name ?? ''} ${admin.last_name ?? ''})`);
console.log(`کاربران قابل حذف: ${nonAdminIds.length}`);
if (nonAdminIds.length === 0) {
  console.log('چیزی برای حذف نیست — دیتابیس از قبل فقط ادمین دارد.');
  await client.close();
  process.exit(0);
}

// ── ۲. مکالمات: هر تردی که یک طرفش غیر ادمین است ──
const doomedThreads = await db
  .collection('ChatThread')
  .find({ $or: [{ seller_id: inNonAdmin }, { buyer_id: inNonAdmin }] })
  .toArray();
const threadIds = { $in: doomedThreads.map((t) => t._id) };
summary['پیام‌های چت'] = await db.collection('ChatMessage').deleteMany({ thread_id: threadIds }).then((r) => r.deletedCount);
summary['مکالمات'] = await db.collection('ChatThread').deleteMany({ _id: threadIds }).then((r) => r.deletedCount);

// ── ۳. نظرات و نظرسنجی‌ها ──
summary['نظرات فروشندگان'] = await db
  .collection('SellerReview')
  .deleteMany({ $or: [{ author_id: inNonAdmin }, { seller_id: inNonAdmin }] })
  .then((r) => r.deletedCount);
summary['پاسخ‌های نظرسنجی'] = await db
  .collection('SurveyResponse')
  .deleteMany({ user_id: inNonAdmin })
  .then((r) => r.deletedCount);

// ── ۴. گزارش تماس + پیام‌های ادمین به کاربران ──
summary['گزارش تماس'] = await db
  .collection('CallLog')
  .deleteMany({ $or: [{ caller_id: inNonAdmin }, { callee_id: inNonAdmin }] })
  .then((r) => r.deletedCount);
summary['پیام‌های ادمین→کاربر'] = await db
  .collection('AdminMessage')
  .deleteMany({ user_id: inNonAdmin })
  .then((r) => r.deletedCount);

// ── ۵. نشان‌شده‌ها (لیست + خریداران نشان‌شده + یادداشت‌ها) ──
const doomedLists = await db.collection('SavedList').find({ user_id: inNonAdmin }).toArray();
const savedUserFilter = {
  $or: [{ saved_list_id: { $in: doomedLists.map((l) => l._id) } }, { target_user_id: inNonAdmin }],
};
const doomedSavedUsers = await db.collection('SavedUser').find(savedUserFilter).toArray();
summary['یادداشت‌های CRM'] = await db
  .collection('SavedUserNote')
  .deleteMany({ saved_user_id: { $in: doomedSavedUsers.map((s) => s._id) } })
  .then((r) => r.deletedCount);
summary['خریداران نشان‌شده'] = await db.collection('SavedUser').deleteMany(savedUserFilter).then((r) => r.deletedCount);
summary['لیست‌های نشان‌شده'] = await db.collection('SavedList').deleteMany({ _id: { $in: doomedLists.map((l) => l._id) } }).then((r) => r.deletedCount);

// ── ۶. آگهی‌های غیر ادمین + وابسته‌ها (نردبان) ──
const doomedProducts = await db.collection('Product').find({ user_id: inNonAdmin }).toArray();
const productIds = doomedProducts.map((p) => p.id); // Int id
summary['سفارش‌های نردبان'] = await db
  .collection('LadderOrder')
  .deleteMany({ $or: [{ user_id: inNonAdmin }, ...(productIds.length ? [{ product_id: { $in: productIds } }] : [])] })
  .then((r) => r.deletedCount);
summary['آگهی‌ها'] = await db.collection('Product').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);

// ── ۷. درخواست‌های خرید ──
summary['درخواست‌های خرید'] = await db.collection('BuyRequest').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);

// ── ۸. سفارش‌های احراز/شارژ + تنظیمات کیف پول + پوش + توکن‌ها ──
const doomedVerifications = await db.collection('VerificationOrder').find({ user_id: inNonAdmin }).toArray();
const doomedCharges = await db.collection('ChargeOrder').find({ user_id: inNonAdmin }).toArray();
summary['سفارش‌های احراز هویت'] = await db.collection('VerificationOrder').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);
summary['سفارش‌های شارژ'] = await db.collection('ChargeOrder').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);
summary['تنظیمات کیف پول'] = await db.collection('WalletAdjustment').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);
summary['اشتراک‌های پوش'] = await db.collection('PushSubscription').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);
summary['رفرش‌توکن‌ها'] = await db.collection('RefreshToken').deleteMany({ user_id: inNonAdmin }).then((r) => r.deletedCount);

// ── ۹. فایل‌ها — ردیف‌ها + بایت‌های آروان ──
const fileFilter = {
  $or: [
    { owner_id: inNonAdmin },
    ...(productIds.length ? [{ related_model: 'Product', related_id: { $in: productIds.map(String) } }] : []),
    ...(doomedVerifications.length ? [{ related_model: 'Verification', related_id: { $in: doomedVerifications.map((v) => String(v._id)) } }] : []),
    ...(doomedCharges.length ? [{ related_model: 'ChargeOrder', related_id: { $in: doomedCharges.map((c) => String(c._id)) } }] : []),
  ],
};
const doomedFiles = await db.collection('File').find(fileFilter).toArray();
let storageDeleted = 0;
let storageFailed = 0;
for (const f of doomedFiles) {
  for (const key of [f.storage_key, f.thumb_storage_key]) {
    if (!key) continue;
    try {
      await storage.delete(key);
      storageDeleted++;
    } catch {
      storageFailed++; // بهترین‌حال — ردیف مهم‌تر از بایت ریموت است
    }
  }
}
summary['فایل‌ها (ردیف)'] = await db.collection('File').deleteMany(fileFilter).then((r) => r.deletedCount);
summary['بایت‌های آروان حذف‌شده'] = storageDeleted;
if (storageFailed > 0) summary['بایت‌های ناموفق (یتیم)'] = storageFailed;

// ── ۱۰. خود کاربران ──
summary['کاربران'] = await db.collection('User').deleteMany({ _id: inNonAdmin }).then((r) => r.deletedCount);

// ── گزارش ──
console.log('\n─── پاک‌سازی انجام شد ───');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);

// صحت‌سنجی نهایی — هیچ ردیف یتیمی نمانده باشد
const checks = [
  ['ChatThread', { $or: [{ seller_id: { $exists: true } }] }],
];
const leftover = {
  threads: await count('ChatThread', { $or: [{ seller_id: { $nin: [adminId] } }, { buyer_id: { $nin: [adminId] } }] }),
  reviews: await count('SellerReview', { $or: [{ author_id: { $ne: adminId } }, { seller_id: { $ne: adminId } }] }),
  products: await count('Product', { user_id: { $ne: adminId } }),
  users: await count('User', { _id: { $ne: adminId } }),
};
console.log('\n─── باقیمانده (باید همه ۰ باشند) ───');
for (const [k, v] of Object.entries(leftover)) console.log(`  ${k}: ${v}`);

await client.close();
console.log('\n✅ دیتابیس آماده تست دستی است — فقط ادمین باقی است.');
