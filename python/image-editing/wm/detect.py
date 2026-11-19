"""تشخیص واترمارک: پاسخ DoG + تطبیق تمپلیت آلفا در چند مقیاس + ریزتراز.

الگوریتم همان نسخهٔ ارزیابی‌شده (detect v2) است:
- پاسخ DoG (تصویر منهای گاوسی‌مش) لبه‌های واترمارک را برجسته می‌کند؛
- تطبیق TM_CCOEFF_NORMED در ۱۳ مقیاس + گارد ضد تطبیق‌های degenerate روی نواحی مسطح؛
- ریزتراز ±۵ پیکسل و ±۰٫۰۴ مقیاس با همبستگی پیرسون دستی؛
- «شواهد» = میانگین پاسخ مثبت DoG داخل ناحیهٔ تطبیق — ضد تطبیق‌های کاذب.
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

    @property
    def bbox(self):
        return self.x, self.y, self.x + self.w, self.y + self.h


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
    return Detection(sc, s, x, y, tw, th, _evidence(R, x, y, tw, th))


def is_strong(det, min_score=0.45, min_evidence=5.0):
    """تشخیص قابل‌اتکاست؟ (هر دو شرط: همبستگی و شواهد)."""
    return det is not None and det.score >= min_score and det.evidence >= min_evidence
