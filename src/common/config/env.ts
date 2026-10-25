/**
 * پیکربندی محیط — یک‌بار در بوت لود و اعتبارسنجی می‌شود (fail-fast).
 * dotenv با override چون سندباکس/پلتفرم ممکن است DATABASE_URL پیش‌فرض داشته باشد.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

function required(name: string, value: string | undefined, minLen = 1): string {
  if (!value || value.length < minLen) {
    console.error(`Invalid environment: ${name} is required${minLen > 1 ? ` (min ${minLen} chars)` : ''}`);
    process.exit(1);
  }
  return value;
}

function num(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    console.error(`Invalid environment: ${name} must be a number`);
    process.exit(1);
  }
  return parsed;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export const env = Object.freeze({
  PORT: num('PORT', process.env.PORT, 4000),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: required('DATABASE_URL', process.env.DATABASE_URL),
  JWT_SECRET: required('JWT_SECRET', process.env.JWT_SECRET, 16),
  /** «7d» | «15m» | «3600» — عمر توکن دسترسی */
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REFRESH_TOKEN_TTL_DAYS: num('REFRESH_TOKEN_TTL_DAYS', process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  CORS_ORIGINS: process.env.CORS_ORIGINS || '*',
  SWAGGER_ENABLED: bool(process.env.SWAGGER_ENABLED, true),
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:support@imach.ir',
});

export const isProd = env.NODE_ENV === 'production';
export const isDev = !isProd;

/** «7d» → 604800 (ثانیه) — قالبی که @nestjs/jwt می‌فهمد */
export function jwtExpiresInSeconds(spec = env.JWT_EXPIRES_IN): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(spec.trim());
  if (!match) return 900; // پیش‌فرض امن: ۱۵ دقیقه
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const mult = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86_400 : 1;
  return value * mult;
}

// ─── Storage (files) ─────────────────────────────────────────────────────────
// بایت‌ها روی object storage آروان (سازگار S3) زندگی می‌کنند؛ درایور local برای
// توسعه/خودمیزبانی — سوییچ با یک env، نه بازنویسی.
export const storage = Object.freeze({
  /** «arvan» (S3-compatible) | «local» (دیسک زیر UPLOAD_PATH) */
  DRIVER: process.env.STORAGE_DRIVER || 'arvan',
  MAX_FILE_SIZE: num('MAX_FILE_SIZE', process.env.MAX_FILE_SIZE, 5 * 1024 * 1024),
  /** فقط درایور local */
  UPLOAD_PATH: process.env.UPLOAD_PATH || './uploads',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
  ARVAN_ENDPOINT: process.env.ARVAN_ENDPOINT || '',
  ARVAN_REGION: process.env.ARVAN_REGION || '',
  ARVAN_ACCESS_KEY: process.env.ARVAN_ACCESS_KEY || '',
  ARVAN_SECRET_KEY: process.env.ARVAN_SECRET_KEY || '',
  ARVAN_BUCKET_NAME: process.env.ARVAN_BUCKET_NAME || '',
});

/** فایل‌های staged (relatedId=null) قدیمی‌تر از این — توسط reaper حذف می‌شوند. */
export const FILES_STAGING_TTL_DAYS = num('FILES_STAGING_TTL_DAYS', process.env.FILES_STAGING_TTL_DAYS, 7);
