// پاک‌سازی کامل دیتابیس برای شروع تازه (فقط مجموعه‌ها را drop می‌کند)
// استفاده: node scripts/db-drop-all.mjs [--yes]
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { MongoClient } from 'mongodb';

const DRY = !process.argv.includes('--yes');

const client = new MongoClient(process.env.DATABASE_URL, {
  serverSelectionTimeoutMS: 15000,
});

const KEEP_SAFE = new Set(['system.', 'admin', 'local']); // مجموعه‌های سیستمی

try {
  await client.connect();
  const db = client.db();
  const collections = await db.listCollections().toArray();
  const names = collections.map((c) => c.name).filter((n) => !KEEP_SAFE.has(n));
  if (names.length === 0) {
    console.log('دیتابیس خالی است — چیزی برای حذف نیست.');
  }
  for (const name of names) {
    if (DRY) {
      console.log(`[dry-run] drop: ${name}`);
    } else {
      await db.collection(name).drop();
      console.log(`dropped: ${name}`);
    }
  }
  if (!DRY) console.log(`✅ ${names.length} مجموعه حذف شد — دیتابیس تمیز.`);
} finally {
  await client.close();
}
