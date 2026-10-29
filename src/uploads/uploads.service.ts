/**
 * ─── سرویس فایل‌ها (پورت imach-back، منطبق مدل‌های مگان) ──────────────────────
 * یک جدول چندریختی File هر موجودیتی که تصویر می‌خواهد را تزئین می‌کند:
 * User.avatar و Product.gallery — کلاینت اسلات را با fieldKey انتخاب می‌کند و
 * با همان کلید آن را می‌خواند. بایت‌ها روی درایور ذخیره‌سازی (آروان) هستند.
 *
 * نظم ضد-فایل-سرگردان (خواسته‌ی کاربر):
 *   • فرانت فقط وقتی آپلود می‌کند که مدل مقصد وجود دارد (یا لحظه‌ی ثبت نهایی) —
 *     هرگز حدسی وسط پرکردن فرم.
 *   • جریان replace اول آپلود می‌کند، ردیف قبلی فقط بعد از امن‌شدن بایت‌های
 *     جدید حذف می‌شود — عکس قدیمی به‌خاطر خطای آپلود هیچ‌وقت گم نمی‌شود.
 *   • حذف از ذخیره‌سازی بهترین‌حال است؛ ردیف DB منبع حقیقت است و عروسک
 *     دوره‌ای ادمین بایت‌ها و ردیف‌های جامانده را جمع می‌کند.
 *
 * خواندن‌ها URL عمومی مستقیم برمی‌گردانند — کلاینت بایت‌ها را مستقیم از
 * ابر می‌گیرد، بدون توکن، بدون پروکسی.
 */

import { Injectable, HttpStatus, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.module';
import { CacheService } from '../common/cache/cache.module';
import { storage, FILES_STAGING_TTL_DAYS } from '../common/config/env';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../common/guards';
import { buildStorage, type StorageDriver } from './storage';

/** مدل‌هایی که فایل تزئین می‌کند — کلاینت نمی‌تواند دیگری بسازد. */
export const RELATED_MODELS = ['User', 'Product', 'Verification', 'ChargeOrder'] as const;
export type RelatedModel = (typeof RELATED_MODELS)[number];

/** ObjectIdهای ارسالی کلاینت قبل از لمس Prisma اعتبارسنجی می‌شوند (۲۴hex → 404 تمیز) */
const OID_RE = /^[0-9a-fA-F]{24}$/;
function oidOr404(id: string | null | undefined): string {
  if (!id || !OID_RE.test(id)) throw AppError.notFound('فایل یافت نشد.');
  return id;
}

/** قواعد تصویر باسکول: jpeg/jpg/png — به‌علاوه webp برای آینده */
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;

/**
 * حداقل حجم معنادار تصویر.
 * باسکول ۲۰KB بود، اما بهینه‌سازی سمت کلاینت (canvas ≤‌۱۲۰۰px/۵۰۰KB) تصاویر
 * تمیز (پس‌زمینه ساده/عکس‌های کاتالوگی) را گاهی زیر ۲۰KB می‌برد و رد کردنشان
 * یعنی گم‌شدن بی‌صدای تصویر آگهی کاربر. کف ۴KB کافی است زباله‌ها را بگیرد؛
 * اعتبارسنجی واقعی ابعاد (≥۲۰۰px پس از پردازش sharp) جداگانه انجام می‌شود.
 */
const MIN_IMAGE_BYTES = 4 * 1024;

/** حداقل عرض معنادار پس از پردازش — عکس‌های ریز/آیکون‌وار رد می‌شوند */
const MIN_IMAGE_WIDTH = 200;

/** نام پوشه‌های درست — «users» نه «user» (جمع ساده‌انگارانه) */
const MODEL_FOLDER: Record<RelatedModel, string> = {
  User: 'users',
  Product: 'products',
  Verification: 'verifications',
  ChargeOrder: 'charge-orders',
};

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ProcessedImage {
  main: Buffer;
  mainMime: string;
  mainExt: string;
  thumb: Buffer | null;
  width: number;
  height: number;
}

/** شکل عمومی برگشتی به کلاینت — کلید ذخیره‌سازی هرگز لو نمی‌رود. */
export interface FileDto {
  id: string;
  fieldKey: string;
  url: string;
  thumbUrl: string | null;
  description: string | null;
  size: number;
  mimeType: string;
  createdAt: Date;
}

@Injectable()
export class UploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly driver: StorageDriver;
  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    this.driver = buildStorage(); // بوت با credentials غیب فوری می‌شکند
  }

  /**
   * ضدفایل‌سرگردان (خواسته کاربر: «اصلا نباید فایل اضافی در سرور بمونه»):
   * ردیف‌های staged (relatedId=null) که تا سقف TTL به مدلی نچسبیده‌اند — به
   * همراه بایت‌های‌شان — خودکار حذف می‌شوند؛ یک‌بار دیرهنگام بعد از بوت و بعد
   * هر ۶ ساعت. حذف idempotent است، پس چند اینستنس هم تداخل نمی‌کنند.
   */
  onModuleInit(): void {
    const bootDelay = setTimeout(() => {
      void this.reapStaged();
    }, 45_000);
    bootDelay.unref?.();
    this.reaperTimer = setInterval(() => {
      void this.reapStaged();
    }, 6 * 60 * 60 * 1000);
    this.reaperTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /** حذف کامل (بایت + ردیف) آپلودهای staged رسوب‌کرده — خودکار و بی‌صدا. */
  private async reapStaged(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - FILES_STAGING_TTL_DAYS * 86_400_000);
      const rows = await this.prisma.file.findMany({
        where: { relatedId: null, createdAt: { lt: cutoff } },
        select: { id: true, storageKey: true, thumbStorageKey: true },
        take: 500,
      });
      for (const f of rows) {
        try {
          if (f.storageKey) await this.driver.delete(f.storageKey);
          if (f.thumbStorageKey) await this.driver.delete(f.thumbStorageKey).catch(() => undefined);
        } catch {
          /* بایت‌ها بهترین‌حال — قرارداد، حذف ردیف است */
        }
        await this.prisma.file.delete({ where: { id: f.id } }).catch(() => undefined);
      }
      if (rows.length > 0) {
        // پنج ثانیه بعد، دسته بعدی (تخلیه تدریجی انباشتگاه‌های بزرگ)
        const next = setTimeout(() => void this.reapStaged(), 5_000);
        next.unref?.();
      }
    } catch {
      /* reaper هرگز نباید کاربران را بیدار کند */
    }
  }

  // ─── پاین‌لاین تصویر (sharp) ────────────────────────────────────────────────

  /**
   * یک‌بار فشرده/تغییراندازه، دو بار ذخیره (اصلی + تامبنیل) — عین خواسته مالک:
   *  • تصویر اصلی: حداکثر عرض ۱۲۰۰px (طول به‌تناسب)؛ اگر بعد از کوچک‌شدن حجم
   *    از ۵۰۰KB بیشتر بود کیفیت پله‌ای کم می‌شود تا زیر سقف بیاید (کیفیت
   *    هر پله فقط ~۸٪ کم می‌شود تا عکس زیاد افت نکند).
   *  • تامبنیل: حداکثر عرض ۵۰۰px (طول اتوماتیک) — برای کارت‌های لیست.
   * (سرعت: کارت لیست هرگز تصویر ۱۲۰۰px نمی‌کشد)
   */
  private static readonly MAIN_MAX_WIDTH = 1200;
  private static readonly MAIN_MAX_BYTES = 500 * 1024;
  private static readonly THUMB_MAX_WIDTH = 500;

  private async processFile(buffer: Buffer, mime: string): Promise<ProcessedImage> {
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();
      const hasAlpha = !!meta.hasAlpha;
      const isWebp = mime === 'image/webp';

      // تصویر اصلی — فقط عرض محدود می‌شود؛ طول خودکار/تناسبی (fit inside با عرض ۱۲۰۰)
      const mainPipeline = sharp(buffer).rotate();
      let main = await mainPipeline
        .resize(UploadsService.MAIN_MAX_WIDTH, UploadsService.MAIN_MAX_WIDTH, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toFormat(isWebp ? 'webp' : hasAlpha ? 'png' : 'jpeg', isWebp ? { quality: 84 } : hasAlpha ? { compressionLevel: 9 } : { quality: 84, mozjpeg: true })
        .toBuffer();

      // پله‌ای فشرده‌تر — تا زیر ۵۰۰KB بیاید (فقط jpeg/webp؛ png شفاف را دست نمی‌زنیم)
      if (!hasAlpha && main.length > UploadsService.MAIN_MAX_BYTES) {
        for (const quality of [78, 72, 66, 60, 54, 48]) {
          main = await sharp(buffer)
            .rotate()
            .resize(UploadsService.MAIN_MAX_WIDTH, UploadsService.MAIN_MAX_WIDTH, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .toFormat(isWebp ? 'webp' : 'jpeg', isWebp ? { quality } : { quality, mozjpeg: true })
            .toBuffer();
          if (main.length <= UploadsService.MAIN_MAX_BYTES) break;
        }
      }

      const thumb = await sharp(buffer)
        .rotate()
        .resize(UploadsService.THUMB_MAX_WIDTH, UploadsService.THUMB_MAX_WIDTH, { fit: 'inside', withoutEnlargement: true })
        .toFormat('jpeg', { quality: 78, mozjpeg: true }) // تامبنیل همیشه jpeg
        .toBuffer();

      const outMeta = await sharp(main).metadata();
      const mainMime = isWebp ? 'image/webp' : hasAlpha ? 'image/png' : 'image/jpeg';
      const mainExt = isWebp ? 'webp' : hasAlpha ? 'png' : 'jpg';
      return { main, mainMime, mainExt, thumb, width: outMeta.width ?? 0, height: outMeta.height ?? 0 };
    } catch {
      // تصویر خراب/فرمت پشتیبانی‌نشده — بایت‌های اصلی را نگه دار، رد نکن
      return { main: buffer, mainMime: mime, mainExt: MIME_EXT[mime] ?? 'bin', thumb: null, width: 0, height: 0 };
    }
  }

  // ─── کلید و پوشه‌ها ────────────────────────────────────────────────────────

  /**
   * معماری پوشه (per-USER — خواسته مالک ۱۴۰۵/۰۸/۰۷):
   *   users/{ownerId}/avatars/… · users/{ownerId}/staging/…
   *   users/{ownerId}/products/{productId}/gallery/…
   *   users/{ownerId}/verifications/{orderId}/… · users/{ownerId}/charge-orders/{orderId}/…
   * همه‌ی فایل‌های یک شخص زیر پوشه خودش است — کالا، چت (آینده)، پروفایل — تا
   * سهمیه/هزینه فضای هر کاربر بعداً قابل اعمال شود (مصرف واقعی از جدول File
   * با ایندکس ownerId پاسخ داده می‌شود — نه اسکن ذخیره‌سازی).
   * فایل‌های قدیمی با کلید قبلی (products/{id}/…) در DB معتبرند و همچنان
   * سرو می‌شوند؛ ساختار جدید فقط برای آپلودهای تازه است.
   */
  private keyFor(ownerId: string, model: RelatedModel, modelId: string | null, fieldKey: string, ext: string): string {
    const stamp = Date.now().toString(36);
    const rand = randomBytes(5).toString('hex');
    // آواتار زیر پوشه خود کاربر است و نیازی به modelId ندارد
    const inner =
      model === 'User'
        ? 'avatars'
        : modelId
          ? `${MODEL_FOLDER[model]}/${modelId}`
          : 'staging';
    return `users/${ownerId}/${inner}/${fieldKey}/${stamp}-${rand}.${ext}`;
  }

  // ─── آپلود ────────────────────────────────────────────────────────────────

  /** تعیین اینکه فایل کجا می‌چسبد و چه کسی اجازه نوشتن دارد. */
  private async resolveTarget(user: AuthUser, model: RelatedModel, modelId: string | null) {
    if (!modelId) return null; // آپلود staged — هنوز مدلی برای چک نیست
    if (model === 'User') {
      if (modelId !== user.id && user.role !== 'ADMIN') {
        throw AppError.forbidden('شما اجازه‌ی این کار را ندارید.');
      }
      return { id: modelId };
    }
    // Verification — id آبجکت؛ فقط مالک سفارش
    if (model === 'Verification') {
      if (!OID_RE.test(modelId)) throw AppError.notFound('درخواست یافت نشد.');
      const order = await this.prisma.verificationOrder.findUnique({
        where: { id: modelId },
        select: { userId: true },
      });
      if (!order) throw AppError.notFound('درخواست یافت نشد.');
      if (order.userId !== user.id && user.role !== 'ADMIN') {
        throw AppError.forbidden('شما اجازه‌ی این کار را ندارید.');
      }
      return order;
    }
    // ChargeOrder — فیش واریزی کارت‌به‌کارت؛ id آبجکت، فقط مالک سفارش
    if (model === 'ChargeOrder') {
      if (!OID_RE.test(modelId)) throw AppError.notFound('سفارش شارژ یافت نشد.');
      const order = await this.prisma.chargeOrder.findUnique({
        where: { id: modelId },
        select: { userId: true },
      });
      if (!order) throw AppError.notFound('سفارش شارژ یافت نشد.');
      if (order.userId !== user.id && user.role !== 'ADMIN') {
        throw AppError.forbidden('شما اجازه‌ی این کار را ندارید.');
      }
      return order;
    }
    // Product — id عددی؛ فقط مالک
    if (!/^\d+$/.test(modelId)) throw AppError.notFound('محصول یافت نشد.');
    const product = await this.prisma.product.findUnique({
      where: { id: Number(modelId) },
      select: { id: true, userId: true },
    });
    if (!product) throw AppError.notFound('محصول یافت نشد.');
    if (product.userId !== user.id && user.role !== 'ADMIN') {
      throw AppError.forbidden('شما اجازه‌ی این کار را ندارید.');
    }
    return product;
  }

  /**
   * پارس multipart به فیلدها + بافر فایل (Fastify).
   *
   * ترتیب نسبی فیلدها نباید مهم باشد: مرورگرها FormData را به همان ترتیب append
   * می‌فرستند و بعضی کلاینت‌ها فایل را اول می‌گذارند، بعضی آخر. req.file() فقط
   * فیلدهای «قبل از فایل» را می‌دهد و بقیه را می‌باخت — ریشه‌ی باگ «عکس آپلود
   * می‌شود ولی هیچ‌وقت به کالا نمی‌چسبد». اینجا کل استریم با parts() مصرف
   * می‌شود تا modelId/replace/description از هر موقعیتی بیایند.
   */
  async readMultipart(req: FastifyRequest): Promise<{
    fields: Record<string, string>;
    file: { buffer: Buffer; mimetype: string; filename: string };
  }> {
    const fastifyReq = req as FastifyRequest & {
      parts: (opts?: unknown) => AsyncIterable<MultipartPart>;
      isMultipart: () => boolean;
    };
    if (!fastifyReq.isMultipart()) {
      throw AppError.badRequest('فایل ارسال نشده است.', 'NOT_MULTIPART');
    }

    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; mimetype: string; filename: string } | null = null;
    try {
      for await (const part of fastifyReq.parts()) {
        if (part.type === 'file') {
          if (file) {
            // پلاگین files:1 است؛ فایل اضافه را هدر نده — ببلع
            await part.toBuffer().catch(() => undefined);
            continue;
          }
          const buffer = await part.toBuffer();
          file = { buffer, mimetype: part.mimetype, filename: part.filename };
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
    } catch {
      // بدنه بریده (PrematureClose) = آپلود ناقص — رکورد نیم‌بند نساز
      throw AppError.badRequest('آپلود ناقص بود — دوباره تلاش کنید.', 'MULTIPART_TRUNCATED');
    }
    if (!file) {
      throw AppError.badRequest('فایل ارسال نشده است.', 'NOT_MULTIPART');
    }
    return { fields, file };
  }

  /**
   * پارس multipart چندفایلی — فایل‌ها با نام فیلدشان جمع می‌شوند
   * (nationalCard، selfie، …). فقط فیلدهای خواسته‌شده پذیرفته می‌شوند تا
   * کلاینت نتواند اسلات‌های ناشناس بسازد؛ فایل ناشناس ببلعیده می‌شود.
   */
  async readMultipartMulti(
    req: FastifyRequest,
    acceptedFields: string[],
  ): Promise<{
    fields: Record<string, string>;
    files: Map<string, { buffer: Buffer; mimetype: string; filename: string }>;
  }> {
    const fastifyReq = req as FastifyRequest & {
      parts: (opts?: unknown) => AsyncIterable<MultipartPart>;
      isMultipart: () => boolean;
    };
    if (!fastifyReq.isMultipart()) {
      throw AppError.badRequest('فایل ارسال نشده است.', 'NOT_MULTIPART');
    }

    const fields: Record<string, string> = {};
    const files = new Map<string, { buffer: Buffer; mimetype: string; filename: string }>();
    try {
      for await (const part of fastifyReq.parts()) {
        if (part.type === 'file') {
          if (part.fieldname && acceptedFields.includes(part.fieldname)) {
            if (files.has(part.fieldname)) {
              // تکراری — ببلع
              await part.toBuffer().catch(() => undefined);
              continue;
            }
            files.set(part.fieldname, {
              buffer: await part.toBuffer(),
              mimetype: part.mimetype ?? 'application/octet-stream',
              filename: part.filename ?? 'file',
            });
          } else {
            await part.toBuffer().catch(() => undefined);
          }
        } else if (typeof part.value === 'string') {
          fields[part.fieldname ?? ''] = part.value;
        }
      }
    } catch {
      throw AppError.badRequest('آپلود ناقص بود — دوباره تلاش کنید.', 'MULTIPART_TRUNCATED');
    }
    return { fields, files };
  }

  async upload(
    user: AuthUser,
    input: {
      model: RelatedModel;
      modelId?: string | null;
      fieldKey: string;
      description?: string | null;
      replace?: boolean;
    },
    file: { buffer: Buffer; mimetype: string; filename: string },
  ): Promise<FileDto> {
    if (file.buffer.length > storage.MAX_FILE_SIZE) {
      throw AppError.badRequest(
        `حجم فایل نباید از ${Math.floor(storage.MAX_FILE_SIZE / 1024 / 1024)} مگابایت بیشتر باشد.`,
        'FILE_TOO_LARGE',
      );
    }
    if (file.buffer.length < MIN_IMAGE_BYTES) {
      throw AppError.badRequest('حجم تصویر بسیار کم است.', 'FILE_TOO_SMALL');
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.mimetype)) {
      throw AppError.badRequest('این نوع فایل پشتیبانی نمی‌شود.', 'FILE_TYPE_NOT_ALLOWED');
    }

    const modelId = input.modelId || null;
    await this.resolveTarget(user, input.model, modelId);

    const processed = await this.processFile(file.buffer, file.mimetype);
    // ابعاد واقعی (پس از decode با sharp) — عکس‌های ریز/زباله رد می‌شوند؛
    // width=0 یعنی sharp نتوانست decode کند → همان مسیر قدیمی ادامه می‌دهد.
    if (processed.width > 0 && processed.width < MIN_IMAGE_WIDTH) {
      throw AppError.badRequest(
        `عرض تصویر باید حداقل ${MIN_IMAGE_WIDTH} پیکسل باشد.`,
        'IMAGE_TOO_SMALL',
      );
    }
    const key = this.keyFor(user.id, input.model, modelId, input.fieldKey, processed.mainExt);
    const url = await this.driver.put(key, processed.main, processed.mainMime);

    let thumbUrl: string | null = null;
    let thumbKey: string | null = null;
    if (processed.thumb) {
      thumbKey = `${key}.thumb.jpg`; // همیشه jpeg — تامبنیل کاشی‌های <img>
      thumbUrl = await this.driver.put(thumbKey, processed.thumb, 'image/jpeg').catch(() => null);
      if (!thumbUrl) thumbKey = null;
    }

    const row = await this.prisma.file.create({
      data: {
        ownerId: user.id,
        relatedModel: input.model,
        relatedId: modelId,
        fieldKey: input.fieldKey,
        description: input.description?.trim().slice(0, 300) || null,
        name: file.filename.slice(0, 200),
        mimeType: processed.mainMime,
        size: processed.main.length,
        url,
        thumbUrl,
        storageKey: key,
        thumbStorageKey: thumbKey,
        metadata: {
          originalSize: file.buffer.length,
          width: processed.width,
          height: processed.height,
        } as unknown as object,
      },
    });

    // معناشناسی replace (خواسته کاربر): آپلود جدید اول، بعد حذف قبلی‌ها —
    // اسلات‌های تک‌فایلی (avatar) هرگز ردیف انباشته نمی‌کنند؛ گالری‌ها با
    // replace=false خارج می‌شوند.
    if (input.replace !== false && modelId) {
      await this.removeSiblings(input.model, modelId, input.fieldKey, row.id);
    }
    await this.bustCaches(input.model, modelId);

    return this.toDto(row);
  }

  /** حذف همه فایل‌های دیگرِ همان اسلات (ذخیره‌سازی بهترین‌حال). */
  private async removeSiblings(model: RelatedModel, modelId: string, fieldKey: string, keepId: string): Promise<void> {
    const stale = await this.prisma.file.findMany({
      where: { relatedModel: model, relatedId: modelId, fieldKey, id: { not: keepId } },
      select: { id: true, storageKey: true, thumbStorageKey: true },
    });
    for (const f of stale) {
      try {
        if (f.storageKey) await this.driver.delete(f.storageKey);
        if (f.thumbStorageKey) await this.driver.delete(f.thumbStorageKey).catch(() => undefined);
      } catch {
        /* پاک‌سازی ذخیره‌سازی بهترین‌حال — حذف ردیف مهم است */
      }
      await this.prisma.file.delete({ where: { id: f.id } }).catch(() => undefined);
    }
  }

  // ─── خواندن ────────────────────────────────────────────────────────────────

  toDto(row: {
    id: string;
    fieldKey: string;
    url: string;
    thumbUrl: string | null;
    description: string | null;
    size: number;
    mimeType: string;
    createdAt: Date;
  }): FileDto {
    return {
      id: row.id,
      fieldKey: row.fieldKey,
      url: row.url,
      thumbUrl: row.thumbUrl,
      description: row.description,
      size: row.size,
      mimeType: row.mimeType,
      createdAt: row.createdAt,
    };
  }

  /** خواندن عمومی با اسلات — اندپوینتی که کلاینت قبل از <img src> می‌زند. */
  async getFileUrl(model: string, modelId: string, key: string): Promise<FileDto> {
    if (!(RELATED_MODELS as readonly string[]).includes(model)) {
      throw AppError.badRequest('مدل معتبر نیست.', 'BAD_MODEL');
    }
    const row = await this.prisma.file.findFirst({
      where: { relatedModel: model, relatedId: modelId, fieldKey: key },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw AppError.notFound('فایل یافت نشد.');
    return this.toDto(row);
  }

  /**
   * نقشه گالری گروهی برای payload لیست‌ها (کارت‌های محصول) — یک کوئری in
   * برای کل صفحه، نه یکی برای هر ردیف. (الگوی imach-back)
   */
  async galleryMap(productIds: number[]): Promise<Map<number, FileDto[]>> {
    const map = new Map<number, FileDto[]>();
    if (productIds.length === 0) return map;
    const rows = await this.prisma.file.findMany({
      where: {
        relatedModel: 'Product',
        relatedId: { in: productIds.map((id) => String(id)) },
        fieldKey: 'gallery',
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    for (const r of rows) {
      const pid = Number(r.relatedId);
      const list = map.get(pid) ?? [];
      list.push(this.toDto(r));
      map.set(pid, list);
    }
    return map;
  }

  // ─── حذف ────────────────────────────────────────────────────────────────────

  /** «حذف» فرانت (مثلاً X پروفایل) — مالک یا ادمین. */
  async remove(user: AuthUser, fileId: string): Promise<{ ok: true }> {
    oidOr404(fileId);
    const row = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!row) throw AppError.notFound('فایل یافت نشد.');

    let allowed = user.role === 'ADMIN' || row.ownerId === user.id;
    if (!allowed && row.relatedModel === 'Product' && row.relatedId) {
      const product = await this.prisma.product.findUnique({
        where: { id: Number(row.relatedId) },
        select: { userId: true },
      });
      if (product) allowed = product.userId === user.id;
    }
    if (!allowed) throw AppError.forbidden('شما اجازه‌ی این کار را ندارید.');

    try {
      if (row.storageKey) await this.driver.delete(row.storageKey);
      if (row.thumbStorageKey) await this.driver.delete(row.thumbStorageKey).catch(() => undefined);
    } catch {
      /* بهترین‌حال — ردیف DB مرجع است */
    }
    await this.prisma.file.delete({ where: { id: row.id } });
    await this.bustCaches(row.relatedModel as RelatedModel, row.relatedId);
    return { ok: true };
  }

  /** حذف کل گالری یک محصول (هنگام حذف دائمی) — بایت + ردیف. */
  async removeAllForModel(model: RelatedModel, modelId: string): Promise<number> {
    const rows = await this.prisma.file.findMany({
      where: { relatedModel: model, relatedId: modelId },
      select: { id: true, storageKey: true, thumbStorageKey: true },
    });
    // پاک‌سازی ذخیره‌سازی «best-effort و غیرمسدودکننده» — درس تست ۲۸-۱۰: با
    // شبکه لرزان آروان، حذف سنکرون (۲۰s×۴ retry برای هر آبجکت) کل درخواست
    // ادمین را دقیقه‌ها معلق و سپس ۵۰۰ (شکستن پروکسی) می‌کرد، در حالی که
    // سند File منبع حقیقت است و همین‌جا حذف می‌شود؛ آبجکت‌های یتیم روی
    // ذخیره‌سازی بعداً توسط ابزار «آپلودهای یتیم» ادمین جمع می‌شوند.
    for (const f of rows) {
      if (f.storageKey) void this.driver.delete(f.storageKey).catch(() => undefined);
      if (f.thumbStorageKey) void this.driver.delete(f.thumbStorageKey).catch(() => undefined);
    }
    await this.prisma.file.deleteMany({ where: { relatedModel: model, relatedId: modelId } });
    await this.bustCaches(model, modelId);
    return rows.length;
  }

  // ─── انسجام کش ──────────────────────────────────────────────────────────────

  /** عوض‌شدن گالری باید فوراً لیست‌های کش‌شده را تازه کند. */
  private async bustCaches(model: RelatedModel, modelId: string | null): Promise<void> {
    try {
      if (model === 'Product' && modelId) {
        this.cache.invalidateTag(`product:${modelId}`);
      }
      if (model === 'User' && modelId) {
        // آواتار/گالری/گواهی کاربر — کش پروفایل عمومی فروشنده هم بشکند
        const owner = await this.prisma.user.findUnique({
          where: { id: modelId },
          select: { userName: true },
        });
        if (owner?.userName) this.cache.invalidateTag(`seller:${owner.userName.trim()}`);
      }
      this.cache.invalidateTag('products');
    } catch {
      /* غیرمسدودکننده */
    }
  }

  // ─── ادمین: عروسک‌ها و مصرف ────────────────────────────────────────────────

  /**
   * عروسک = ردیف‌هایی که موجودیت‌شان رفته (dangling) یا هرگز به مدل نچسبیدند
   * (staged گذشته از TTL). چک‌های dangling محدودند (۱۰۰۰ ردیف اخیر) تا
   * اندپوینت در مقیاس میلیونها ارزان بماند.
   */
  async listOrphans(limit = 100) {
    const cutoff = new Date(Date.now() - FILES_STAGING_TTL_DAYS * 86_400_000);

    const staged = await this.prisma.file.findMany({
      where: { relatedId: null, createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const recent = await this.prisma.file.findMany({
      where: { relatedId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const dangling: typeof recent = [];
    const userIds = new Set<string>();
    const productIds = new Set<number>();
    for (const f of recent) {
      if (f.relatedModel === 'User') userIds.add(f.relatedId!);
      else if (f.relatedModel === 'Product') productIds.add(Number(f.relatedId));
    }
    const [userRows, productRows] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true } })
        : [],
      productIds.size
        ? this.prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true } })
        : [],
    ]);
    const userSet = new Set(userRows.map((r) => r.id));
    const productSet = new Set(productRows.map((r) => r.id));
    for (const f of recent) {
      const ok =
        f.relatedModel === 'User'
          ? userSet.has(f.relatedId!)
          : f.relatedModel === 'Product'
            ? productSet.has(Number(f.relatedId))
            : false;
      if (!ok) dangling.push(f);
    }

    return { staged: staged.map((r) => this.toDto(r)), dangling: dangling.map((r) => this.toDto(r)) };
  }

  /** حذف ردیف‌های عروسک (+ بایت‌ها بهترین‌حال) با id، یا همه وقتی ids نیست. */
  async deleteOrphans(ids?: string[]): Promise<{ deleted: number }> {
    const { staged, dangling } = await this.listOrphans(1000);
    const all = [...staged, ...dangling];
    const targets = ids && ids.length > 0 ? all.filter((f) => ids.includes(f.id)) : all;
    for (const f of targets) {
      if (!OID_RE.test(f.id)) continue;
      // کلیدهای ذخیره‌سازی هرگز از سرویس بیرون نمی‌روند — دوباره با id بگیر
      const row = await this.prisma.file.findUnique({
        where: { id: f.id },
        select: { storageKey: true, thumbStorageKey: true },
      });
      if (row) {
        try {
          if (row.storageKey) await this.driver.delete(row.storageKey);
          if (row.thumbStorageKey) await this.driver.delete(row.thumbStorageKey).catch(() => undefined);
        } catch {
          /* بهترین‌حال */
        }
      }
      await this.prisma.file.delete({ where: { id: f.id } }).catch(() => undefined);
    }
    return { deleted: targets.length };
  }

  /** مصرف ذخیره‌سازی هر کاربر (خواسته کاربر: «هر کاربر چقدر حجم مصرف کرده»). */
  async usage(limit = 50) {
    const grouped = await this.prisma.file.groupBy({
      by: ['ownerId'],
      _sum: { size: true },
      _count: { id: true },
      orderBy: { _sum: { size: 'desc' } },
      take: limit,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.ownerId) } },
      select: { id: true, userName: true, firstName: true, lastName: true, phone: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u]));
    return grouped.map((g) => {
      const u = nameOf.get(g.ownerId);
      return {
        ownerId: g.ownerId,
        userName: u?.userName ?? '—',
        name: `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || '—',
        phone: u?.phone ?? '',
        files: g._count.id,
        bytes: g._sum.size ?? 0,
      };
    });
  }
}

/** یک پارت multipart از @fastify/multipart — فیلد یا فایل (هر ترتیبی) */
interface MultipartPart {
  type?: 'field' | 'file';
  fieldname?: string;
  value?: unknown;
  mimetype?: string;
  filename?: string;
  toBuffer: () => Promise<Buffer>;
}
