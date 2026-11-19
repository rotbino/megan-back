#!/usr/bin/env python3
"""ساخت تمپلیت (آلفا + رنگ) واترمارک دوتنهٔ باسکول — نسخهٔ ۳.

کشف کلیدی: نشان باسکول یک PNG نیمه‌شفاف با دو جوهر تخت است:
  - بدنه/قاب روشن:  I = a_f·c_f + (1−a_f)·B   (a_f≈0.51, c_f≈241)
  - متن/الگوی تیره: I = a_t·c_t + (1−a_t)·B   (a_t≈0.43, c_t≈46)
لبه‌های anti-alias بین این دو و با زمینه می‌درخشند.

از «جفت طلایی» (دو عکس پیکسل‌یکسان با مهر در دو جای متفاوت) هر پیکسلِ قالب
با جستجوی پارامتریک (t = میزان جوهر تیره) و فرم بستهٔ آلفا برآورد می‌شود؛
خروجی: نقشهٔ a (H×W) و c (H×W×۳) مستقل از زمینه — قابل استفاده روی هر عکس.

مثال:
    python3 build_template.py \\
        --a A.jpg --b B.jpg \\
        --box-a 433,201,543,239 --box-b 97,344,207,375 \\
        --out templates/buskool-golden.npz
"""
import argparse
import os

import cv2
import numpy as np

MIN_DENOM = 20.0


def parse_box(s):
    parts = [int(v) for v in s.split(",")]
    if len(parts) != 4:
        raise ValueError("باکس باید x1,y1,x2,y2 باشد")
    return parts


def imprint_bbox(D, sign, box, margin=55, min_area=40):
    H, W = D.shape
    x1, y1, x2, y2 = box
    zone = np.zeros((H, W), np.uint8)
    zone[max(0, y1 - margin):y2 + margin, max(0, x1 - margin):x2 + margin] = 1
    m_ = (D > 8) if sign > 0 else (D < -8)
    mk = ((m_ & (zone > 0)).astype(np.uint8))
    mk = cv2.morphologyEx(mk, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    ncc, lab, stats, _ = cv2.connectedComponentsWithStats(mk)
    keep = np.zeros_like(mk)
    areas = [(int(stats[c, cv2.CC_STAT_AREA]), c) for c in range(1, ncc)
             if stats[c, cv2.CC_STAT_AREA] >= min_area]
    if not areas:
        raise ValueError("مهر در ناحیهٔ داده‌شده پیدا نشد")
    biggest = max(a for a, _ in areas)
    for _, c in areas:
        if stats[c, cv2.CC_STAT_AREA] >= max(biggest * 0.4, min_area):
            keep[lab == c] = 1
    ys, xs = np.where(keep > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def frame_edges(a_white, thr=0.25, frac=0.5):
    rows = (a_white > thr).sum(axis=1) / a_white.shape[1]
    cols = (a_white > thr).sum(axis=0) / a_white.shape[0]
    ridx = np.where(rows > frac)[0]
    cidx = np.where(cols > frac)[0]
    if len(ridx) == 0 or len(cidx) == 0:
        return None
    return int(cidx.min()), int(ridx.min()), int(cidx.max()) + 1, int(ridx.max()) + 1


def solve_flat_constants(I_A, C_A, I_B, C_B, valid, fill_m, text_m):
    """ثابت‌های دقیق دو جوهر از ناحیه‌های هسته — حل میانگین ناحیه‌ای دو-مشاهده‌ای.

    میانگین‌گیری روی ناحیهٔ تخت، نویز JPEG را (√n) کوچک می‌کند؛
    سپس a = 1 − (Ī_A−Ī_B)/(C̄_A−C̄_B) و c از ترکیب دو مشاهده.
    """
    out = {}
    for name, m in (("fill", fill_m), ("text", text_m)):
        if m.sum() < 30:
            raise ValueError("هستهٔ %s برای برآورد ثابت‌ها کوچک است (%d)" % (name, int(m.sum())))
        gA = I_A[m].mean(0); gB = I_B[m].mean(0)
        cA = C_A[m].mean(0); cB = C_B[m].mean(0)
        dC = cA - cB
        ok = np.abs(dC) > 3
        if ok.sum() < 1:
            raise ValueError("زمینهٔ زیر %s در دو مشاهده تقریباً یکسان است" % name)
        a_ch = 1 - (gA - gB)[ok] / dC[ok]
        a = float(np.clip(np.median(a_ch), 0.05, 0.8))
        c = ((gA - (1 - a) * cA) + (gB - (1 - a) * cB)) / (2 * a)
        out[name] = (a, np.clip(c, 0, 255))
    return out


def classify(I, C, valid, a_f, c_f, a_t, c_t, margin=6.0):
    """طبقه‌بندی بدنه/متن با برازش دو جوهر."""
    def fit(I, C, c_k):
        d = c_k[None, None, :] - C
        r = I - C
        den = (d * d).sum(2)
        a = np.clip(np.where(den > 1e-3, (r * d).sum(2) / np.maximum(den, 1e-3), 0), 0, 0.95)
        pred = a[..., None] * c_k + (1 - a[..., None]) * C
        return a, ((pred - I) ** 2).sum(2)
    aF, eF = fit(I, C, c_f)
    aT, eT = fit(I, C, c_t)
    is_fill = (eF < eT - margin) & (np.abs(aF - a_f) < 0.10)
    is_text = (eT < eF - margin) & (np.abs(aT - a_t) < 0.10)
    return is_fill, is_text


def estimate_maps(I_A, C_A, I_B, C_B, valid):
    """نقشهٔ (a, c) نهایی: طبقه‌بندی تخت + لبهٔ AA با میانگین همسایگی."""
    H, W = I_A.shape[:2]
    IB0 = np.nan_to_num(I_B); CB0 = np.nan_to_num(C_B)

    # دو گذر: ثابت‌های اولیه → طبقه‌بندی → ثابت‌های دقیق → طبقه‌بندی نهایی
    D = I_A.mean(2) - C_A.mean(2)
    fill0 = valid & (D > 15) & (D < 70)
    text0 = valid & (D < -4)
    cons = solve_flat_constants(I_A, C_A, IB0, CB0, valid, fill0, text0)
    (a_f, c_f), (a_t, c_t) = cons["fill"], cons["text"]

    is_fill, is_text = classify(I_A, C_A, valid, a_f, c_f, a_t, c_t)
    is_fillB, is_textB = classify(IB0, CB0, valid, a_f, c_f, a_t, c_t)
    is_fill &= valid & (is_fillB | ~is_textB)
    is_text &= valid & (is_textB | ~is_fillB)

    a_map = np.zeros((H, W), np.float32)
    c_map = np.full((H, W, 3), 255.0, np.float32)
    a_map[is_fill] = a_f
    c_map[is_fill] = c_f
    a_map[is_text] = a_t
    c_map[is_text] = c_t

    # لبه‌ها: t-grid دو-مشاهده‌ای (بدون هموارسازی — بلور، لبهٔ تیز قاب را خراب می‌کرد)
    D_A = I_A.mean(2) - C_A.mean(2)
    D_B = np.nan_to_num(IB0.mean(2) - CB0.mean(2))
    sup = (np.abs(D_A) > 2.5) | (valid & (np.abs(D_B) > 2.5))
    sup = cv2.dilate(sup.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    edge = sup & ~is_fill & ~is_text
    if edge.any():
        TS = np.linspace(0, 1, 41)
        best_err = np.full((H, W), np.inf, np.float64)
        best_a = np.zeros((H, W), np.float32)
        best_c = np.full((H, W, 3), 255.0, np.float32)
        for t in TS:
            c = (c_t + t * (c_f - c_t)).astype(np.float32)
            num = np.zeros((H, W), np.float64)
            den = np.zeros((H, W), np.float64)
            for I, C, w in ((I_A, C_A, 1.0), (IB0, CB0, valid.astype(np.float64))):
                d = c[None, None, :] - C
                r = I - C
                num += w * (r * d).sum(2)
                den += w * (d * d).sum(2)
            a = np.clip(np.where(den > 1e-3, num / np.maximum(den, 1e-3), 0), 0, 0.60)
            err = np.zeros((H, W), np.float64)
            for I, C, w in ((I_A, C_A, 1.0), (IB0, CB0, valid.astype(np.float64))):
                pred = a[..., None] * c + (1 - a[..., None]) * C
                err += w * ((pred - I) ** 2).sum(2)
            upd = edge & (err < best_err)
            best_err = np.where(upd, err, best_err)
            best_a = np.where(upd, a, best_a).astype(np.float32)
            best_c[upd] = c
        a_map = np.where(edge, best_a, a_map)
        c_map = np.where(edge[..., None], best_c, c_map)

    a_map = np.where(sup, a_map, 0.0)

    # پالایش ثابت‌ها: جستجوی مشترک (a, c) روی پیکسل‌های تخت هر دو مشاهده
    def refine(cls, a0, c0, a_rng, c_rng, tag):
        if cls.sum() < 60:
            return a0, c0
        best = (1e18, a0, c0)
        for a in np.arange(a_rng[0], a_rng[1] + 1e-9, 0.01):
            for cg in np.arange(c_rng[0], c_rng[1] + 1e-9, 2.0):
                cc = c0 + (cg - c0.mean())
                e = 0.0
                for I, C in ((I_A, C_A), (IB0, CB0)):
                    rec = (I[cls] - a * cc) / (1 - a)
                    e += float(np.abs(rec - C[cls]).mean())
                if e < best[0]:
                    best = (e, float(a), np.clip(cc, 0, 255))
        if abs(best[1] - a0) > 1e-6 or abs(float(best[2].mean()) - float(c0.mean())) > 1e-6:
            print("پالایش %s: a %.3f→%.3f  c %s→%s (خطا %.2f)"
                  % (tag, a0, best[1], np.round(c0, 0), np.round(best[2], 0), best[0] / 2))
        return best[1], best[2]

    core_fill = cv2.erode(is_fill.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    core_text = is_text  # متن خودش باریک است
    a_f2, c_f2 = refine(core_fill, a_f, c_f, (0.42, 0.60), (225, 255), "بدنه")
    a_t2, c_t2 = refine(core_text, a_t, c_t, (0.32, 0.52), (25, 85), "متن")
    a_map[is_fill] = a_f2
    c_map[is_fill] = c_f2
    a_map[is_text] = a_t2
    c_map[is_text] = c_t2
    a_f, c_f, a_t, c_t = a_f2, c_f2, a_t2, c_t2

    return a_map.astype(np.float32), c_map, sup, (a_f, c_f, a_t, c_t)


def main():
    ap = argparse.ArgumentParser(description="ساخت تمپلیت دوتنه (v3)")
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--box-a", required=True)
    ap.add_argument("--box-b", required=True)
    ap.add_argument("--margin", type=int, default=55)
    ap.add_argument("--out", required=True)
    ap.add_argument("--vis")
    args = ap.parse_args()

    imgA = cv2.imread(args.a, cv2.IMREAD_COLOR).astype(np.float32)
    imgB = cv2.imread(args.b, cv2.IMREAD_COLOR).astype(np.float32)
    gA = cv2.cvtColor(imgA.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    gB = cv2.cvtColor(imgB.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    D = gA - gB
    boxA = imprint_bbox(D, +1, parse_box(args.box_a), args.margin)
    boxB = imprint_bbox(D, -1, parse_box(args.box_b), args.margin)
    print("باکس مهر A:", boxA, "| مهر B:", boxB)

    ax1, ay1, ax2, ay2 = boxA
    I_A, C_A = imgA[ay1:ay2, ax1:ax2], imgB[ay1:ay2, ax1:ax2]
    I_B, C_B = imgB[boxB[1]:boxB[3], boxB[0]:boxB[2]], imgA[boxB[1]:boxB[3], boxB[0]:boxB[2]]

    # هم‌ترازی ترجمه‌ای B→A از لبه‌های قاب
    def white_alpha(I, C):
        g1 = I.mean(2); g2 = C.mean(2)
        return np.clip((g1 - g2) / np.maximum(255.0 - g2, MIN_DENOM), 0, 1)
    fA = frame_edges(white_alpha(I_A, C_A))
    fB = frame_edges(white_alpha(I_B, C_B))
    if fA is None or fB is None:
        raise ValueError("قاب مهر پیدا نشد")
    dx, dy = fA[0] - fB[0], fA[1] - fB[1]
    print("قاب A:", fA, "| قاب B:", fB, "| شیفت B→A: (%d,%d)" % (dx, dy))
    HA, WA = I_A.shape[:2]
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    IB = cv2.warpAffine(I_B, M, (WA, HA), flags=cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_CONSTANT, borderValue=np.nan)
    CB = cv2.warpAffine(C_B, M, (WA, HA), flags=cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_CONSTANT, borderValue=np.nan)
    valid = ~np.isnan(IB[..., 0])

    # ثابت‌ها + نقشه‌ها (داخل estimate_maps حل می‌شوند)
    a_map, c_map, sup, (a_f, c_f, a_t, c_t) = estimate_maps(I_A, C_A, IB, CB, valid)
    print("بدنه: a=%.3f c(B,G,R)=%s" % (a_f, np.round(c_f, 1)))
    print("متن:  a=%.3f c(B,G,R)=%s" % (a_t, np.round(c_t, 1)))

    # اعتبارسنجی روی هر دو مهر
    def mae(I, C, a, c):
        rec = np.clip((I - a[..., None] * c) / np.maximum(1 - a[..., None], 0.10), 0, 255)
        return float(np.abs(rec - C).mean()), float(np.abs(I - C).mean())
    mA, baseA = mae(I_A, C_A, a_map, c_map)
    Minv = np.float32([[1, 0, -dx], [0, 1, -dy]])
    HB, WB = I_B.shape[:2]
    a_B = cv2.warpAffine(a_map, Minv, (WB, HB), flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    c_B = cv2.warpAffine(c_map, Minv, (WB, HB), flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=255)
    mB, baseB = mae(I_B, C_B, a_B, c_B)
    print("\nاعتبارسنجی — مهر A: MAE %.2f → %.2f | مهر B: MAE %.2f → %.2f"
          % (baseA, mA, baseB, mB))

    # کراپ تایت
    ys, xs = np.where(a_map > 0.05)
    y1, y2, x1, x2 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a_map = a_map[y1:y2, x1:x2]
    c_map = c_map[y1:y2, x1:x2]
    print("تمپلیت نهایی: %dx%d | آلفا max=%.2f mean=%.3f | پشتیبان=%d"
          % (a_map.shape[1], a_map.shape[0], a_map.max(), a_map[a_map > 0.05].mean(),
             int((a_map > 0.05).sum())))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    d_map = (a_map * (c_map.mean(2) - 128.0) / 127.0).astype(np.float32)
    np.savez(args.out, a=a_map, c=c_map, d=d_map, W=np.float32(255.0),
             a_fill=np.float32(a_f), c_fill=c_f, a_text=np.float32(a_t), c_text=c_t,
             posA=np.array(boxA), posB=np.array(boxB),
             fidA=os.path.basename(args.a), fidB=os.path.basename(args.b),
             note="v3 two-tone alpha+color")
    vis_a = cv2.cvtColor((a_map * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    vis_c = c_map.astype(np.uint8)
    both = np.vstack([cv2.resize(vis_a, (vis_a.shape[1] * 4, vis_a.shape[0] * 4),
                                 interpolation=cv2.INTER_NEAREST),
                      cv2.resize(vis_c, (vis_c.shape[1] * 4, vis_c.shape[0] * 4),
                                 interpolation=cv2.INTER_NEAREST)])
    cv2.imwrite(args.vis or (os.path.splitext(args.out)[0] + "-vis.png"), both)
    print("ذخیره شد: %s" % args.out)


if __name__ == "__main__":
    main()
