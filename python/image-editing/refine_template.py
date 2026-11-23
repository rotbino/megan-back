#!/usr/bin/env python3
"""پالایش تمپلیت (a، c) با رگرسیون چندتصویری — v4.

تمپلیت فعلی از «یک» جفت طلایی برآورد شده و خطای per-pixel آن همان
«باقی‌ماندهٔ پاککنی ناقص» است (گزارش مالک). با ۳۵۱ تصویر واقعی که همگی
مقیاس ۱٫۰۰ و تراز صحیح دارند، برای هر پیکسل:

    I_k = a·c + (1−a)·B_k        (k = 1..K تصویر)
    y_k = I_k − B̂_k = α + β·B̂_k  →  α = a·c ، β = −a

رگرسیون خطی robust (حذف پرت‌های ۲٫۵σ) روی K نمونه → (a، c) دقیق per-pixel.
نقشهٔ تشخیص d دست نمی‌خورد (تشخیص پایدار می‌ماند).

خروجی: templates/pascal-golden-v4.npz + گزارش بصری + اعتبارسنجی.
"""
import os
import sys

import cv2
import numpy as np

TOOL = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOL)

from wm.config import Config  # noqa: E402
from wm.detect import detect, is_strong  # noqa: E402
from wm.template import WatermarkTemplate  # noqa: E402

ORIG = "/home/z/my-project/scripts/wm/originals"
GOLDEN = os.path.join(TOOL, "tests", "golden-pair")

cfg = Config()
d = cfg["detect"]
tpl = WatermarkTemplate.load(cfg.resolve(cfg["template"]))
TW, TH = tpl.size
KSIZE, KSIGMA = 55, 9.0
INK_T = 0.05


def norm_bg(gray, ink_mask):
    mask = (~ink_mask).astype(np.float32)
    k = cv2.getGaussianKernel(KSIZE, KSIGMA)
    K = (k @ k.T).astype(np.float32)
    num = cv2.filter2D(gray * mask, -1, K, borderType=cv2.BORDER_REFLECT)
    den = cv2.filter2D(mask, -1, K, borderType=cv2.BORDER_REFLECT)
    return num / np.maximum(den, 1e-3)


def collect():
    """برای هر تصویر: (I_box BGR، B̂_box BGR) در مختصات تمپلیت."""
    Is, Bs = [], []
    # ماسک حذف: جوهر + هالهٔ AA + رینگ JPEG — وگرنه B̂ به سمت رنگ جوهر سوگیری
    # می‌گیرد و رگرسیون آلفا را کوچک‌تر از واقع برآورد می‌کند (خطای متغیرها)
    excl = (tpl.alpha > 0.015).astype(np.uint8)
    excl = cv2.dilate(excl, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
    for fn in sorted(os.listdir(ORIG)):
        if not fn.endswith(".main.jpg"):
            continue
        img = cv2.imread(os.path.join(ORIG, fn), cv2.IMREAD_COLOR)
        if img is None:
            continue
        det = detect(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), tpl,
                     sigma=d["sigma"], scales=tuple(d["scales"]))
        if not (det and is_strong(det, d["min_score"], d["min_evidence"])):
            continue
        if det.scale != 1.0 or det.w != TW or det.h != TH:
            continue  # فقط مقیاس ۱:۱ — هم‌تراز بی‌تغییر با قالب
        x, y = det.x, det.y
        if x < 0 or y < 0 or x + TW > img.shape[1] or y + TH > img.shape[0]:
            continue
        # ماسک جوهر در جای درستِ تصویر کامل (نه در مقیاس تمپلیت)
        full_mask = np.zeros(img.shape[:2], bool)
        full_mask[y:y + TH, x:x + TW] = excl
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        bg = norm_bg(gray, full_mask)[y:y + TH, x:x + TW]
        box = img[y:y + TH, x:x + TW].astype(np.float32)  # BGR
        Is.append(box)
        Bs.append(np.stack([bg, bg, bg], axis=2))
    return Is, Bs


def robust_fit(Is, Bs):
    """رگرسیون per-pixel: y = α + β·B̂ با حذف پرت — خروجی (a، c BGR).

    جایی که پراکندگی پس‌زمینه‌ها (Var(B̂)) کم است، برآورد بی‌دقت است →
    انقباض به سمت تمپلیت قدیم (shrinkage) تا ریسک بدتر‌شدن صفر شود.
    """
    I = np.stack(Is)  # K×TH×TW×3
    B = np.stack(Bs)
    y = I - B  # K×TH×TW×3
    w = np.ones_like(y)
    for _ in range(2):
        sw = w.sum(axis=0)                                   # TH×TW×3
        sB = (B * w).sum(axis=0)
        sy = (y * w).sum(axis=0)
        sBB = (B * B * w).sum(axis=0)
        sBy = (B * y * w).sum(axis=0)
        den = sw * sBB - sB * sB
        den = np.where(np.abs(den) < 1e-6, 1e-6, den)
        beta = (sw * sBy - sB * sy) / den                    # TH×TW×3
        alpha = (sy - beta * sB) / np.maximum(sw, 1e-6)
        resid = y - (alpha[None] + beta[None] * B)
        sigma = np.sqrt((w * resid ** 2).sum(axis=0) / np.maximum(sw, 1))
        w = (np.abs(resid) < 2.5 * sigma[None] + 1e-3).astype(np.float32)
    # آلفا از میانگین سه کانال بتا (آلفا برای هر سه کانال یکی است)
    beta_mean = beta.mean(axis=2)
    a_fit = -beta_mean
    # انقباض: واریانس B̂ بین تصاویر کم → به تمپلیت قدیم نزدیک نگه دار
    varB = B.var(axis=0).mean(axis=2)                        # TH×TW
    tau2 = 900.0   # واریانس آستانه (std=30) — زیر آن برآورد بی‌دقت است
    shrink = varB / (varB + tau2)                            # 0..1
    a = np.where(tpl.alpha > 0.02, shrink * a_fit + (1 - shrink) * tpl.alpha, 0.0)
    a = np.clip(a, 0.0, 0.97)
    # رنگ: c = α/a با گارد — فقط جایی که آلفای معتناست 
    safe = a > 0.05
    with np.errstate(divide="ignore", invalid="ignore"):
        c_fit = alpha / np.maximum(a, 0.05)[..., None]
    c_fit = np.nan_to_num(c_fit, nan=128.0, posinf=255.0, neginf=0.0)
    c_fit = np.clip(c_fit, 0.0, 255.0)
    c = np.where(safe[..., None], c_fit, tpl.color)
    return a, c


def main():
    print("جمع‌آوری نمونه‌ها...")
    Is, Bs = collect()
    print("K = %d تصویر" % len(Is))
    if len(Is) < 50:
        print("نمونه کم — لغو")
        return
    a, c = robust_fit(Is, Bs)
    print("آلفا: max=%.2f  mean(جوهر)=%.2f  تغییر نسبت به قبل: MAE=%.4f" %
          (a.max(), a[a > INK_T].mean() if (a > INK_T).any() else 0,
           float(np.abs(a - tpl.alpha)[tpl.alpha > INK_T].mean())))

    # ذخیرهٔ npz جدید: a و c پالایش‌شده، d و متا قدیمی
    z = np.load(tpl.path, allow_pickle=False)
    out = os.path.join(TOOL, "templates", "pascal-golden-v4.npz")
    np.savez(out, a=a, c=c, d=z["d"],
             **{k: z[k] for k in z.files if k not in ("a", "c", "d")})
    print("ذخیره شد:", out)

    # اعتبارسنجی روی جفت طلایی
    fidA = os.path.splitext(str(tpl.meta.get("fidA", "6af9ac07d6118900aef951a9")))[0]
    fidB = os.path.splitext(str(tpl.meta.get("fidB", "6af9ac07d6118900aef951a8")))[0]
    A = cv2.imread(os.path.join(GOLDEN, fidA + ".jpg"), cv2.IMREAD_COLOR)
    Bimg = cv2.imread(os.path.join(GOLDEN, fidB + ".jpg"), cv2.IMREAD_COLOR)
    det = detect(cv2.cvtColor(A, cv2.COLOR_BGR2GRAY), tpl, sigma=d["sigma"], scales=tuple(d["scales"]))
    m = tpl.alpha > INK_T
    x1, y1, x2, y2 = det.x, det.y, det.x + det.w, det.y + det.h

    def mae_with(alpha, color):
        reg = A[y1:y2, x1:x2].astype(np.float32)
        ga = np.clip(alpha, 0, 0.95)
        rec = (reg - ga[..., None] * color) / np.maximum(1 - ga, 0.12)[..., None]
        r = np.abs(np.clip(rec, 0, 255) - Bimg[y1:y2, x1:x2].astype(np.float32)).mean(axis=2)
        return float(r[m].mean())

    old_mae = mae_with(tpl.alpha, tpl.color)
    new_mae = mae_with(a, c)
    print("جفت طلایی — MAE حذف: قدیم=%.2f → پالایش=%.2f" % (old_mae, new_mae))

    # مقایسهٔ بصری
    vis = np.hstack([
        cv2.applyColorMap((tpl.alpha * 255).astype(np.uint8), cv2.COLORMAP_JET),
        cv2.applyColorMap((a * 255).astype(np.uint8), cv2.COLORMAP_JET),
    ])
    cv2.imwrite(os.path.join(TOOL, "output", "template-refine-vis.png"), vis)
    diff = np.abs(a - tpl.alpha)
    print("بیشترین تغییر آلفا: %.3f (در %d پیکسل > 0.05)" %
          (float(diff.max()), int((diff > 0.05).sum())))


if __name__ == "__main__":
    main()
