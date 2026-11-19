#!/usr/bin/env python3
"""ساخت دوبارهٔ تمپلیت آلفای واترمارک از یک «جفت طلایی».

جفت طلایی = دو نسخهٔ پیکسل‌یکسان از یک عکس که واترمارک در دو جای متفاوت خورده
(مثل دو عکس پشت‌سرهمِ یک محصول در باسکول که فقط یکی‌شان مهر دارند).
آلفای دقیق: a = (I − B_clean) / (255 − B_clean)

نادر لازم می‌شود — فقط اگر باسکول قالب واترمارک را عوض کند.

مثال:
    python3 build_template.py \\
        --a A.jpg --b B.jpg \\
        --box-a 214,626,330,668 --box-b 96,522,204,562 \\
        --out templates/buskool-golden.npz

باکس‌ها تقریبی هستند (چشمی یا از VLM)؛ حاشیهٔ جستجو با --margin کنترل می‌شود.
"""
import argparse
import os

import cv2
import numpy as np

CH = " .:-=+*#%@"


def parse_box(s):
    parts = [int(v) for v in s.split(",")]
    if len(parts) != 4:
        raise ValueError("باکس باید x1,y1,x2,y2 باشد")
    return parts


def imprint_mask(D, sign, box, margin=55, min_area=40):
    """نقاب مهر در ناحیهٔ تقریبی: تفاوت مثبت (مهر در A) یا منفی (مهر در B)."""
    H, W = D.shape
    x1, y1, x2, y2 = box
    zone = np.zeros((H, W), np.uint8)
    zone[max(0, y1 - margin):y2 + margin, max(0, x1 - margin):x2 + margin] = 1
    m_ = (D > 8) if sign > 0 else (D < -8)
    mk = (m_ & (zone > 0)).astype(np.uint8)
    mk = cv2.morphologyEx(mk, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    ncc, lab, stats, _ = cv2.connectedComponentsWithStats(mk)
    keep = np.zeros_like(mk)
    for c in range(1, ncc):
        if stats[c, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == c] = 1
    return keep


def clean_alpha(a):
    """فقط مؤلفهٔ متصل اصلی + برش تایت."""
    m = (a > 0.15).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    ncc, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if ncc > 1:
        c = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = np.zeros_like(m)
        keep[lab == c] = 1
    else:
        keep = m
    ys, xs = np.where(keep)
    y1, y2, x1, x2 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return a[y1:y2, x1:x2] * keep[y1:y2, x1:x2], (x1, y1, x2 - 1, y2 - 1)


def align_merge(cA, cB):
    """هم‌ترازی B روی A و میانگین دو مهر → تمپلیت واحد."""
    if cB.shape != cA.shape:
        cB2 = cv2.resize(cB, (cA.shape[1], cA.shape[0]), interpolation=cv2.INTER_AREA)
    else:
        cB2 = cB
    res = cv2.matchTemplate(
        cv2.copyMakeBorder(cB2, 8, 8, 8, 8, cv2.BORDER_CONSTANT), cA, cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(res)
    dx, dy = loc[0] - 8, loc[1] - 8
    H, W = cA.shape
    canvas = np.zeros((H + 16, W + 16), np.float32)
    canvas[8:8 + H, 8:8 + W] += cA
    bx1, by1 = 8 + dx, 8 + dy
    canvas[by1:by1 + cB2.shape[0], bx1:bx1 + cB2.shape[1]] += cB2
    cnt = np.zeros_like(canvas)
    cnt[8:8 + H, 8:8 + W] += 1
    cnt[by1:by1 + cB2.shape[0], bx1:bx1 + cB2.shape[1]] += 1
    merged = canvas / np.maximum(cnt, 1)
    merged[cnt < 1] = 0
    ys, xs = np.where(merged > 0.1)
    y1, y2, x1, x2 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a_t = merged[y1:y2, x1:x2]
    a_t = cv2.medianBlur(a_t, 3)
    a_t = np.clip(a_t, 0, 0.92)  # جلوگیری از انفجار نویز در (1−a)
    return a_t, score


def main():
    ap = argparse.ArgumentParser(description="ساخت تمپلیت آلفای واترمارک از جفت طلایی")
    ap.add_argument("--a", required=True, help="تصویر واترمارک‌دار شمارهٔ ۱")
    ap.add_argument("--b", required=True, help="تصویر واترمارک‌دار شمارهٔ ۲ (مهر در جای دیگر)")
    ap.add_argument("--box-a", required=True, help="باکس تقریبی مهر در A: x1,y1,x2,y2")
    ap.add_argument("--box-b", required=True, help="باکس تقریبی مهر در B: x1,y1,x2,y2")
    ap.add_argument("--margin", type=int, default=55, help="حاشیهٔ جستجو دور باکس (px)")
    ap.add_argument("--min-area", type=int, default=40, help="حداقل مساحت مؤلفهٔ متصل")
    ap.add_argument("--alpha-clip", type=float, default=0.92)
    ap.add_argument("--out", required=True, help="فایل npz خروجی")
    ap.add_argument("--vis", help="فایل PNG دیداری (پیش‌فرض: کنار npz)")
    args = ap.parse_args()

    A = cv2.imread(args.a, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    B = cv2.imread(args.b, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    if A.shape != B.shape:
        print("هشدار: ابعاد دو تصویر فرق دارد (%s vs %s) — جفت باید پیکسل‌یکسان باشد"
              % (A.shape, B.shape))

    D = A - B
    pos = imprint_mask(D, +1, parse_box(args.box_a), args.margin, args.min_area)
    neg = imprint_mask(D, -1, parse_box(args.box_b), args.margin, args.min_area)
    print("مهر A: %d پیکسل | مهر B: %d پیکسل" % (int(pos.sum()), int(neg.sum())))

    aA = np.clip((A - B) / np.maximum(255.0 - B, 8.0), 0, 1) * pos
    aB = np.clip((B - A) / np.maximum(255.0 - A, 8.0), 0, 1) * neg

    cA, box_cA = clean_alpha(aA)
    cB, box_cB = clean_alpha(aB)
    print("پاک‌شده: A %dx%d | B %dx%d" % (cA.shape[1], cA.shape[0], cB.shape[1], cB.shape[0]))

    a_t, score = align_merge(cA, cB)
    a_t = np.clip(a_t, 0, args.alpha_clip)
    print("هم‌ترازی: score=%.2f | تمپلیت نهایی: %dx%d alpha max %.2f"
          % (score, a_t.shape[1], a_t.shape[0], a_t.max()))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    np.savez(args.out, a=a_t.astype(np.float32), W=np.float32(255.0),
             fidA=os.path.basename(args.a), fidB=os.path.basename(args.b),
             note="rebuilt golden template")
    vis = (a_t * 255).astype(np.uint8)
    cv2.imwrite(args.vis or (os.path.splitext(args.out)[0] + "-vis.png"),
                cv2.resize(vis, (vis.shape[1] * 4, vis.shape[0] * 4),
                           interpolation=cv2.INTER_NEAREST))

    idx = np.clip(a_t * (len(CH) - 1), 0, len(CH) - 1).astype(int)
    for row in idx:
        print("".join(CH[v] for v in row))
    print("ذخیره شد: %s" % args.out)


if __name__ == "__main__":
    main()
