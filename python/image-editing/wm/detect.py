"""تشخیص واترمارک: پاسخ DoG + تطبیق تمپلیت آلفا در چند مقیاس + ریزتراز.

الگوریتم همان نسخهٔ ارزیابی‌شده (detect v2) است:
- پاسخ DoG (تصویر منهای گاوسی‌مش) لبه‌های واترمارک را برجسته می‌کند؛
- تطبیق TM_CCOEFF_NORMED در ۱۳ مقیاس + گارد ضد تطبیق‌های degenerate روی نواحی مسطح؛
- ریزتراز ±۸ پیکسل و ±۰٫۰۴ مقیاس با همبستگی پیرسون دستی؛
- «شواهد» = میانگین پاسخ مثبت DoG داخل ناحیهٔ تطبیق — ضد تطبیق‌های کاذب.

v4 — تراز زیرپیکسلی: قلهٔ سطح امتیاز ریزتراز با سهمی در x و y و مقیاس
به‌دقت زیرپیکسل می‌رسد (dx، dy، sf در Detection). حذف با همین مقادیر
نقشه‌ها را پیوسته نمونه‌برداری می‌کند — جابه‌جایی نیم‌پیکسلی مهر (بر اثر
تغییر اندازهٔ عکس توسط باسکول/CDN) دیگر «باقی‌ماندهٔ لبه‌مانند» نمی‌گذارد.
"""
from dataclasses import dataclass

import cv2
import numpy as np

DEFAULT_SCALES = (0.55, 0.62, 0.7, 0.78, 0.85, 0.92, 1.0, 1.08, 1.15, 1.25, 1.35, 1.5, 1.65)


@dataclass
class Detection:
    score: float      # همبستگی بهترین تطبیق
    scale: float      # مقیاس تمپلیت نسبت به قالب مبنا
    x: int            # گوشهٔ چپ-بالا
    y: int
    w: int
    h: int
    evidence: float   # میانگین پاسخ مثبت DoG داخل ناحیه
    dx: float = 0.0   # جابه‌جایی زیرپیکسلی افقی مهر نسبت به (x, y)
    dy: float = 0.0   # جابه‌جایی زیرپیکسلی عمودی
    sf: float = 0.0   # مقیاس پالایش‌شدهٔ سهمی (۰ = ناموجود؛ از scale استفاده کن)

    @property
    def bbox(self):
        return self.x, self.y, self.x + self.w, self.y + self.h

    @property
    def scale_f(self):
        return self.sf if self.sf > 0 else self.scale


def dog_response(gray, sigma=7.0):
    f = gray.astype(np.float32)
    return f - cv2.GaussianBlur(f, (0, 0), sigma)


def _pearson(T, patch):
    tv, pv = T - T.mean(), patch - patch.mean()
    denom = float(np.sqrt((tv ** 2).sum() * (pv ** 2).sum()))
    if denom < 1e-6:
        return -1.0
    return float((tv * pv).sum() / denom)


def _evidence(R, x, y, w, h):
    return float(np.clip(R[y:y + h, x:x + w], 0, None).mean())


def _parabola_peak(m, c, p):
    """افست زیرپیکسلی قله با برازش سهمی روی سه نمونهٔ (−۱، ۰، +۱)."""
    den = m - 2 * c + p
    if abs(den) < 1e-9:
        return 0.0
    return float(np.clip(0.5 * (m - p) / den, -1.0, 1.0))


def _detect_map_sub(tpl, w, h, s, dx, dy):
    """نقشهٔ تشخیص نمونه‌برداری‌شده برای جستجوی زیرپیکسلی."""
    return tpl.sample_detect(w, h, s, dx, dy)


def detect(gray, tpl, sigma=7.0, scales=DEFAULT_SCALES, fine=True):
    """بهترین تطبیق واترمارک را در تصویر خاکستری پیدا می‌کند.

    خروجی: Detection یا None (اگر هیچ مقیاسی جا نشد).
    """
    R = dog_response(gray, sigma)
    H, W = gray.shape[:2]
    TW, TH = tpl.size

    best = (0.0, None, None, None)  # score, scale, (x,y), (w,h)
    for s in scales:
        tw, th = int(round(TW * s)), int(round(TH * s))
        if tw < 40 or W < tw + 2 or H < th + 2:
            continue
        T = tpl.resized_detect(tw, th)
        if T.std() < 0.003:
            continue
        res = cv2.matchTemplate(R, T, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)
        # ناحیهٔ degenerate (تقریباً مسطح) → تطبیق کاذب؛ صفرش کن
        win_var = cv2.matchTemplate(
            np.abs(R), np.ones((th, tw), np.float32), cv2.TM_CCORR
        ) / (th * tw)
        res[win_var < 1.0] = 0.0
        _, sc, _, loc = cv2.minMaxLoc(res)
        if sc > best[0]:
            best = (float(sc), s, loc, (tw, th))

    if best[1] is None:
        return None

    if not fine:
        sc, s, (x, y), (tw, th) = best
        return Detection(sc, s, x, y, tw, th, _evidence(R, x, y, tw, th))

    # ریزتراز: ±۸px (همهٔ شیفت‌های صحیح، از جمله صفر!) و ±۰٫۰۴ مقیاس
    fine_best = best
    sc0, s0, (x0, y0), (tw0, th0) = best
    for s in (s0 - 0.04, s0 - 0.02, s0, s0 + 0.02, s0 + 0.04):
        tw, th = int(round(TW * s)), int(round(TH * s))
        if tw < 40 or W < tw + 2 or H < th + 2:
            continue
        T = tpl.resized_detect(tw, th)
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                x = x0 + int(round((tw0 - tw) / 2)) + dx
                y = y0 + int(round((th0 - th) / 2)) + dy
                if x < 0 or y < 0 or x + tw > W or y + th > H:
                    continue
                patch = R[y:y + th, x:x + tw]
                if patch.std() < 1.0 or T.std() < 0.003:
                    continue
                sc = _pearson(T, patch)
                if sc > fine_best[0]:
                    fine_best = (sc, s, (x, y), (tw, th))

    sc, s, (x, y), (tw, th) = fine_best
    det = Detection(sc, s, x, y, tw, th, _evidence(R, x, y, tw, th))

    # ── تراز زیرپیکسلی (v4): جستجوی پیوستهٔ محدود روی (ds، dx، dy) ──
    # نقشهٔ تشخیص با مقیاس پیوسته نمونه‌برداری می‌شود؛ جستجو در ±۰٫۵px و
    # ±۰٫۰۱۲ مقیاس با گام ۰٫۲۵px — سهمی مستقیم روی سطح امتیاز، ds و dx را
    # به‌هم قاطی می‌کرد (جبران بیش‌ازحد)؛ جستجوی مشترک این را حذف می‌کند.
    best_c = (sc, 0.0, 0.0, 0.0)  # (score, ds, dx, dy)
    for ds in (-0.012, -0.006, 0.0, 0.006, 0.012):
        sf = s + ds
        if sf <= 0.2:
            continue
        for ddx in (-0.5, -0.25, 0.0, 0.25, 0.5):
            for ddy in (-0.5, -0.25, 0.0, 0.25, 0.5):
                if ds == 0.0 and ddx == 0.0 and ddy == 0.0:
                    continue  # خودِ قله را دوباره نمی‌سنجیم
                Tc = _detect_map_sub(tpl, tw, th, sf, ddx, ddy)
                if Tc.std() < 0.003:
                    continue
                patch = R[y:y + th, x:x + tw]
                if patch.std() < 1.0:
                    continue
                scc = _pearson(Tc, patch)
                if scc > best_c[0]:
                    best_c = (scc, ds, ddx, ddy)
    _, ds, ddx, ddy = best_c
    det.dx = float(ddx)
    det.dy = float(ddy)
    sf = s + ds
    if 0.3 < sf < 2.5:
        det.sf = float(sf)
    return det


def is_strong(det, min_score=0.45, min_evidence=5.0):
    """تشخیص قابل‌اتکاست؟ (هر دو شرط: همبستگی و شواهد)."""
    return det is not None and det.score >= min_score and det.evidence >= min_evidence
