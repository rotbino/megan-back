/**
 * ─── درایورهای ذخیره‌سازی ─────────────────────────────────────────────────────
 * یک اینترفیس کوچک، دو پیاده‌سازی (پورت از imach-back):
 *
 *   • ArvanStorage — object storage سازگار S3 (آروان). اشیا public-read با
 *     هدر کش immutable نوشته می‌شوند تا کلاینت بایت‌ها را مستقیم از CDN بگیرد —
 *     API هرگز بدنه فایل را پروکسی نمی‌کند (سرعت).
 *   • LocalStorage — دیسک ساده زیر UPLOAD_PATH با @fastify/static.
 *     «بعدا با کمترین هزینه قابل سوییچ باشه» یعنی یک env، نه بازنویسی.
 *
 * سطح درایور عمداً حداقلی است (put/delete) تا افزودن S3/MinIO/B2 بعدا یک فایل
 * باشد. جدول File مقدار storageKey را نگه می‌دارد تا تعویض پروایدر هیچ ردیفی
 * را سرگردان نکند — کلیدهای پروایدر قبلی همچنان حذف می‌شوند.
 */

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { env, storage } from '../common/config/env';

export interface StorageDriver {
  /** ذخیره بایت‌ها؛ URL عمومی مستقیم را برمی‌گرداند. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** حذف بهترین‌حال — خطای ذخیره‌سازی هرگز جریان اصلی را نمی‌شکند. */
  delete(key: string): Promise<void>;
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

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        // کلیدها یکتا و تغییرناپذیرند → کش یک‌ساله بدون invalidation
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBase}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
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
}

/** در بوت ساخته می‌شود؛ STORAGE_DRIVER=arvan بدون credentials فوری می‌شکند. */
export function buildStorage(): StorageDriver {
  return storage.DRIVER === 'local' ? new LocalStorage() : new ArvanStorage();
}
