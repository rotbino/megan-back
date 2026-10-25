import { Connection } from 'mongoose';

/**
 * ایندکس‌های دیتابیس — به‌صورت صریح و idempotent (اجرای مجدد بی‌ضرر است).
 * autoIndex مونگو خاموش است؛ تنها منبع حقیقت ایندکس‌ها همین‌جاست.
 */
const JOBS: Array<{
  collection: string;
  spec: Record<string, 1 | -1>;
  options?: Record<string, unknown>;
}> = [
  // users
  { collection: 'users', spec: { phone: 1 }, options: { unique: true } },
  { collection: 'users', spec: { user_name: 1 }, options: { unique: true, sparse: true } },
  // otp — TTL خودکار + یافتن آخرین کد هر شماره
  { collection: 'otp_codes', spec: { phone: 1, created_at: -1 } },
  { collection: 'otp_codes', spec: { expires_at: 1 }, options: { expireAfterSeconds: 0 } },
  // refresh tokens — TTL خودکار
  { collection: 'refresh_tokens', spec: { token_hash: 1 } },
  { collection: 'refresh_tokens', spec: { expires_at: 1 }, options: { expireAfterSeconds: 0 } },
  // دسته‌ها — فیلتر پرتکرار: فرزندان یک نود به تفکیک نوع با مرتب‌سازی score
  { collection: 'categories', spec: { parent_id: 1, kind: 1, score: -1 } },
  { collection: 'categories', spec: { slug: 1 } },
  // شهرها — فیلتر استانی
  { collection: 'cities', spec: { province_id: 1, city_name: 1 } },
];

export async function ensureIndexes(db: Connection): Promise<void> {
  for (const { collection, spec, options } of JOBS) {
    try {
      await db.collection(collection).createIndex(spec, options ?? {});
    } catch (error) {
      // قابل تکرار بودن: ایندکس یکسان موجود = بدون خطا؛ خطای واقعی فقط لاگ می‌شود
      console.warn(
        `[db-indexes] ${collection} ${JSON.stringify(spec)} → ${(error as Error).message}`,
      );
    }
  }
}
