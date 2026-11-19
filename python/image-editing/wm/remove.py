"""حذف واترمارک با وارون‌سازی ترکیب آلفا (مدل دوتنه) — نسخهٔ v4.

واترمارک باسکول یک نشان دو-جوهر است: بدنهٔ روشن + متن تیره. مدل عمومی:
  I = a·c + (1−a)·B
که a نقشهٔ آلفا و c رنگ جوهر (هر پیکسل) است — هر دو مستقل از زمینه.
پس زمینهٔ اصلی: B = (I − a·c) / (1−a).

v4 — دو بهبود برای «باقی‌ماندهٔ پاککنی ناقص» (گزارش مالک ۱۹-۱۱):
۱) تراز زیرپیکسلی: نقشهٔ (a, c) با مقیاس پیوستهٔ sf و شیفت (dx, dy) از
   قالب مبنا نمونه‌برداری می‌شود (bilinear + پیش‌تار ضدآلیاسینگ) — مهرهایی
   که بر اثر تغییر اندازهٔ عکس نیم‌پیکسل جابه‌جا شده‌اند کامل می‌نشینند.
۲) gain تطبیقی: پس از پاس استاندارد، اگر جوهرِ باقی‌مانده «به‌روشنی» بیشتر
   از تمپلیت باشد (برآورد با پس‌زمینهٔ درون‌یابی‌شده)، یک پاس اضافه با آن
   نسبت (میراشده) حذف می‌کند — مثل پاککنی که چند بار轻轻 می‌کشد. آستانهٔ
   بالا (۰٫۳۵) تضمین می‌کند تصاویری که از قبل تمیزند دست نخورند بمانند.

نویز JPEG در بازسازی تا ۱/(۱−a) تقویت می‌شود؛ یک گاوسی ملایم فقط روی
پیکسل‌های بازسازی‌شدهٔ پررنگ (a > denoise_above) اعمال می‌شود.
"""
import cv2
import numpy as np

_BG_SIGMA = 9.0      # سیگمای درون‌یابی پس‌زمینه برای برآورد gain
_BG_KSIZE = 55       # اندازهٔ هستهٔ گاوسی جداشدنی
_INK_PIX = 0.05      # حداقل آلفا برای «پیکسل جوهر» در برآورد gain


def _background(gray, ink_mask):
    """پس‌زمینهٔ برآوردی با کانولوشن نرمال‌شده (فقط از پیکسل‌های غیرجوهر)."""
    mask = (~ink_mask).astype(np.float32)
    k = cv2.getGaussianKernel(_BG_KSIZE, _BG_SIGMA)
    K = (k @ k.T).astype(np.float32)
    num = cv2.filter2D(gray * mask, -1, K, borderType=cv2.BORDER_REFLECT)
    den = cv2.filter2D(mask, -1, K, borderType=cv2.BORDER_REFLECT)
    return num / np.maximum(den, 1e-3)


def residual_gain(reg, a, c):
    """برآورد نسبت جوهرِ باقی‌مانده نسبت به جوهر تمپلیت.

    resid = تصویر فعلی − پس‌زمینهٔ درون‌یابی‌شده
    ink_t = a·(c_gray − پس‌زمینه)   (جوهر تمپلیت روی همین زمینه)
    gain = ⟨resid·ink_t⟩ / ⟨ink_t²⟩ (کمترین مربعات)
    """
    gray = reg.mean(axis=2)
    cg = c.mean(axis=2)
    m = a > _INK_PIX
    if m.sum() < 30:
        return 0.0
    best = _background(gray, m)
    resid = gray - best
    ink_t = a * (cg - best)
    den = float((ink_t[m] ** 2).sum())
    if den < 1e-9:
        return 0.0
    return float(np.clip((resid[m] * ink_t[m]).sum() / den, -0.15, 0.95))


def _inverse(reg, a, c, gain, alpha_floor):
    ga = np.clip(a * gain, -0.60, 0.95)
    den = np.maximum(1.0 - ga, alpha_floor)
    return (reg - ga[..., None] * c) / den[..., None]


def remove_watermark(img_bgr, det, tpl, alpha_floor=0.10, ink_threshold=0.03,
                     denoise_sigma=0.8, denoise_above=0.35,
                     subpixel=True, ag_gap=0.35, ag_damp=0.85, ag_max=2):
    """واترمارک را از تصویر رنگی حذف می‌کند (v4).

    خروجی: (تصویر پاک‌شده uint8، باکس مؤثر (x1,y1,x2,y2) یا None).
    تضمین: پیکسل‌های بیرون از باکس دست‌نخورده می‌مانند.
    """
    H, W = img_bgr.shape[:2]
    x, y = det.x, det.y
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(W, x + det.w), min(H, y + det.h)
    if x2 <= x1 or y2 <= y1:
        return img_bgr, None
    bw, bh = x2 - x1, y2 - y1

    if subpixel and (getattr(det, "dx", 0.0) or getattr(det, "dy", 0.0)
                     or getattr(det, "sf", 0.0) > 0):
        sf = det.scale_f
        # گوشهٔ پیوستهٔ مهر نسبت به گوشهٔ صحیح جعبه
        ox = (x + det.dx) - x1
        oy = (y + det.dy) - y1
        a, c = tpl.sample_maps(bw, bh, sf, ox, oy)
    else:
        a = tpl.resized(det.w, det.h)[y1 - y:y2 - y, x1 - x:x2 - x]
        c = tpl.resized_color(det.w, det.h)[y1 - y:y2 - y, x1 - x:x2 - x]

    reg = img_bgr[y1:y2, x1:x2].astype(np.float32)
    cur = _inverse(reg, a, c, 1.0, alpha_floor)
    # ماسک جوهر: بیرون از جوهر (a ≤ ink_threshold) پیکسل دست‌نخورده می‌ماند —
    # بازسازی در آلفای صفر فقط نویز JPEG را تقویت می‌کند
    mm = (a > ink_threshold)[..., None]

    # gain تطبیقی: فقط زیرحذفیِ واضح (سوگیریِ برآوردگر روی زمینه‌های شلوغ
    # معمولاً < ۰٫۲۵ است؛ آستانهٔ ۰٫۳۵ بالاتر از آن است)
    for _ in range(max(0, ag_max)):
        g = residual_gain(cur, a, c)
        if g < ag_gap:
            break
        nxt = _inverse(cur, a, c, g * ag_damp, alpha_floor)
        cur = np.where(mm, nxt, cur)

    if denoise_sigma and denoise_sigma > 0:
        # فقط جوهر پررنگ که نویز JPEG در آن تقویت شده است
        blur = cv2.GaussianBlur(cur, (0, 0), denoise_sigma)
        strong = (a > denoise_above)[..., None]
        cur = np.where(strong, blur, cur)

    out = img_bgr.astype(np.float32)
    out[y1:y2, x1:x2] = np.clip(np.where(mm, cur, reg), 0, 255)
    return out.astype(np.uint8), (x1, y1, x2, y2)
