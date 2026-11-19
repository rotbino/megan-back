"""حذف واترمارک با وارون‌سازی ترکیب آلفا.

واترمارک باسکول سفیدِ نیمه‌شفاف است: I = a·W + (1−a)·B با W=255.
پس پس‌زمینهٔ اصلی قابل بازیابی است: B = (I − a·255) / (1−a).
برای پیکسل‌هایی که a به ۱ نزدیک است، کف (1−a) نویز را کنترل می‌کند و
یک گاوسی ملایم فقط روی پیکسل‌های بازسازی‌شده اعمال می‌شود.
"""
import cv2
import numpy as np


def remove_watermark(img_bgr, det, tpl, alpha_floor=0.12, ink_threshold=0.03,
                     denoise_sigma=0.7):
    """واترمارک را از تصویر رنگی حذف می‌کند.

    خروجی: (تصویر پاک‌شده uint8، باکس مؤثر (x1,y1,x2,y2) یا None).
    تضمین: پیکسل‌های بیرون از باکس دست‌نخورده می‌مانند.
    """
    a = tpl.resized(det.w, det.h)
    H, W = img_bgr.shape[:2]
    x, y = det.x, det.y
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(W, x + det.w), min(H, y + det.h)
    if x2 <= x1 or y2 <= y1:
        return img_bgr, None
    a = a[y1 - y:y2 - y, x1 - x:x2 - x]

    out = img_bgr.astype(np.float32)
    reg = out[y1:y2, x1:x2]
    # وارون‌سازی: B = (I − a·W)/(1−a) با کف برای جلوگیری از انفجار نویز
    rec = (reg - a[..., None] * 255.0) / np.maximum(1.0 - a, alpha_floor)[..., None]
    m = (a > ink_threshold)[..., None]
    reg2 = np.where(m, rec, reg)
    if denoise_sigma and denoise_sigma > 0:
        blur = cv2.GaussianBlur(reg2, (0, 0), denoise_sigma)
        reg2 = np.where(m, blur, reg2)
    out[y1:y2, x1:x2] = np.clip(reg2, 0, 255)
    return out.astype(np.uint8), (x1, y1, x2, y2)
