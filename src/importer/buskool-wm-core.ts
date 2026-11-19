/**
 * حذف واترمارک باسکول — پورت TypeScript از python/image-editing.
 *
 * همان الگوریتم اثبات‌شدهٔ زیرپروژهٔ پایتون (تمپلیت دوتنه از جفت طلایی):
 *   ۱) تشخیص: پاسخ DoG + تطبیق تمپلیت چندمقیاسی (درشت ¼ برای سرعت، سپس
 *      ریزتراز تمام‌شیفت ±۴px در تفکیک کامل) + گارد نواحی مسطح.
 *   ۲) حذف: وارون‌سازی ترکیب آلفا با رنگ — B = (I − a·c)/(1−a) — که
 *      a نقشهٔ آلفا و c رنگ جوهر است (بدنهٔ روشن + متن تیره، مستقل از زمینه).
 *
 * همهٔ ثابت‌ها عین python/image-editing/config.json هستند.
 */

import { BUSKOOL_TEMPLATE } from './buskool-template';

// ─── تنظیمات (همان config.json پایتون) ──────────────────────────────────────
const DOG_SIGMA = 7.0;
const SCALES = [0.55, 0.62, 0.7, 0.78, 0.85, 0.92, 1.0, 1.08, 1.15, 1.25, 1.35, 1.5, 1.65];
const MIN_SCORE = 0.45;
const MIN_EVIDENCE = 5.0;
const ALPHA_FLOOR = 0.12;
const INK_THRESHOLD = 0.03;
const DENOISE_SIGMA = 0.8;
const DENOISE_ABOVE = 0.35;
const COARSE_DIV = 2; // جستجوی درشت در ½ تفکیک (¼ برای تشخیص مقیاس خیلی نویزی بود)
const FINE_RANGE = 8; // پنجرهٔ ریزتراز — درشت در پله‌های ۲px می‌آید

export interface WmDetection {
  score: number;
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
  evidence: number;
}

export interface WmMaps {
  a: Float32Array; // آلفا (h×w)
  c: Float32Array; // رنگ جوهر (h×w×۳، درهم)
  d: Float32Array; // نقشهٔ تشخیص (h×w)
  w: number;
  h: number;
}

// ─── تمپلیت ──────────────────────────────────────────────────────────────────
let cachedMaps: WmMaps | null = null;

function b64ToU8(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function loadMaps(): WmMaps {
  if (cachedMaps) return cachedMaps;
  const { w, h } = BUSKOOL_TEMPLATE;
  const n = w * h;
  const a = new Float32Array(n);
  const c = new Float32Array(n * 3);
  const d = new Float32Array(n);
  const qa = b64ToU8(BUSKOOL_TEMPLATE.a);
  const qB = b64ToU8(BUSKOOL_TEMPLATE.cB);
  const qG = b64ToU8(BUSKOOL_TEMPLATE.cG);
  const qR = b64ToU8(BUSKOOL_TEMPLATE.cR);
  const qd = b64ToU8(BUSKOOL_TEMPLATE.d);
  for (let i = 0; i < n; i++) {
    a[i] = qa[i] / 255;
    // ترتیب RGB — هماهنگ با خروجی raw شارپ (تمپلیت مبنا BGR بود)
    c[i * 3] = qR[i];
    c[i * 3 + 1] = qG[i];
    c[i * 3 + 2] = qB[i];
    d[i] = (qd[i] / 127.5 - 1) * 0.65;
  }
  cachedMaps = { a, c, d, w, h };
  return cachedMaps;
}

/** تغییر مقیاس با میانگین‌گیری ناحیه‌ای (همان INTER_AREA پایتون). */
export function areaResize(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  const rx = sw / dw;
  const ry = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * ry;
    const y1 = Math.min(sh, y0 + ry);
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(sh, Math.ceil(y1));
    for (let x = 0; x < dw; x++) {
      const x0 = x * rx;
      const x1 = Math.min(sw, x0 + rx);
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(sw, Math.ceil(x1));
      let sum = 0;
      let cnt = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        const row = sy * sw;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          sum += src[row + sx] * wy * wx;
          cnt += wy * wx;
        }
      }
      out[y * dw + x] = cnt > 0 ? sum / cnt : 0;
    }
  }
  return out;
}

/** DoG تصویر خاکستری — f منهای گاوسی σ. بلور با sharp (همان GaussianBlur پایتون). */
export async function dogResponse(gray: Float32Array, w: number, h: number, sigma: number): Promise<Float32Array> {
  const sharp = (await import('sharp')).default;
  const u8 = new Uint8Array(w * h);
  for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(gray[i])));
  // نکتهٔ حیاتی: شارپ ورودی raw تک‌کاناله را (حتی بعد از blur) سه‌کاناله
  // برمی‌گرداند — باید پلهٔ کانال رعایت شود وگرنه داده جابه‌جا خوانده می‌شود.
  const { data, info } = await sharp(Buffer.from(u8), { raw: { width: w, height: h, channels: 1 } })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels === 1 ? 1 : info.channels;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = gray[i] - data[i * stride];
  return out;
}

// ─── NCC و تشخیص ────────────────────────────────────────────────────────────
function pearson(T: Float32Array, P: Float32Array, n: number): number {
  let tm = 0;
  let pm = 0;
  for (let i = 0; i < n; i++) {
    tm += T[i];
    pm += P[i];
  }
  tm /= n;
  pm /= n;
  let num = 0;
  let tv = 0;
  let pv = 0;
  for (let i = 0; i < n; i++) {
    const t = T[i] - tm;
    const p = P[i] - pm;
    num += t * p;
    tv += t * t;
    pv += p * p;
  }
  const den = Math.sqrt(tv * pv);
  return den < 1e-9 ? -1 : num / den;
}

/** NCC نرمال‌شده روی کل نقشه (CCOEFF_NORMED) — خروجی: بهترین (امتیاز، x، y). */
function bestNCC(R: Float32Array, rw: number, rh: number, T: Float32Array, tw: number, th: number, flatGuard: number) {
  const n = tw * th;
  let tMean = 0;
  for (let i = 0; i < n; i++) tMean += T[i];
  tMean /= n;
  let tVar = 0;
  for (let i = 0; i < n; i++) {
    const t = T[i] - tMean;
    tVar += t * t;
  }
  if (tVar < 1e-12) return null;
  // مجموع و مجموع‌مربع R برای پنجره‌های لغزان — جدول انباشته
  const W = rw + 1;
  const ii = new Float64Array(W * (rh + 1));
  const ii2 = new Float64Array(W * (rh + 1));
  const iab = new Float64Array(W * (rh + 1)); // مجموع |R| برای گارد مسطح
  for (let y = 0; y < rh; y++) {
    let rowSum = 0;
    let rowSum2 = 0;
    let rowAbs = 0;
    for (let x = 0; x < rw; x++) {
      const v = R[y * rw + x];
      rowSum += v;
      rowSum2 += v * v;
      rowAbs += Math.abs(v);
      ii[(y + 1) * W + (x + 1)] = ii[y * W + (x + 1)] + rowSum;
      ii2[(y + 1) * W + (x + 1)] = ii2[y * W + (x + 1)] + rowSum2;
      iab[(y + 1) * W + (x + 1)] = iab[y * W + (x + 1)] + rowAbs;
    }
  }
  const win = (tbl: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    tbl[y1 * W + x1] - tbl[y0 * W + x1] - tbl[y1 * W + x0] + tbl[y0 * W + x0];

  let bestScore = -2;
  let bestX = 0;
  let bestY = 0;
  const pw = rw - tw + 1;
  const ph = rh - th + 1;
  if (pw <= 0 || ph <= 0) return null;
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const x1 = px + tw;
      const y1 = py + th;
      const meanAbs = win(iab, px, py, x1, y1) / n;
      if (meanAbs < flatGuard) continue; // ناحیهٔ مسطح → تطبیق کاذب
      const s = win(ii, px, py, x1, y1);
      const s2 = win(ii2, px, py, x1, y1);
      const pVar = s2 - (s * s) / n;
      if (pVar < 1e-9) continue;
      // Σ(T−T̄)(P−P̄) = ΣT·P − T̄·ΣP
      let num = 0;
      for (let y = 0; y < th; y++) {
        const ro = (py + y) * rw + px;
        const to = y * tw;
        for (let x = 0; x < tw; x++) num += T[to + x] * R[ro + x];
      }
      num -= tMean * s;
      const score = num / Math.sqrt(tVar * pVar);
      if (score > bestScore) {
        bestScore = score;
        bestX = px;
        bestY = py;
      }
    }
  }
  return bestScore > -2 ? { score: bestScore, x: bestX, y: bestY } : null;
}

// ─── تشخیص ──────────────────────────────────────────────────────────────────
function evidenceOf(R: Float32Array, rw: number, x: number, y: number, w: number, h: number): number {
  let s = 0;
  for (let j = 0; j < h; j++) {
    const ro = (y + j) * rw + x;
    for (let i = 0; i < w; i++) {
      const v = R[ro + i];
      if (v > 0) s += v;
    }
  }
  return s / (w * h);
}

function stdOf(m: Float32Array, n: number): number {
  let m0 = 0;
  for (let i = 0; i < n; i++) m0 += m[i];
  m0 /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const t = m[i] - m0;
    v += t * t;
  }
  return Math.sqrt(v / n);
}

/**
 * تشخیص واترمارک — درشت (¼ تفکیک، همهٔ مقیاس‌ها) سپس ریزتراز کامل.
 * gray: تصویر خاکستری float؛ خروجی: تشخیص یا null.
 */
export async function detectWatermark(
  gray: Float32Array,
  w: number,
  h: number,
): Promise<WmDetection | null> {
  const maps = loadMaps();
  const TW = maps.w;
  const TH = maps.h;

  // ── درشت: ¼ تفکیک ──
  const cw = Math.max(1, Math.floor(w / COARSE_DIV));
  const ch = Math.max(1, Math.floor(h / COARSE_DIV));
  const cgray = areaResize(gray, w, h, cw, ch);
  const cR = await dogResponse(cgray, cw, ch, DOG_SIGMA / COARSE_DIV);

  let best = { score: -2, scale: 0, x: 0, y: 0, w: 0, h: 0 };
  for (const s of SCALES) {
    const tw = Math.round(TW * s);
    const th = Math.round(TH * s);
    if (tw < 40 || w < tw + 2 || h < th + 2) continue; // همان گارد پایتون
    const ctw = Math.round(tw / COARSE_DIV);
    const cth = Math.round(th / COARSE_DIV);
    if (ctw < 6 || cth < 4 || cw < ctw + 2 || ch < cth + 2) continue;
    const T = areaResize(maps.d, TW, TH, ctw, cth);
    if (stdOf(T, T.length) < 0.003) continue;
    const hit = bestNCC(cR, cw, ch, T, ctw, cth, 0.5);
    if (hit && hit.score > best.score) {
      best = {
        score: hit.score,
        scale: s,
        x: hit.x * COARSE_DIV,
        y: hit.y * COARSE_DIV,
        w: tw,
        h: th,
      };
    }
  }
  if (best.scale === 0) return null;

  // ── ریزتراز در تفکیک کامل: مقیاس‌های همسایه ±۰٫۰۴ و شیفت‌های ±۸px ──
  // نکته: امتیاز درشت (نیم‌تفکیک) با امتیاز ریز (تمام‌تفکیک) هم‌مقیاس نیست —
  // ریزتراز نباید با امتیاز درشت seed شود وگرنه هرگز بهترش نمی‌کند.
  const R = await dogResponse(gray, w, h, DOG_SIGMA);
  const idx = SCALES.indexOf(best.scale);
  const bases = [SCALES[idx - 1], best.scale, SCALES[idx + 1]].filter((v) => v != null);
  let fine: { score: number; scale: number; x: number; y: number; w: number; h: number } | null = null;
  for (const base of bases) {
    for (const ds of [-0.04, -0.02, 0, 0.02, 0.04]) {
      const s = base + ds;
      const tw = Math.round(TW * s);
      const th = Math.round(TH * s);
      if (tw < 40 || w < tw + 2 || h < th + 2) continue;
      const T = areaResize(maps.d, TW, TH, tw, th);
      if (stdOf(T, T.length) < 0.003) continue;
      for (let dy = -FINE_RANGE; dy <= FINE_RANGE; dy++) {
        for (let dx = -FINE_RANGE; dx <= FINE_RANGE; dx++) {
          const x = best.x + Math.round((best.w - tw) / 2) + dx;
          const y = best.y + Math.round((best.h - th) / 2) + dy;
          if (x < 0 || y < 0 || x + tw > w || y + th > h) continue;
          const patch = new Float32Array(tw * th);
          for (let j = 0; j < th; j++) {
            const ro = (y + j) * w + x;
            patch.set(R.subarray(ro, ro + tw), j * tw);
          }
          if (stdOf(patch, patch.length) < 1.0) continue;
          const sc = pearson(T, patch, tw * th);
          if (!fine || sc > fine.score) {
            fine = { score: sc, scale: s, x, y, w: tw, h: th };
          }
        }
      }
    }
  }
  if (!fine) {
    // هیچ کاندید ریز در دسترس نبود (تصویر لبه‌به‌لبه) — همان درشت
    return {
      score: best.score,
      scale: best.scale,
      x: best.x,
      y: best.y,
      w: best.w,
      h: best.h,
      evidence: evidenceOf(R, w, best.x, best.y, best.w, best.h),
    };
  }
  return {
    score: fine.score,
    scale: fine.scale,
    x: fine.x,
    y: fine.y,
    w: fine.w,
    h: fine.h,
    evidence: evidenceOf(R, w, fine.x, fine.y, fine.w, fine.h),
  };
}

export function isStrong(det: WmDetection | null): det is WmDetection {
  return det != null && det.score >= MIN_SCORE && det.evidence >= MIN_EVIDENCE;
}

// ─── حذف ────────────────────────────────────────────────────────────────────
/** بلور گاوسی جداپذیر روی ناحیهٔ کوچک (برای denoise بازسازی). */
function gaussianBlurRegion(reg: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const ksize = radius * 2 + 1;
  const k = new Float32Array(ksize);
  let ksum = 0;
  for (let i = 0; i < ksize; i++) {
    const t = (i - radius) / sigma;
    k[i] = Math.exp(-0.5 * t * t);
    ksum += k[i];
  }
  for (let i = 0; i < ksize; i++) k[i] /= ksum;
  const tmp = new Float32Array(reg.length);
  const out = new Float32Array(reg.length);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = 0; i < ksize; i++) {
          const xx = Math.min(w - 1, Math.max(0, x + i - radius));
          s += k[i] * reg[(y * w + xx) * 3 + c];
        }
        tmp[(y * w + x) * 3 + c] = s;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = 0; i < ksize; i++) {
          const yy = Math.min(h - 1, Math.max(0, y + i - radius));
          s += k[i] * tmp[(yy * w + x) * 3 + c];
        }
        out[(y * w + x) * 3 + c] = s;
      }
    }
  }
  return out;
}

/**
 * حذف واترمارک از RGB خام (Uint8 درهم ۳کاناله) — خروجی: باکس مؤثر یا null.
 * پیکسل‌های بیرون از باکس دست نمی‌خورند (همان تضمین پایتون).
 */
export function removeWatermarkRgb(
  rgb: Uint8Array,
  w: number,
  h: number,
  det: WmDetection,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const maps = loadMaps();
  const x1 = Math.max(0, det.x);
  const y1 = Math.max(0, det.y);
  const x2 = Math.min(w, det.x + det.w);
  const y2 = Math.min(h, det.y + det.h);
  if (x2 <= x1 || y2 <= y1) return null;
  const bw = x2 - x1;
  const bh = y2 - y1;
  const aFull = areaResize(maps.a, maps.w, maps.h, det.w, det.h);
  // رنگ: هر کانال جداگانه resize شود (resize تختِ درهم، کانال‌ها را قاطی می‌کرد)
  const cCh: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    const plane = new Float32Array(maps.w * maps.h);
    for (let i = 0; i < plane.length; i++) plane[i] = maps.c[i * 3 + c];
    cCh.push(areaResize(plane, maps.w, maps.h, det.w, det.h));
  }
  const ax = x1 - det.x;
  const ay = y1 - det.y;
  // ناحیهٔ کاری به‌صورت float
  const reg = new Float32Array(bw * bh * 3);
  for (let j = 0; j < bh; j++) {
    const ro = ((y1 + j) * w + x1) * 3;
    for (let i = 0; i < bw * 3; i++) reg[j * bw * 3 + i] = rgb[ro + i];
  }
  const rec = new Float32Array(bw * bh * 3);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const ai = aFull[(ay + j) * det.w + (ax + i)];
      const den = Math.max(1 - ai, ALPHA_FLOOR);
      for (let c = 0; c < 3; c++) {
        const p = j * bw * 3 + i * 3 + c;
        const cc = cCh[c][(ay + j) * det.w + (ax + i)];
        rec[p] = ai > INK_THRESHOLD ? (reg[p] - ai * cc) / den : reg[p];
      }
    }
  }
  if (DENOISE_SIGMA > 0) {
    const blur = gaussianBlurRegion(rec, bw, bh, DENOISE_SIGMA);
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        if (aFull[(ay + j) * det.w + (ax + i)] > DENOISE_ABOVE) {
          for (let c = 0; c < 3; c++) {
            const p = j * bw * 3 + i * 3 + c;
            rec[p] = blur[p];
          }
        }
      }
    }
  }
  for (let j = 0; j < bh; j++) {
    const ro = ((y1 + j) * w + x1) * 3;
    for (let i = 0; i < bw * 3; i++) {
      const v = rec[j * bw * 3 + i];
      rgb[ro + i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return { x1, y1, x2, y2 };
}
