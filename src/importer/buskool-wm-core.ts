/**
 * حذف واترمارک باسکول — پورت TypeScript از python/image-editing (v4).
 *
 * همان الگوریتم اثبات‌شدهٔ زیرپروژهٔ پایتون + دو بهبود v4:
 *   ۱) تشخیص: پاس DoG + تطبیق تمپلیت چندمقیاسی (درشت ½ + ریزتراز ±۸px
 *      تمام‌تفکیک) + گارد نواحی مسطح + «جستجوی زیرپیکسلی پیوسته» روی
 *      (ds، dx، dy) — مهرهایی که نیم‌پیکسل جابه‌جا شده‌اند (تغییر اندازهٔ
 *      عکس توسط باسکول/CDN) کامل می‌نشینند.
 *   ۲) حذف: وارون‌سازی ترکیب آلفا با رنگ — B = (I − a·c)/(1−a) — با
 *      نقشه‌های نمونه‌برداری‌شدهٔ پیوسته + «gain تطبیقی» (اگر جوهرِ باقی‌مانده
 *      به‌روشنی بیشتر از تمپلیت باشد، پاس اضافه با آن نسبت حذف می‌کند) +
 *      دینویز قوی‌تر روی جوهر پررنگ (σ=1.3).
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
const DENOISE_SIGMA = 1.3;
const DENOISE_ABOVE = 0.25;
const COARSE_DIV = 2; // جستجوی درشت در ½ تفکیک
const FINE_RANGE = 8; // پنجرهٔ ریزتراز
// v4 — جستجوی زیرپیکسلی پیوسته
const SUB_DS = [-0.012, -0.006, 0, 0.006, 0.012];
const SUB_DXY = [-0.5, -0.25, 0, 0.25, 0.5];
// v4 — gain تطبیقی
const AG_GAP = 0.35;
const AG_DAMP = 0.85;
const AG_MAX = 2;
const BG_SIGMA = 9.0;   // درون‌یابی پس‌زمینه برای برآورد gain
const BG_KSIZE = 55;
const INK_PIX = 0.05;   // حداقل آلفای «پیکسل جوهر»

export interface WmDetection {
  score: number;
  scale: number;
  x: number;
  y: number;
  w: number;
  h: number;
  evidence: number;
  dx: number; // جابه‌جایی زیرپیکسلی افقی مهر (v4)
  dy: number; // جابه‌جایی زیرپیکسلی عمودی
  sf: number; // مقیاس پیوستهٔ پالایش‌شده (۰ = همان scale)
}

export interface WmMaps {
  a: Float32Array; // آلفا (h×w)
  c: Float32Array; // رنگ جوهر (h×w×۳، درهم RGB)
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

/** بلور گاوسی جداشدنی روی نقشهٔ دوبعدی float. */
function blurMap2D(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
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
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < ksize; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i - radius));
        s += k[i] * src[row + xx];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < ksize; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i - radius));
        s += k[i] * tmp[yy * w + x];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

/** کernen گاوسی جداشدنی (برای کانولوشن نرمال‌شدهٔ پس‌زمینه). */
function gaussKernel(ksize: number, sigma: number): Float32Array {
  const radius = (ksize - 1) / 2;
  const k = new Float32Array(ksize);
  let s = 0;
  for (let i = 0; i < ksize; i++) {
    const t = (i - radius) / sigma;
    k[i] = Math.exp(-0.5 * t * t);
    s += k[i];
  }
  for (let i = 0; i < ksize; i++) k[i] /= s;
  return k;
}

/**
 * نمونه‌برداری پیوستهٔ یک نقشهٔ دوبعدی از قالب مبنا (v4).
 * پیکسل (i, j) جعبهٔ bw×bh به مختصات مبنا می‌رود: u = (i − ox)/s.
 * برای کوچک‌شده (s<1) قالب با گاوسی پیش‌تار می‌شود (ضدآلیاسینگ).
 */
function sampleMap2D(base: Float32Array, bw: number, bh: number, s: number, ox: number, oy: number): Float32Array {
  const th_ = (base.length / (BUSKOOL_TEMPLATE.w)) | 0; // h مبنا
  const tw_ = BUSKOOL_TEMPLATE.w;
  let src = base;
  if (s < 0.995) {
    const sig = 0.55 * (1.0 / s - 1.0);
    if (sig > 0.05) src = blurMap2D(base, tw_, th_, sig);
  }
  const out = new Float32Array(bw * bh);
  // ردیف‌ها/ستون‌های نمونه با وزن bilinear — جداشدنی
  const u0 = new Int32Array(bw);
  const u1 = new Int32Array(bw);
  const fu = new Float32Array(bw);
  const v0 = new Int32Array(bh);
  const v1 = new Int32Array(bh);
  const fv = new Float32Array(bh);
  for (let i = 0; i < bw; i++) {
    const u = (i - ox) / s;
    const a0 = Math.floor(u);
    u0[i] = Math.min(tw_ - 1, Math.max(0, a0));
    u1[i] = Math.min(tw_ - 1, Math.max(0, a0 + 1));
    fu[i] = Math.min(1, Math.max(0, u - a0));
  }
  for (let j = 0; j < bh; j++) {
    const v = (j - oy) / s;
    const b0 = Math.floor(v);
    v0[j] = Math.min(th_ - 1, Math.max(0, b0));
    v1[j] = Math.min(th_ - 1, Math.max(0, b0 + 1));
    fv[j] = Math.min(1, Math.max(0, v - b0));
  }
  for (let j = 0; j < bh; j++) {
    const r0 = v0[j] * tw_;
    const r1 = v1[j] * tw_;
    const w1 = fv[j];
    const w0 = 1 - w1;
    for (let i = 0; i < bw; i++) {
      const fx = fu[i];
      const gx = 1 - fx;
      const top = src[r0 + u0[i]] * gx + src[r0 + u1[i]] * fx;
      const bot = src[r1 + u0[i]] * gx + src[r1 + u1[i]] * fx;
      out[j * bw + i] = top * w0 + bot * w1;
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
 * تشخیص واترمارک — درشت (½ تفکیک، همهٔ مقیاس‌ها) سپس ریزتراز کامل و
 * جستجوی زیرپیکسلی پیوسته (v4).
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

  // ── درشت: ½ تفکیک ──
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

  // ── ریزتراز در تفکیک کامل: مقیاس‌های همسایه و شیفت‌های ±۸px ──
  const R = await dogResponse(gray, w, h, DOG_SIGMA);
  const idx = SCALES.indexOf(best.scale);
  const bases = [SCALES[idx - 1], best.scale, SCALES[idx + 1]].filter((v) => v != null);
  let fine: { score: number; scale: number; x: number; y: number; w: number; h: number } | null = null;
  for (const base of bases) {
    for (let ds = -0.04; ds <= 0.04; ds += 0.02) {
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
      dx: 0,
      dy: 0,
      sf: 0,
    };
  }

  // ── جستجوی زیرپیکسلی پیوسته (v4): (ds، dx، dy) با گام ۰٫۲۵px ──
  // نقشهٔ تشخیص با مقیاس پیوسته نمونه‌برداری می‌شود؛ جستجوی مشترک از
  // جبران بیش‌ازحدِ سهمی‌های جداگانه جلوگیری می‌کند.
  const fb = fine;
  const patch = new Float32Array(fb.w * fb.h);
  for (let j = 0; j < fb.h; j++) {
    const ro = (fb.y + j) * w + fb.x;
    patch.set(R.subarray(ro, ro + fb.w), j * fb.w);
  }
  const bestC = { score: fb.score, ds: 0, dx: 0, dy: 0 };
  if (stdOf(patch, patch.length) >= 1.0) {
    for (const ds of SUB_DS) {
      const sf = fb.scale + ds;
      if (sf <= 0.2) continue;
      for (const ddx of SUB_DXY) {
        for (const ddy of SUB_DXY) {
          if (ds === 0 && ddx === 0 && ddy === 0) continue; // خود قله
          const Tc = sampleMap2D(maps.d, fb.w, fb.h, sf, ddx, ddy);
          if (stdOf(Tc, Tc.length) < 0.003) continue;
          const sc = pearson(Tc, patch, Tc.length);
          if (sc > bestC.score) {
            bestC.score = sc;
            bestC.ds = ds;
            bestC.dx = ddx;
            bestC.dy = ddy;
          }
        }
      }
    }
  }
  const sf = fb.scale + bestC.ds;
  return {
    score: fb.score,
    scale: fb.scale,
    x: fb.x,
    y: fb.y,
    w: fb.w,
    h: fb.h,
    evidence: evidenceOf(R, w, fb.x, fb.y, fb.w, fb.h),
    dx: bestC.dx,
    dy: bestC.dy,
    sf: sf > 0.3 && sf < 2.5 ? sf : 0,
  };
}

export function isStrong(det: WmDetection | null): det is WmDetection {
  return det != null && det.score >= MIN_SCORE && det.evidence >= MIN_EVIDENCE;
}

// ─── حذف ────────────────────────────────────────────────────────────────────
/** بلور گاوسی جداشدنی روی ناحیهٔ کوچک RGB درهم (برای denoise بازسازی). */
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

/** پس‌زمینهٔ برآوردی با کانولوشن نرمال‌شده (فقط از پیکسل‌های غیرجوهر). */
function normBackgroundGray(gray: Float32Array, w: number, h: number, inkMask: Uint8Array): Float32Array {
  const k = gaussKernel(BG_KSIZE, BG_SIGMA);
  const ksize = k.length;
  const radius = (ksize - 1) / 2;
  const tnum = new Float32Array(w * h);
  const tden = new Float32Array(w * h);
  // پاس افقی: نمونه از همسایه‌های xx
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sn = 0;
      let sd = 0;
      for (let i = 0; i < ksize; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i - radius));
        const m = inkMask[row + xx] ? 0 : 1;
        sn += k[i] * gray[row + xx] * m;
        sd += k[i] * m;
      }
      tnum[row + x] = sn;
      tden[row + x] = sd;
    }
  }
  // پاس عمودی
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sn = 0;
      let sd = 0;
      for (let i = 0; i < ksize; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i - radius));
        sn += k[i] * tnum[yy * w + x];
        sd += k[i] * tden[yy * w + x];
      }
      out[y * w + x] = sn / Math.max(sd, 1e-3);
    }
  }
  return out;
}

/**
 * برآورد نسبت جوهرِ باقی‌مانده نسبت به جوهر تمپلیت (v4).
 * resid = تصویر فعلی − پس‌زمینهٔ درون‌یابی‌شده؛ gain = LSQ(resid, a·(c−B̂)).
 */
function residualGain(cur: Float32Array, a: Float32Array, cPlanes: Float32Array[],
                      bw: number, bh: number): number {
  const n = bw * bh;
  const gray = new Float32Array(n);
  const cg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (cur[i * 3] + cur[i * 3 + 1] + cur[i * 3 + 2]) / 3;
    cg[i] = (cPlanes[0][i] + cPlanes[1][i] + cPlanes[2][i]) / 3;
  }
  const ink = new Uint8Array(n);
  let nInk = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] > INK_PIX) {
      ink[i] = 1;
      nInk++;
    }
  }
  if (nInk < 30) return 0;
  const best = normBackgroundGray(gray, bw, bh, ink);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue;
    const inkT = a[i] * (cg[i] - best[i]);
    num += (gray[i] - best[i]) * inkT;
    den += inkT * inkT;
  }
  if (den < 1e-9) return 0;
  const g = num / den;
  return Math.max(-0.15, Math.min(0.95, g));
}

/** وارون‌سازی ترکیب آلفا با gain: B = (I − g·a·c)/(1 − g·a). */
function inversePass(reg: Float32Array, a: Float32Array, cPlanes: Float32Array[], gain: number): void {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const ga = Math.max(-0.6, Math.min(0.95, a[i] * gain));
    const den = Math.max(1 - ga, ALPHA_FLOOR);
    for (let c = 0; c < 3; c++) {
      const p = i * 3 + c;
      reg[p] = (reg[p] - ga * cPlanes[c][i]) / den;
    }
  }
}

/**
 * حذف واترمارک از RGB خام (Uint8 درهم ۳کاناله) — v4.
 * خروجی: باکس مؤثر یا null. پیکسل‌های بیرون از باکس دست نمی‌خورند.
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

  // نقشه‌های (a، c) — پیوسته اگر تراز زیرپیکسلی موجود است (v4)
  let a: Float32Array;
  let cPlanes: Float32Array[];
  const useSub = det.dx !== 0 || det.dy !== 0 || det.sf > 0;
  if (useSub) {
    const sf = det.sf > 0 ? det.sf : det.scale;
    const ox = det.x + det.dx - x1;
    const oy = det.y + det.dy - y1;
    a = sampleMap2D(maps.a, bw, bh, sf, ox, oy);
    cPlanes = [];
    for (let c = 0; c < 3; c++) {
      const plane = new Float32Array(maps.w * maps.h);
      for (let i = 0; i < plane.length; i++) plane[i] = maps.c[i * 3 + c];
      cPlanes.push(sampleMap2D(plane, bw, bh, sf, ox, oy));
    }
  } else {
    const ax = x1 - det.x;
    const ay = y1 - det.y;
    const aFull = areaResize(maps.a, maps.w, maps.h, det.w, det.h);
    const aCrop = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) aCrop[j * bw + i] = aFull[(ay + j) * det.w + (ax + i)];
    }
    a = aCrop;
    cPlanes = [];
    for (let c = 0; c < 3; c++) {
      const plane = new Float32Array(maps.w * maps.h);
      for (let i = 0; i < plane.length; i++) plane[i] = maps.c[i * 3 + c];
      const rs = areaResize(plane, maps.w, maps.h, det.w, det.h);
      const crop = new Float32Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) crop[j * bw + i] = rs[(ay + j) * det.w + (ax + i)];
      }
      cPlanes.push(crop);
    }
  }

  // ناحیهٔ کاری به‌صورت float (RGB درهم)
  const reg = new Float32Array(bw * bh * 3);
  for (let j = 0; j < bh; j++) {
    const ro = ((y1 + j) * w + x1) * 3;
    for (let i = 0; i < bw * 3; i++) reg[j * bw * 3 + i] = rgb[ro + i];
  }
  const reg0 = Float32Array.from(reg);

  inversePass(reg, a, cPlanes, 1.0);

  // gain تطبیقی: فقط زیرحذفیِ واضح (سوگیری برآوردگر < ۰٫۲۵ است)
  for (let it = 0; it < AG_MAX; it++) {
    const g = residualGain(reg, a, cPlanes, bw, bh);
    if (g < AG_GAP) break;
    inversePass(reg, a, cPlanes, g * AG_DAMP);
  }

  // دینویز نهایی فقط روی جوهر پررنگ
  if (DENOISE_SIGMA > 0) {
    const blur = gaussianBlurRegion(reg, bw, bh, DENOISE_SIGMA);
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        if (a[j * bw + i] > DENOISE_ABOVE) {
          for (let c = 0; c < 3; c++) {
            const p = (j * bw + i) * 3 + c;
            reg[p] = blur[p];
          }
        }
      }
    }
  }

  // نوشتن با ماسک جوهر + clip
  for (let j = 0; j < bh; j++) {
    const ro = ((y1 + j) * w + x1) * 3;
    for (let i = 0; i < bw; i++) {
      const ink = a[j * bw + i] > INK_THRESHOLD;
      for (let c = 0; c < 3; c++) {
        const p = (j * bw + i) * 3 + c;
        const v = ink ? reg[p] : reg0[p];
        rgb[ro + i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
  }
  return { x1, y1, x2, y2 };
}
