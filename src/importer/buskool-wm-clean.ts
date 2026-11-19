/**
 * پاک‌سازی واترمارک باسکول «در لحظهٔ ایمپورت» (خواستهٔ مالک ۲۰-۱۱).
 *
 * از این به بعد هیچ تصویر واترمارک‌داری وارد آروان نمی‌شود: در هر دو مسیر
 * ایمپورت (پنل ادمین دیتا-ایمپورت + پنل کاربر «ایمپورت از وب») تصویر بلافاصله
 * بعد از دانلود و قبل از ingestExternal از همین تابع رد می‌شود —
 *
 *   دانلود باسکول → normalizeImage → cleanBuskoolWatermark → ingestExternal → آروان
 *
 * همان موتور اثبات‌شدهٔ buskool-wm-core (پورت TS پایتون v4)؛ بدون DI و بدون
 * تغییر ماژول‌ها تا هر دو سرویس (ImporterService و WebImportService) مستقیم
 * import کنند.
 *
 * خروجی سه‌حالته است تا ردیف File دقیق مهر بخورد:
 *   • 'removed'    → پاک شد؛ بافر تمیز (JPEG) برمی‌گردد.
 *   • 'not_found'  → واترمارک ندارد (یا تصویر برای موتور نامناسب است)؛
 *                    بافر اصلی دست‌نخورده برمی‌گردد.
 *   • 'failed'     → واترمارک هست ولی حذف نشد (نباید بیفتد)؛ بافر اصلی
 *                    برمی‌گردد و فایل باید در صف اصلاح بماند (hasWatermark=true).
 */

import { detectWatermark, isStrong, removeWatermarkRgb } from './buskool-wm-core';

export type WmCleanStatus = 'removed' | 'not_found' | 'failed';

export interface WmCleanResult {
  /** بافر نهایی — اگر removed بود تصویر تمیز (JPEG) است، وگرنه ورودی. */
  buf: Buffer;
  /** فقط وقتی removed پر می‌شود ('image/jpeg') — وگرنه null = همان mime ورودی. */
  mimetype: string | null;
  status: WmCleanStatus;
  /** امتیاز تطبیق مهر (null = تشخیص اجرا نشد/ضعیف) */
  score: number | null;
  ms: number;
}

/** خاکستری‌سازی RGB درهم — همان فرمول buskool-wm.service. */
function grayOf(rgb: Uint8Array, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  }
  return gray;
}

/**
 * تشخیص + حذف واترمارک باسکول روی بافر خام تصویر — بدون DB، بدون استوریج.
 * هرگز استثنا نمی‌اندازد؛ در بدترین حالت ورودی را دست‌نخورده برمی‌گرداند
 * (ایمپورت هرگز به‌خاطر پاک‌سازی نمی‌شکند — سیاست «خطای رکورد رد می‌شود»).
 */
export async function cleanBuskoolWatermark(buf: Buffer): Promise<WmCleanResult> {
  const t0 = Date.now();
  const untouched = (status: WmCleanStatus, score: number | null = null): WmCleanResult => ({
    buf,
    mimetype: null, // خالی = همان mime ورودی (فراخواننده می‌داند)
    status,
    score,
    ms: Date.now() - t0,
  });

  try {
    const sharp = (await import('sharp')).default;
    // تصاویر شفاف (PNG با آلفا) ред و بی‌ربط‌اند — دست نمی‌زنیم
    const meta = await sharp(buf).metadata().catch(() => null);
    if (!meta?.width || !meta?.height || meta.hasAlpha) {
      return untouched('not_found');
    }
    const { data, info } = await sharp(buf)
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const rgb = new Uint8Array(w * h * 3);
    if (info.channels === 3) {
      rgb.set(data);
    } else if (info.channels === 1) {
      for (let i = 0; i < w * h; i++) {
        rgb[i * 3] = data[i];
        rgb[i * 3 + 1] = data[i];
        rgb[i * 3 + 2] = data[i];
      }
    } else {
      return untouched('not_found'); // کانال غیرمنتظره — بدون تغییر
    }

    const det = await detectWatermark(grayOf(rgb, w, h), w, h);
    const score = det ? Math.round(det.score * 1000) / 1000 : null;
    if (!isStrong(det)) {
      return untouched('not_found', score);
    }

    const box = removeWatermarkRgb(rgb, w, h, det);
    if (!box) {
      // مهر پیدا شد ولی باکس مؤثر خالی بود — در صف اصلاح بماند
      return untouched('failed', score);
    }

    // انکود میانی باکیفیت (۹۲) — انکود نهایی ۸۴ خود processFile است
    const cleaned = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    if (!cleaned.length) {
      return untouched('failed', score);
    }
    return { buf: cleaned, mimetype: 'image/jpeg', status: 'removed', score, ms: Date.now() - t0 };
  } catch {
    // هر خطای غیرمنتظره — تصویر اصلی می‌رود بالا (مثل قبل از این قابلیت)
    return untouched('not_found');
  }
}
