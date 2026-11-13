/**
 * ─── درایورهای ذخیره‌سازی ─────────────────────────────────────────────────────
 * یک اینترفیس کوچک، سه پیاده‌سازی (پورت از imach-back):
 *
 *   • ArvanStorage — object storage سازگار S3 (آروان). اشیا public-read با
 *     هدر کش immutable نوشته می‌شوند تا کلاینت بایت‌ها را مستقیم از CDN بگیرد —
 *     API هرگز بدنه فایل را پروکسی نمی‌کند (سرعت).
 *   • LocalStorage — دیسک ساده زیر UPLOAD_PATH با @fastify/static.
 *     «بعدا با کمترین هزینه قابل سوییچ باشه» یعنی یک env، نه بازنویسی.
 *   • MirroredStorage — آروان + کپی همزمان روی دیسک با همان کلید
 *     (خواستهٔ مالک ۱۳-۱۱: بک‌آپ/بانک کاری لوکال فولدر uploads).
 *
 * سطح درایور عمداً حداقلی است (put/delete) تا افزودن S3/MinIO/B2 بعدا یک فایل
 * باشد. جدول File مقدار storageKey را نگه می‌دارد تا تعویض پروایدر هیچ ردیفی
 * را سرگردان نکند — کلیدهای پروایدر قبلی همچنان حذف می‌شوند.
 */

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, writeFile, unlink, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { env, storage } from '../common/config/env';

export interface StorageDriver {
  /**
   * ذخیره بایت‌ها؛ URL عمومی مستقیم را برمی‌گرداند.
   * cacheControl اختیاری — پیش‌فرض «immutable یک‌ساله» است چون کلیدها یکتا و
   * تغییرناپذیرند؛ فقط «تعویض درجا» (replace-in-place همان کلید) هدر تازه‌تری
   * می‌فرستد تا کلاینت‌های تازه نسخهٔ جدید را بگیرند.
   */
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<string>;
  /** حذف بهترین‌حال — خطای ذخیره‌سازی هرگز جریان اصلی را نمی‌شکند. */
  delete(key: string): Promise<void>;
  /** اگر URL مال همین درایور باشد کلید ذخیره‌سازی‌اش را بده — برای پاک‌سازی
   *  ردیف‌های قدیمی که storageKey ندارند (ایمپورت‌های پیشینی). */
  urlToKey(url: string): string | null;
  /** حذف همهٔ اشیا زیر یک پیشوند (پوشهٔ قدیمی buskool/ و…) — تعداد حذف‌شده‌ها. */
  deletePrefix(prefix: string): Promise<number>;
}

// ─── Arvan (سازگار S3) ───────────────────────────────────────────────────────

class ArvanStorage implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  /** پایه URLهای عمومی — باکت داخل هاست است. */
  private readonly publicBase: string;

  constructor() {
    const { ARVAN_ENDPOINT, ARVAN_REGION, ARVAN_ACCESS_KEY, ARVAN_SECRET_KEY, ARVAN_BUCKET_NAME } = storage;
    if (!ARVAN_ENDPOINT || !ARVAN_ACCESS_KEY || !ARVAN_SECRET_KEY || !ARVAN_BUCKET_NAME) {
      throw new Error('STORAGE_DRIVER=arvan اما متغیرهای ARVAN_* تنظیم نشده‌اند');
    }

    // ARVAN_ENDPOINT ممکن است virtual-hosted باشد (باکت در هاست، مثل
    // https://<bucket>.s3.<region>.arvanstorage.ir) یا endpoint ساده. SDK با
    // forcePathStyle همیشه باکت را به‌عنوان سگمنت مسیر اضافه می‌کند، پس endpoint
    // API نباید باکت داشته باشد — اما URL عمومی هر شکلی را که اکانت استفاده
    // می‌کند نگه می‌دارد.
    const url = new URL(ARVAN_ENDPOINT);
    const bucketHosted = url.hostname.startsWith(`${ARVAN_BUCKET_NAME}.`);
    const apiHost = bucketHosted ? url.hostname.slice(ARVAN_BUCKET_NAME.length + 1) : url.hostname;
    this.bucket = ARVAN_BUCKET_NAME;
    this.publicBase = bucketHosted
      ? `${url.protocol}//${url.hostname}`.replace(/\/$/, '')
      : `${url.protocol}//${url.hostname}/${ARVAN_BUCKET_NAME}`.replace(/\/+$/, '');

    this.client = new S3Client({
      endpoint: `${url.protocol}//${apiHost}`,
      region: ARVAN_REGION || 'us-east-1',
      credentials: { accessKeyId: ARVAN_ACCESS_KEY, secretAccessKey: ARVAN_SECRET_KEY },
      forcePathStyle: true,
      // ── سخت‌گیری شبکه (درس تست ۲۸-۱۰-۲۰۲۶): ──
      // مسیر اینترنت به آروان (یا هر S3 دیگری) می‌تواند بی‌سروصدا هنگ کند
      // (اتصال TCP برقرار می‌شود اما پاسک پاسخ نمی‌دهد). بدون timeout، آپلود
      // دقیقه‌ها معلق می‌ماند و کلاینت/proxy خطای ۵۰۰ می‌گیرد در حالی که سرور
      // دیرتر موفق می‌شود → ردیف‌های تکراری و تجربه خراب.
      // با timeout کوتاه + retry خودکار SDK، اتصال معلق سریع قطع و تلاش مجدد
      // روی اتصال تازه انجام می‌شود (رفع ریشه‌ای هنگ آپلود).
      requestHandler: {
        requestTimeout: 20_000, // هر تلاش PUT/DELETE حداکثر ۲۰ ثانیه
        connectionTimeout: 8_000, // برقراری اتصال حداکثر ۸ ثانیه
        // آپلودها body کامل دارند → محدودیت هم‌زمانی پیش‌فرض کافی است
      },
      // ۴ تلاش (۱ + ۳ retry با backoff نمایی SDK) — پایداری در شبکه لرزان
      maxAttempts: 4,
    });
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        // کلیدهای یکتا immutable کش می‌شوند؛ تعویض درجا هدر کوتاه‌تری می‌فرستد
        CacheControl: cacheControl ?? 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBase}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  urlToKey(url: string): string | null {
    const base = `${this.publicBase}/`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (listed.Contents ?? [])
        .map((o) => ({ Key: o.Key }))
        .filter((o): o is { Key: string } => typeof o.Key === 'string');
      if (objects.length > 0) {
        // حذف دسته‌ای — تا ۱۰۰۰ آبجکت در هر فراخوانی (سقف S3)
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }),
        );
        deleted += objects.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}

// ─── دیسک local ──────────────────────────────────────────────────────────────

class LocalStorage implements StorageDriver {
  private readonly root: string;
  private readonly base: string;

  constructor() {
    this.root = storage.UPLOAD_PATH;
    // در dev مبدا API کافی است؛ پشت پروکسی PUBLIC_BASE_URL را تنظیم کنید.
    this.base = `${(storage.PUBLIC_BASE_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '')}/uploads`;
  }

  private path(key: string): string {
    // کلیدها را خودمان می‌سازیم (ورودی کاربر نیست) — باز هم traversal را رد کن
    if (key.includes('..')) throw new Error('invalid storage key');
    return join(this.root, key);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<string> {
    const file = this.path(key);
    await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    await writeFile(file, body);
    return `${this.base}/${key}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch {
      /* قبلاً رفته — مشکلی نیست */
    }
  }

  urlToKey(url: string): string | null {
    const base = `${this.base}/`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const dir = this.path(prefix.replace(/\/+$/, ''));
    let removed = 0;
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(d, e.name));
        else removed++;
      }
    };
    await walk(dir);
    await rm(dir, { recursive: true, force: true });
    return removed;
  }
}

// ─── آینهٔ لوکال درایور ابری (خواستهٔ مالک ۱۳-۱۱) ─────────────────────────────
// «موقع ایمپورت غیر از اینکه تصاویر بصورت آنلاین در ابرآروان ذخیره میشه، در
// محل ذخیرهٔ کد بک‌اند هم ذخیره بشه در فولدر آپلودز، دقیقاً همون مسیر و همون
// اسم.» این پوشش دقیقاً همین کار را می‌کند: درایور اصلی (آروان) مرجع URL و
// منبع حقیقت است؛ همان بایت‌ها با همان کلید (مسیر/نام فایل) روی دیسک زیر
// UPLOAD_PATH هم می‌نشینند. چون از buildStorage می‌گذرد، «همهٔ» نوشتن‌ها را
// می‌گیرد: آپلود عادی کاربر، ingestExternal ایمپورتر (گالری + آواتار)،
// تعویض درجای تصاویر آگهی‌ها، پیوست چت/پشتیبانی و … — نه فقط ایمپورت.
//
// سیاست خطا: آینه بهترین‌حال است — خطای دیسک هرگز عملیات اصلی را نمی‌شکند
// (آپلود موفق می‌ماند، فقط هشدار لاگ می‌شود)؛ حذف/پاک‌سازی هر دو طرف را
// «بی‌صدا» بهترین‌حال انجام می‌دهد تا نسخهٔ مرده روی دیسک نماند.

class MirroredStorage implements StorageDriver {
  constructor(
    private readonly primary: StorageDriver,
    private readonly mirror: LocalStorage,
  ) {}

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<string> {
    // اول ابر — URL مرجع همین است؛ اگر ابر شکست خورد کل عملیات شکست خورده
    const url = await this.primary.put(key, body, contentType, cacheControl);
    // بعد دیسک — بهترین‌حال؛ مالک باید از هشدار باخبر شود ولی آپلود سالم بماند
    try {
      await this.mirror.put(key, body, contentType);
    } catch (err) {
      console.warn(`[storage] آینهٔ لوکال نتوانست بنویسد «${key}»: ${(err as Error).message}`);
    }
    return url;
  }

  async delete(key: string): Promise<void> {
    await this.primary.delete(key);
    await this.mirror.delete(key).catch(() => undefined);
  }

  urlToKey(url: string): string | null {
    // URLهای ثبت‌شده در DB همیشه مال درایور اصلی‌اند؛ آینه فقط خوانده می‌شود
    return this.primary.urlToKey(url) ?? this.mirror.urlToKey(url);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const deleted = await this.primary.deletePrefix(prefix);
    await this.mirror.deletePrefix(prefix).catch(() => 0);
    return deleted;
  }
}

/** در بوت ساخته می‌شود؛ STORAGE_DRIVER=arvan بدون credentials فوری می‌شکند. */
export function buildStorage(): StorageDriver {
  if (storage.DRIVER === 'local') return new LocalStorage();
  const arvan = new ArvanStorage();
  // آینهٔ لوکال (پیش‌فرض روشن) — بایت‌ها هم روی آروان هم زیر UPLOAD_PATH
  return storage.MIRROR_LOCAL ? new MirroredStorage(arvan, new LocalStorage()) : arvan;
}
