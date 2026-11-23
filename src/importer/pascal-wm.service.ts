import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
import { UploadsService } from '../uploads/uploads.service';
import { AppError } from '../common/errors/app-error';
import { detectWatermark, isStrong, removeWatermarkRgb, type WmDetection } from './pascal-wm-core';

/**
 * حذف خودکار واترمارک پاسکال — سرویس UI (خواستهٔ مالک ۱۹-۱۱).
 *
 * پورت TypeScript همان الگوریتم اثبات‌شدهٔ python/image-editing (تمپلیت
 * دوتنه از جفت طلایی) تا مستقیم روی بک‌اند ورسل اجرا شود — بدون پایتون،
 * بدون سرویس جانبی، بدون چیزی برای نصب.
 *
 *   • previewOne: دانلود → تشخیص → حذف → «قبل | بعد» به‌صورت data URL —
 *     هیچ چیزی در دیتابیس/استوریج تغییر نمی‌کند (دکمهٔ تست زیر هر تصویر).
 *   • applyOne: همان + تعویض درجا (کلید نسخه‌دار تازه در آروان، تامبنیل،
 *     مهر watermarkFixedAt و خروج از صف) — از همان replaceInPlace اثبات‌شده.
 *   • batch: پردازش دسته‌ای صف (hasWatermark=true) — UI حلقه می‌زند.
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export interface WmBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WmPreviewResult {
  status: 'removed' | 'not_found';
  score: number | null;
  evidence: number | null;
  scale: number | null;
  box: WmBox | null;
  ms: number;
  /** تصویر پاک‌شدهٔ کامل (JPEG) — data URL */
  afterDataUrl?: string;
  /** برش «قبل | بعد» دور واترمارک — data URL */
  compareDataUrl?: string;
}

export interface WmBatchItem {
  id: string;
  relatedId: string | null;
  status: 'removed' | 'not_found' | 'error' | 'skipped';
  score?: number | null;
  evidence?: number | null;
  ms?: number;
  error?: string;
}

export interface WmBatchResult {
  results: WmBatchItem[];
  counts: { removed: number; notFound: number; error: number; skipped: number };
  remaining: number;
}

interface DecodedImage {
  rgb: Uint8Array;
  w: number;
  h: number;
}

@Injectable()
export class PascalWatermarkService {
  private readonly logger = new Logger(PascalWatermarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  // ── دانلود و decode ──────────────────────────────────────────────────────
  /** دانلود با یک تلاش دوباره — خطاهای گذرای CDN/S3 رایج‌اند. */
  private async fetchImage(url: string): Promise<Buffer> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'user-agent': 'megan-wm-fix/1.0' },
        });
        if (!res.ok) throw AppError.badRequest(`دانلود تصویر ناموفق بود (HTTP ${res.status}).`, 'WM_DOWNLOAD');
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw AppError.badRequest('تصویر خالی است.', 'WM_DOWNLOAD');
        if (buf.length > MAX_IMAGE_BYTES) {
          throw AppError.badRequest('حجم تصویر بیش از حد مجاز است.', 'WM_DOWNLOAD');
        }
        return buf;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    if (lastErr instanceof AppError) throw lastErr;
    throw AppError.badRequest('دانلود تصویر ناموفق بود.', 'WM_DOWNLOAD');
  }

  private async decodeImage(buf: Buffer): Promise<DecodedImage> {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata().catch(() => null);
    if (!meta?.width || !meta?.height) {
      throw AppError.badRequest('تصویر قابل پردازش نیست.', 'WM_BAD_IMAGE');
    }
    const { data, info } = await sharp(buf)
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // info.channels ممکن است ۱ باشد اگر تصویر خاکستری بود — به ۳ کانال باز کن
    if (info.channels === 3) {
      return { rgb: new Uint8Array(data), w: info.width, h: info.height };
    }
    const w = info.width;
    const h = info.height;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = data[i];
      rgb[i * 3 + 1] = data[i];
      rgb[i * 3 + 2] = data[i];
    }
    return { rgb, w, h };
  }

  private static grayOf(rgb: Uint8Array, w: number, h: number): Float32Array {
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    }
    return gray;
  }

  private async encodeJpeg(rgb: Uint8Array, w: number, h: number, quality = 88): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  /** برش «قبل | بعد» دور باکس با حاشیه — همان خروجی preview_batch پایتون. */
  private async buildCompare(
    before: Uint8Array,
    after: Uint8Array,
    w: number,
    h: number,
    box: { x1: number; y1: number; x2: number; y2: number },
    margin = 30,
    zoom = 2,
  ): Promise<Buffer> {
    const cy1 = Math.max(0, box.y1 - margin);
    const cy2 = Math.min(h, box.y2 + margin);
    const cx1 = Math.max(0, box.x1 - margin);
    const cx2 = Math.min(w, box.x2 + margin);
    const cw = cx2 - cx1;
    const chh = cy2 - cy1;
    const side = new Uint8Array(cw * chh * 3 * 2);
    for (let j = 0; j < chh; j++) {
      const src = ((cy1 + j) * w + cx1) * 3;
      side.set(before.subarray(src, src + cw * 3), j * cw * 3);
      side.set(after.subarray(src, src + cw * 3), (chh + j) * cw * 3);
    }
    // قبل بالا، بعد پایین (به‌جای چپ/راست — در موبایل هم خواناست)
    const sharp = (await import('sharp')).default;
    return sharp(Buffer.from(side), { raw: { width: cw, height: chh * 2, channels: 3 } })
      .resize(cw * zoom, chh * 2 * zoom, { kernel: 'nearest' })
      .jpeg({ quality: 92 })
      .toBuffer();
  }

  private toDataUrl(jpeg: Buffer): string {
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  }

  // ── هستهٔ یک فایل ────────────────────────────────────────────────────────
  /** پردازش بدون هیچ تغییر دیتابیسی — خروجی برای preview و apply. */
  async processOne(fileId: string): Promise<WmPreviewResult & { afterJpeg: Buffer | null }> {
    const t0 = Date.now();
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw AppError.notFound('فایل یافت نشد.');
    if (file.relatedModel !== 'Product' || file.fieldKey !== 'gallery') {
      throw AppError.badRequest('این ابزار فقط برای تصاویر گالری آگهی تعریف شده است.', 'NOT_GALLERY');
    }
    const buf = await this.fetchImage(file.url);
    const { rgb, w, h } = await this.decodeImage(buf);
    const det: WmDetection | null = await detectWatermark(PascalWatermarkService.grayOf(rgb, w, h), w, h);
    const ms = Date.now() - t0;
    // فیلدهای گزارش پیش از هر narrowing محاسبه می‌شوند
    const score = det ? Math.round(det.score * 1000) / 1000 : null;
    const evidence = det ? Math.round(det.evidence * 10) / 10 : null;
    const scale = det ? Math.round(det.scale * 100) / 100 : null;
    const detBox = det ? { x: det.x, y: det.y, w: det.w, h: det.h } : null;
    if (!isStrong(det)) {
      return { status: 'not_found', score, evidence, scale, box: detBox, ms, afterJpeg: null };
    }
    const before = Buffer.from(rgb);
    const box = removeWatermarkRgb(rgb, w, h, det);
    if (!box) {
      return { status: 'not_found', score, evidence, scale, box: null, ms, afterJpeg: null };
    }
    const afterJpeg = await this.encodeJpeg(rgb, w, h);
    const compare = await this.buildCompare(new Uint8Array(before), rgb, w, h, box);
    return {
      status: 'removed',
      score,
      evidence,
      scale,
      box: detBox,
      ms: Date.now() - t0,
      afterDataUrl: this.toDataUrl(afterJpeg),
      compareDataUrl: this.toDataUrl(compare),
      afterJpeg,
    };
  }

  /** پیش‌نمایش — فقط داده برمی‌گرداند؛ هیچ چیزی ذخیره/تغییر نمی‌کند. */
  async previewOne(fileId: string): Promise<WmPreviewResult> {
    const r = await this.processOne(fileId);
    const { afterJpeg: _drop, ...out } = r;
    return out;
  }

  /** اعمال — تعویض درجا با کلید نسخه‌دار تازه (همان مسیر تعویض دستی).
   * file به شکل ردیف فرانت (ProductFileRow) برمی‌گردد تا UI همان لحظه
   * تصویر تازه (اصلی + تامبنیل) را در جای خودش نشان دهد (خواستهٔ مالک ۱۹-۱۱). */
  async applyOne(fileId: string, replacedBy: string) {
    const r = await this.processOne(fileId);
    if (r.status !== 'removed' || !r.afterJpeg) {
      const { afterJpeg: _d, ...out } = r;
      return { ...out, file: null };
    }
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw AppError.notFound('فایل یافت نشد.');
    if (!file.storageKey) {
      // فایل بدون کلید ذخیره‌سازی قابل تعویض درجا نیست — فقط گزارش
      const { afterJpeg: _d, ...out } = r;
      return { ...out, file: null, skipped: 'NO_STORAGE_KEY' };
    }
    const updated = await this.uploads.replaceInPlace(
      fileId,
      { buffer: r.afterJpeg, mimetype: 'image/jpeg', filename: file.name },
      replacedBy,
    );
    const { afterJpeg: _d, ...out } = r;
    // ردیف به شکل ProductFileRow فرانت — URLهای نسخه‌دار تازه (اصلی+تامبنیل)
    // همان لحظه کاش را در UI عوض می‌کنند؛ مهر اصلاح = همان nowِ تعویض.
    // (۲۱-۱۱) replaceInPlace حالا مهر بررسی هم می‌زند (تعویض‌شده = بررسی‌شده
    // + اصلاح‌شده) — پس ردیف برگشتی هم reviewedAt تازه دارد.
    const nowIso = updated.replacedAt;
    return {
      ...out,
      file: {
        id: file.id,
        url: updated.url,
        thumbUrl: updated.thumbUrl,
        hasWatermark: false,
        reviewedAt: nowIso,
        fixedAt: updated.replacedAt,
        relatedId: file.relatedId,
        size: updated.size,
        createdAt: file.createdAt?.toISOString() ?? '',
      },
    };
  }

  /** صف = گالری آگهی‌های علامت‌خوردهٔ قابل‌تعویض. */
  private queueWhere(exclude?: string[]) {
    const ids = (exclude ?? []).filter((v) => typeof v === 'string' && v.length === 24).slice(0, 2000);
    return {
      relatedModel: 'Product' as const,
      fieldKey: 'gallery' as const,
      hasWatermark: true,
      storageKey: { not: null },
      ...(ids.length ? { id: { notIn: ids } } : {}),
    };
  }

  /** پردازش تا limit فایل از صف — برای حلقهٔ «اصلاح خودکار» در UI. */
  async batch(limit: number, replacedBy: string, exclude?: string[]): Promise<WmBatchResult> {
    const files = await this.prisma.file.findMany({
      where: this.queueWhere(exclude),
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, relatedId: true },
    });
    const results: WmBatchItem[] = [];
    for (const f of files) {
      try {
        const r = await this.applyOne(f.id, replacedBy);
        results.push({
          id: f.id,
          relatedId: f.relatedId,
          status: r.status,
          score: r.score ?? null,
          evidence: r.evidence ?? null,
          ms: r.ms,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'خطای ناشناخته';
        this.logger.warn(`wm-batch ${f.id}: ${msg}`);
        results.push({ id: f.id, relatedId: f.relatedId, status: 'error', error: msg.slice(0, 120) });
      }
    }
    const counts = {
      removed: results.filter((r) => r.status === 'removed').length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      error: results.filter((r) => r.status === 'error').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };
    const remaining = await this.prisma.file.count({ where: this.queueWhere() });
    return { results, counts, remaining };
  }
}
