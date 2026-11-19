"""حذف واترمارک با وارون‌سازی ترکیب آلفا (مدل دوتنه).

واترمارک باسکول یک نشان دو-جوهر است: بدنهٔ روشن + متن تیره. مدل عمومی:
  I = a·c + (1−a)·B
که a نقشهٔ آلفا و c رنگ جوهر (هر پیکسل) است — هر دو مستقل از زمینه.
پس زمینهٔ اصلی: B = (I − a·c) / (1−a).

نویز JPEG در بازسازی تا ۱/(۱−a) تقویت می‌شود؛ یک گاوسی ملایم فقط روی
پیکسل‌های بازسازی‌شدهٔ پررنگ (a > denoise_above) اعمال می‌شود.
"""
import cv2
import numpy as np


def remove_watermark(img_bgr, det, tpl, alpha_floor=0.10, ink_threshold=0.03,
                     denoise_sigma=0.8, denoise_above=0.35):
    """واترمارک را از تصویر رنگی حذف می‌کند.

    خروجی: (تصویر پاک‌شده uint8، باکس مؤثر (x1,y1,x2,y2) یا None).
    تضمین: پیکسل‌های بیرون از باکس دست‌نخورده می‌مانند.
    """
    a = tpl.resized(det.w, det.h)
    c = tpl.resized_color(det.w, det.h)
    H, W = img_bgr.shape[:2]
    x, y = det.x, det.y
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(W, x + det.w), min(H, y + det.h)
    if x2 <= x1 or y2 <= y1:
        return img_bgr, None
    a = a[y1 - y:y2 - y, x1 - x:x2 - x]
    c = c[y1 - y:y2 - y, x1 - x:x2 - x]

    out = img_bgr.astype(np.float32)
    reg = out[y1:y2, x1:x2]
    # وارون‌سازی: B = (I − a·c)/(1−a) با کف برای جلوگیری از انفجار نویز
    rec = (reg - a[..., None] * c) / np.maximum(1.0 - a, alpha_floor)[..., None]
    m = (a > ink_threshold)[..., None]
    reg2 = np.where(m, rec, reg)
    if denoise_sigma and denoise_sigma > 0:
        # فقط جوهر پررنگ که نویز JPEG در آن تقویت شده است
        blur = cv2.GaussianBlur(reg2, (0, 0), denoise_sigma)
        strong = (a > denoise_above)[..., None]
        reg2 = np.where(strong, blur, reg2)
    out[y1:y2, x1:x2] = np.clip(reg2, 0, 255)
    return out.astype(np.uint8), (x1, y1, x2, y2)
