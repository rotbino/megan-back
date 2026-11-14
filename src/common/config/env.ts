/**
 * پیکربندی محیط — یک‌بار در بوت لود و اعتبارسنجی می‌شود (fail-fast).
 * dotenv با override چون سندباکس/پلتفرم ممکن است DATABASE_URL پیش‌فرض داشته باشد.
 *
 * روی ورسل (سرورلس) فایل .env اصلاً لود نمی‌شود: متغیرهای ست‌شده در پنل
 * ورسل منبع حقیقت‌اند. اگر .env همراه باندل تابع بیاید و با override لود
 * شود، PORT پلتفرم را با PORT=4000 لوکال له می‌کند و تابع روی پورت اشتباه
 * listen می‌کند (FUNCTION_INVOCATION_FAILED).
 */
import dotenv from 'dotenv';
// تشخیص موقت ورسل — حذف خواهد شد
import { beacon } from '../../vercel-boot-diag';
const isVercel = !!process.env.VERCEL;
if (!isVercel) dotenv.config({ path: '.env', override: true });

/** متغیرهای الزامی غایب — همه با هم جمع و یک‌بار گزارش می‌شوند */
const missingRequired: string[] = [];

function required(name: string, value: string | undefined, minLen = 1): string {
  if (!value || value.length < minLen) {
    missingRequired.push(name + (minLen > 1 ? ` (حداقل ${minLen} نویسه)` : ''));
    return '' as string;
  }
  return value;
}

function exitIfMissing(): void {
  if (!missingRequired.length) return;
  console.error('مگان: متغیرهای محیطی الزامی ست نشده‌اند:');
  for (const item of missingRequired) console.error(`  - ${item}`);
  if (isVercel) {
    console.error(
      'در ورسل این‌ها را در Settings → Environment Variables ست کنید (برای Production و Preview) و Redeploy بگیرید.',
    );
  } else {
    console.error('مقادیر را در فایل .env پروژه ست کنید.');
  }
  // تشخیص موقت: گزارش بیکن، سپس خروج (بیکن روی ورسل فعال است)
  void beacon('missing-env', { list: [...missingRequired] })
    .catch(() => {})
    .finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000); // ضربه‌گیر اگر بیکن گیر کند
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

/**
 * پروفایل اجرا — «کلید واحد» سوییچ لوکال/ابر (خواسته مالک: کار آفلاین):
 *   APP_PROFILE=local → دیتابیس مونگوی لوکال + ذخیرهٔ فایل روی دیسک ./uploads
 *                        (آدرس Atlas و کلیدهای آروان در .env نادیده گرفته می‌شوند)
 *   APP_PROFILE=cloud → رفتار کامل امروز: Atlas + آروان (پیش‌فرض)
 * مقادیر جایگزین لوکال با LOCAL_* قابل تنظیم‌اند؛ برای جزئیات docs/LOCAL-DEV.md.
 */
export type AppProfile = 'local' | 'cloud';
export const profile: AppProfile = process.env.APP_PROFILE === 'local' ? 'local' : 'cloud';
export const isLocalProfile = profile === 'local';

/** در پروفایل local، DATABASE_URL ابری نادیده گرفته می‌شود و مونگوی لوکال وصل می‌شود */
function resolveDatabaseUrl(): string {
  if (isLocalProfile) {
    //LOCAL_DATABASE_URL اگر ست شده باشد همان می‌آید؛ وگرنه پیش‌فرض استاندارد لوکال
    return process.env.LOCAL_DATABASE_URL || 'mongodb://127.0.0.1:27017/megan_local';
  }
  return required('DATABASE_URL', process.env.DATABASE_URL);
}

const DATABASE_URL = resolveDatabaseUrl();
// مهم: Prisma از env("DATABASE_URL") مستقیمِِ process.env می‌خواند، نه از این
// آبجکت — مقدار مؤثر را برمی‌گردانیم تا سوییچ پروفایل به کلاینت Prisma هم
// برسد (در پروفایل cloud مقدار یکسان است و نوشتنش بی‌اثر است).
process.env.DATABASE_URL = DATABASE_URL;

export const env = Object.freeze({
  PORT: num('PORT', process.env.PORT, 4000),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL,
  JWT_SECRET: required('JWT_SECRET', process.env.JWT_SECRET, 16),
  /** «7d» | «15m» | «3600» — عمر توکن دسترسی */
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REFRESH_TOKEN_TTL_DAYS: num('REFRESH_TOKEN_TTL_DAYS', process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  CORS_ORIGINS: process.env.CORS_ORIGINS || '*',
  // سندباکس/توسعه روشن؛ در پروداکشن به‌جز با opt-in صریح خاموش (B11)
  SWAGGER_ENABLED: bool(process.env.SWAGGER_ENABLED, process.env.NODE_ENV !== 'production'),
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:support@imach.ir',
});

// بعد از ارزیابی کل آبجکت env — همهٔ required()ها اجرا شده‌اند؛ حالا اگر
// چیزی غایب بود با یک پیام جمع‌بندی‌شده خارج می‌شویم (نه اولین مورد).
exitIfMissing();

/**
 * کد ثابت OTP — تا وقتی پنل پیامکی نداریم (خواسته مالک: «فعلا کد 1234»).
 * مقدار غیرخالی → همیشه همان کد صادر می‌شود؛ با رسیدن پنل پیامک، این کلید را
 * از .env خالی/حذف کنید تا کد تصادفی ۴ رقمی واقعی صادر شود. هیچ جریان دیگری عوض نمی‌شود.
 */
export const OTP_FIXED_CODE = (process.env.OTP_FIXED_CODE || '').trim();

// ─── پنل ادمین (فاز A1 — جدایی کامل از احراز کاربر عادی) ────────────────────
export const adminEnv = Object.freeze({
  /** راز JWT ادمین — جدا از کاربران؛ خالی → از JWT_SECRET مشتق می‌شود */
  JWT_SECRET: process.env.ADMIN_JWT_SECRET || '',
  /** عمر توکن ادمین — کوتاه؛ بدون refresh، انقضا = ورود مجدد */
  JWT_EXPIRES_IN: process.env.ADMIN_JWT_EXPIRES_IN || '12h',
  /** بوت‌استرپ ادمین پیش‌فرض — فقط اگر وجود نداشته باشد ساخته می‌شود.
   * رمز اولیه فقط از env می‌آید؛ اگر ست نشده بود رمز تصادفی قوی تولید و
   * یک‌بار در لاگ بوت چاپ می‌شود. هیچ رمز پیش‌فرضی در کد نیست (رفع باگ ۴). */
  DEFAULT_USERNAME: process.env.ADMIN_DEFAULT_USERNAME || '',
  DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || '',
});

/** راز مؤثر JWT ادمین — جدا از راز کاربران (حتی بدون env صریح) */
export function adminJwtSecret(): string {
  return adminEnv.JWT_SECRET || `${env.JWT_SECRET}:admin-scope`;
}

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
  /** «arvan» (S3-compatible) | «local» (دیسک زیر UPLOAD_PATH)
 *  پروفایل local درایور را به «local» مجبور می‌کند (سوییچ آفلاین). */
  DRIVER: (() => {
    // روی ورسل دیسک تابع readonly است — درایور local هم آپلود را می‌شکست هم
    // سرو فایل را؛ اگر خواسته شده باشد با هشدار نادیده گرفته می‌شود.
    const wanted = isLocalProfile ? 'local' : process.env.STORAGE_DRIVER || 'arvan';
    if (isVercel && wanted === 'local') {
      console.warn('مگان: STORAGE_DRIVER=local روی ورسل پشتیبانی نمی‌شود (دیسک readonly) — درایور arvan اعمال شد.');
      return 'arvan';
    }
    return wanted;
  })(),
  MAX_FILE_SIZE: num('MAX_FILE_SIZE', process.env.MAX_FILE_SIZE, 5 * 1024 * 1024),
  /** فقط درایور local */
  UPLOAD_PATH: process.env.UPLOAD_PATH || './uploads',
  /** پروفایل local: مبدأ خود API کافی است؛ قابل تغییر با LOCAL_PUBLIC_BASE_URL */
  PUBLIC_BASE_URL: isLocalProfile
    ? process.env.LOCAL_PUBLIC_BASE_URL || `http://localhost:${env.PORT}`
    : process.env.PUBLIC_BASE_URL || '',
  ARVAN_ENDPOINT: process.env.ARVAN_ENDPOINT || '',
  ARVAN_REGION: process.env.ARVAN_REGION || '',
  ARVAN_ACCESS_KEY: process.env.ARVAN_ACCESS_KEY || '',
  ARVAN_SECRET_KEY: process.env.ARVAN_SECRET_KEY || '',
  ARVAN_BUCKET_NAME: process.env.ARVAN_BUCKET_NAME || '',

  /**
   * آینهٔ لوکال درایور ابری (خواستهٔ مالک ۱۳-۱۱): هر بایتی که روی آروان
   * می‌نشیند، همان لحظه با «همان کلید» (همان مسیر و همان نام فایل) زیر
   * UPLOAD_PATH هم کپی می‌شود — بدون استثنا (آپلود عادی، ایمپورتر، تعویض
   * درجا، چت، پشتیبانی، همه از یک درایور می‌گذرند). نوشتن آینه بهترین‌حال
   * است: خطای دیسک هرگز آپلود اصلی (آروان) را نمی‌شکند؛ فقط هشدار لاگ
   * می‌شود. پیش‌فرض روشن — با STORAGE_MIRROR_LOCAL=false خاموش می‌شود.
   * روی ورسل (env VERCEL) پیش‌فرض خاموش است — دیسک تابع فقط-خواندنی
   * است و آینه‌ای وجود ندارد؛ فایل‌ها فقط روی آروان می‌نشینند.
   */
  MIRROR_LOCAL: bool(process.env.STORAGE_MIRROR_LOCAL, !process.env.VERCEL),

  /**
   * واترمارک دائمی تصاویر آگهی — از ۱۴-۱۱ دوباره روشن، اما فقط روی نسخهٔ
   * «ابری» (خواستهٔ مالک ۱۴-۱۱): «عکسهای آگهی که در ابرآروان ذخیره می کنی رو
   * روشون واتر مارک رو بنداز اما روی تصاویر معادل که در لوکال ذخیره می شن
   * واتر مارک ننداز.» نسخهٔ آینهٔ لوکال همیشه بدون واترمارک نوشته می‌شود
   * (سورس تمیز مالک — اگر روزی واترمارک عوض شود، عکس اصلی در دیسک هست و
   * نسخهٔ ابری از نو ساخته می‌شود). با WATERMARK_ENABLED=false کل مسیر
   * (ابر و آینه) بدون واترمارک می‌شود.
   */
  WATERMARK_ENABLED: bool(process.env.WATERMARK_ENABLED, true),
});

/** فایل‌های staged (relatedId=null) قدیمی‌تر از این — توسط reaper حذف می‌شوند. */
export const FILES_STAGING_TTL_DAYS = num('FILES_STAGING_TTL_DAYS', process.env.FILES_STAGING_TTL_DAYS, 7);

// ─── Wallet (B9) ─────────────────────────────────────────────────────────────
// کارت واریز کارت‌به‌کارت و مالکش — نمایشی در UI شارژ؛ با کارت واقعی فقط .env عوض می‌شود.
export const wallet = Object.freeze({
  CARD_NUMBER: process.env.WALLET_CARD_NUMBER || '6037-9975-1234-5678',
  CARD_OWNER: process.env.WALLET_CARD_OWNER || 'سعید یوسفی',
});
