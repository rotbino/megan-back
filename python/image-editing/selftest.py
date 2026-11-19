#!/usr/bin/env python3
"""تست سلامت ابزار (بدون نیاز به دیتابیس/آروان):

۱) تشخیص روی تصویر واترمارک‌دارِ جفت طلایی باید قوی باشد؛
۲) حذف باید خطای مطلق نسبت به نسخهٔ تمیزِ همان عکس را پایین بیاورد؛
۳) هیچ پیکسلی بیرون از باکس حذف نباید تغییر کند؛
۴) بعد از حذف، امتیاز تشخیص مجدد باید افت کند (واترمارک واقعاً رفته).

خروجی: output/selftest-compare.jpg (قبل | بعد) + PASS/FAIL هر تست.
"""
import os
import sys

import cv2
import numpy as np

from wm.config import TOOL_DIR, Config
from wm.detect import detect, is_strong
from wm.remove import remove_watermark
from wm.template import WatermarkTemplate

GOLDEN_DIR = os.path.join(TOOL_DIR, "tests", "golden-pair")


def main():
    cfg = Config()
    d = cfg["detect"]
    tpl = WatermarkTemplate.load(cfg.resolve(cfg["template"]))
    fidA = os.path.splitext(str(tpl.meta.get("fidA", "6af9ac07d6118900aef951a9")))[0]
    fidB = os.path.splitext(str(tpl.meta.get("fidB", "6af9ac07d6118900aef951a8")))[0]
    print("template: %s  (%dx%d, alpha max %.2f)" % (os.path.basename(tpl.path), *tpl.size, tpl.alpha.max()))

    imgA = cv2.imread(os.path.join(GOLDEN_DIR, fidA + ".jpg"), cv2.IMREAD_COLOR)
    imgB = cv2.imread(os.path.join(GOLDEN_DIR, fidB + ".jpg"), cv2.IMREAD_COLOR)
    if imgA is None or imgB is None:
        print("FAIL: تصاویر جفت طلایی در tests/golden-pair پیدا نشدند")
        sys.exit(1)
    gA = cv2.cvtColor(imgA, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gB = cv2.cvtColor(imgB, cv2.COLOR_BGR2GRAY).astype(np.float32)

    detA = detect(cv2.cvtColor(imgA, cv2.COLOR_BGR2GRAY), tpl,
                  sigma=d["sigma"], scales=tuple(d["scales"]))
    t1 = detA is not None and is_strong(detA, d["min_score"], d["min_evidence"])
    print("[%s] 1) تشخیص روی تصویر A: score=%.2f evidence=%.1f scale=%.2f pos=(%d,%d) %dx%d"
          % ("PASS" if t1 else "FAIL", detA.score if detA else 0, detA.evidence if detA else 0,
             detA.scale if detA else 0, detA.x if detA else -1, detA.y if detA else -1,
             detA.w if detA else 0, detA.h if detA else 0))
    if not t1:
        sys.exit(1)

    posA = tpl.meta.get("posA")
    if posA:
        cx = detA.x + detA.w / 2 - (posA[0] + posA[2]) / 2
        cy = detA.y + detA.h / 2 - (posA[1] + posA[3]) / 2
        print("        فاصلهٔ مرکز از مهر واقعی: %.0fpx" % ((cx ** 2 + cy ** 2) ** 0.5))

    cleaned, (x1, y1, x2, y2) = remove_watermark(imgA, detA, tpl, **cfg["remove"])

    # ناحیهٔ ارزیابی: باکس حذف، منهای ناحیهٔ واترمارکِ خود تصویر B
    mask = np.zeros(gA.shape, bool)
    mask[y1:y2, x1:x2] = True
    detB = detect(cv2.cvtColor(imgB, cv2.COLOR_BGR2GRAY), tpl,
                  sigma=d["sigma"], scales=tuple(d["scales"]))
    if is_strong(detB, d["min_score"], d["min_evidence"]):
        bx1, by1, bx2, by2 = detB.bbox
        mask[max(0, by1 - 10):by2 + 10, max(0, bx1 - 10):bx2 + 10] = False
    gC = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mae_before = float(np.abs(gA - gB)[mask].mean())
    mae_after = float(np.abs(gC - gB)[mask].mean())
    t2 = mae_after < mae_before
    print("[%s] 2) MAE در ناحیهٔ مهر (نسبت به نسخهٔ تمیز واقعی): %.1f → %.1f  (%d پیکسل)"
          % ("PASS" if t2 else "FAIL", mae_before, mae_after, int(mask.sum())))

    # بیرون باکس هیچ تغییری نباشد
    outside = np.ones(gA.shape, bool)
    outside[y1:y2, x1:x2] = False
    diff_out = float(np.abs(gC - gA)[outside].max())
    t3 = diff_out == 0
    print("[%s] 3) تغییر بیرون از باکس: max diff = %.0f" % ("PASS" if t3 else "FAIL", diff_out))

    # تشخیص مجدد روی تصویر پاک‌شده باید ضعیف باشد
    detC = detect(cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY), tpl,
                  sigma=d["sigma"], scales=tuple(d["scales"]))
    if detC is not None:
        weak = not is_strong(detC, d["min_score"], d["min_evidence"])
        print("[%s] 4) تشخیص مجدد بعد از حذف: score=%.2f evidence=%.1f"
              % ("PASS" if weak else "WARN", detC.score, detC.evidence))
    else:
        print("[PASS] 4) تشخیص مجدد بعد از حذف: هیچ تطبیقی")

    # تصویر مقایسه‌ای
    m = 30
    cy1, cy2 = max(0, y1 - m), min(gA.shape[0], y2 + m)
    cx1, cx2 = max(0, x1 - m), min(gA.shape[1], x2 + m)
    side = np.hstack([imgA[cy1:cy2, cx1:cx2], cleaned[cy1:cy2, cx1:cx2]])
    side = cv2.resize(side, (side.shape[1] * 2, side.shape[0] * 2), interpolation=cv2.INTER_NEAREST)
    out_dir = os.path.join(TOOL_DIR, "output")
    os.makedirs(out_dir, exist_ok=True)
    cv2.imwrite(os.path.join(out_dir, "selftest-compare.jpg"), side,
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("مقایسهٔ قبل|بعد ذخیره شد: output/selftest-compare.jpg")

    ok = t1 and t2 and t3
    print("\nخلاصه: %s" % ("همهٔ تست‌های اصلی PASS" if ok else "FAIL — ابزار را استفاده نکنید"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
