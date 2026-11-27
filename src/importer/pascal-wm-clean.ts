/**
 * پاک‌سازی واترمارک پاسکال «در لحظهٔ ایمپورت» (خواستهٔ مالک ۲۰-۱۱).
 *
 * از این به بعد هیچ تصویر واترمارک‌داری وارد آروان نمی‌شود: در هر دو مسیر
 * ایمپورت (پنل ادمین دیتا-ایمپورت + پنل کاربر «ایمپورت از وب») تصویر بلافاصله
 * بعد از دانلود و قبل از ingestExternal از همین تابع رد می‌شود —
 *
 *   دانلود پاسکال → normalizeImage → cleanPascalWatermark → ingestExternal → آروان
 *
 * همان موتور اثبات‌شدهٔ pascal-wm-core (پورت TS پایتون v4)؛ بدون DI و بدون
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

import { detectWatermark, isStrong, removeWatermarkRgb, inpaintBox, type WmDetection } from './pascal-wm-core';

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

/** خاکستری‌سازی RGB درهم — همان فرمول pascal-wm.service. */
function grayOf(rgb: Uint8Array, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  }
  return gray;
}

/**
 * تشخیص + حذف واترمارک پاسکال روی بافر خام تصویر — بدون DB، بدون استوریج.
 * هرگز استثنا نمی‌اندازد؛ در بدترین حالت ورودی را دست‌نخورده برمی‌گرداند
 * (ایمپورت هرگز به‌خاطر پاک‌سازی نمی‌شکند — سیاست «خطای رکورد رد می‌شود»).
 */
/** کالیبرهٔ «بج روشن» برای یک تشخیص مرزی — همان ملاک badgeResidual ولی
 *  مستقیم روی تصویر کامل و باکس det (بدون کپی ناحیه). */
function badgeResidualOf(rgb: Uint8Array, w: number, h: number, det: WmDetection): boolean {
  const x1 = Math.max(0, det.x);
  const y1 = Math.max(0, det.y);
  const x2 = Math.min(w, det.x + det.w);
  const y2 = Math.min(h, det.y + det.h);
  if (x2 <= x1 || y2 <= y1) return false;
  const bw = x2 - x1;
  const bh = y2 - y1;
  let innerSum = 0;
  const innerN = bw * bh;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const p = ((y1 + j) * w + x1 + i) * 3;
      innerSum += 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
    }
  }
  const M = 12;
  let ringSum = 0;
  let ringN = 0;
  for (let j = -M; j < bh + M; j++) {
    for (let i = -M; i < bw + M; i++) {
      if (i >= 0 && i < bw && j >= 0 && j < bh) continue;
      const X = x1 + i;
      const Y = y1 + j;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const p = (Y * w + X) * 3;
      ringSum += 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
      ringN++;
    }
  }
  if (!ringN || !innerN) return false;
  // پنجرهٔ [۱۰..۶۰] (کالیبره روی ۱۲ نمونهٔ برچسب‌دار ۲۷-۱۱): بجِ نیمه‌شفافِ
  // واترمارک diff متوسط (۱۱–۵۰) می‌سازد؛ ناحیهٔ روشنِ طبیعی تصویر تمیز (جعبهٔ
  // سفید/آسمان) diff بزرگ (>۶۰) دارد و بافت یکنواختِ بدون تفاوت (<۱۰) رد می‌شود.
  const diff = innerSum / innerN - ringSum / ringN;
  return diff >= 10 && diff <= 60;
}

export async function cleanPascalWatermark(buf: Buffer): Promise<WmCleanResult> {
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
    // (۲۷-۱۱) گارد «بج سفید» در تشخیص: واترمارک نوین پاسکال (بج روشن + حروف
    // سرمه‌ای) گرایش تمپلیت را ضعیف می‌کند (score ~0.35-0.45 زیر آستانهٔ 0.45)
    // ولی باکسش دقیق روی بج می‌نشیند و ناحیه معیباً روشن‌تر از زمینه است.
    // شرط اضافه: score مرزی ≥0.35 + بج روشنِ باکس → حذف با درون‌یابی اجرا شود.
    const BORDER_SCORE = 0.35;
    const det2: WmDetection | null = det;
    const borderBadge = det2 != null && det2.score >= BORDER_SCORE && badgeResidualOf(rgb, w, h, det2);
    if (!isStrong(det) && !borderBadge) {
      return untouched('not_found', score);
    }
    // حذف: مرزی-بج → مستقیم درون‌یابی باکس (بدون پاس تمپلیت — تمپلیتِ حروف
    // تک‌لایه برای واترمارک بج‌دار تناسب ندارد و فقط ناحیه را خراب می‌کند)
    if (!isStrong(det) && det2 != null && borderBadge) {
      // باکس det در عکس‌های بج‌دار اغلب فقط قلو پایینی بج را می‌گیرد — باکس را
      // با پدِ نیم‌ارتفاع/نیم‌عرض در چهار جهت باز می‌کنیم تا کل بج (حروف + زمینهٔ
      // گرد) داخل درون‌یابی بیفتد (بج واقعی ~۹۹x۲۹ ولی det فقط ~۷۵x۲۷ پایینی)
      const { x, y, w: dw, h: dh } = det2;
      const px = dw; // پد کامل هر بُعد — باکس ۲x۲ گسترده تا کل بج (حروف + پس‌زمینهٔ گرد) بنشیند
      const py = dh;
      inpaintBox(
        rgb, w, h,
        Math.max(0, x - px),
        Math.max(0, y - py),
        Math.min(w, x + dw + px),
        Math.min(h, y + dh + py),
      );
      const cleanedBadge = await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      if (cleanedBadge.length) {
        return { buf: cleanedBadge, mimetype: 'image/jpeg', status: 'removed', score, ms: Date.now() - t0 };
      }
      return untouched('failed', score);
    }

    // اینجا det قطعاً غیر-null است: یا isStrong(det) یا مسیر مرزی-بج بالاتر برگشته
    const box = removeWatermarkRgb(rgb, w, h, det as WmDetection);
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
