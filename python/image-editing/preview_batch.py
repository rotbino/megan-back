#!/usr/bin/env python3
"""پیش‌نمایش حذف واترمارک روی نمونه‌ای از فایل‌های علامت‌خورده در دیتابیس.

«فقط برای بازبینی چشمی» — هیچ چیزی در دیتابیس یا استوریج تغییر نمی‌کند.

مثال:
    python3 preview_batch.py --limit 10
    python3 preview_batch.py --ids 6af8f2d7...,6af9c2ff... --zoom 3

خروجی در output/previews-<زمان>/ :
    <fid>.compare.jpg   ← قبل | بعد (بریدهٔ دور واترمارک، بزرگ‌شده)
    <fid>.after.jpg     ← کل تصویر بعد از حذف
    summary.json        ← امتیاز/مقیاس/مختصات هر مورد
"""
import argparse
import json
import os
import sys
import time

import cv2

from wm.config import TOOL_DIR, Config, load_env
from wm.db import Db
from wm.detect import detect, is_strong
from wm.encode import decode_image
from wm.remove import remove_watermark
from wm.storage import http_download
from wm.template import WatermarkTemplate


def main():
    ap = argparse.ArgumentParser(description="پیش‌نمایش حذف واترمارک — بدون تغییر دیتابیس/استوریج")
    ap.add_argument("--limit", type=int, default=10, help="تعداد نمونهٔ تصادفی")
    ap.add_argument("--ids", help="شناسه‌های فایل جدا با کاما (به‌جای نمونهٔ تصادفی)")
    ap.add_argument("--out", help="پوشهٔ خروجی (پیش‌فرض: output/previews-<زمان>)")
    ap.add_argument("--min-score", type=float)
    ap.add_argument("--min-evidence", type=float)
    ap.add_argument("--margin", type=int, default=30, help="حاشیهٔ برش دور واترمارک (px)")
    ap.add_argument("--zoom", type=int, default=2, help="بزرگ‌نمایی تصویر مقایسه")
    ap.add_argument("--no-full", action="store_true", help="کل تصویر after ذخیره نشود")
    args = ap.parse_args()

    cfg = Config()
    d = cfg["detect"]
    min_score = args.min_score if args.min_score is not None else d["min_score"]
    min_evidence = args.min_evidence if args.min_evidence is not None else d["min_evidence"]

    env, missing = load_env()
    if "DATABASE_URL" not in env:
        print("DATABASE_URL پیدا نشد (.env ریپو یا python/image-editing/.env)", file=sys.stderr)
        sys.exit(1)

    tpl = WatermarkTemplate.load(cfg.resolve(cfg["template"]))
    db = Db(env["DATABASE_URL"], query=cfg["batch"]["query"])

    if args.ids:
        ids = [s.strip() for s in args.ids.split(",") if s.strip()]
        rows = [db.get(i) for i in ids]
        rows = [r for r in rows if r]
    else:
        rows = db.sample(args.limit)
    if not rows:
        print("هیچ فایلی پیدا نشد", file=sys.stderr)
        sys.exit(1)
    print("نمونه‌ها: %d فایل (صف کل: %d علامت‌خورده)" % (len(rows), db.count()))

    out_dir = args.out or os.path.join(
        TOOL_DIR, "output", "previews-%s" % time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(out_dir, exist_ok=True)

    summary = []
    for n, row in enumerate(rows, 1):
        fid = str(row["_id"])
        entry = {"fid": fid, "url": row.get("url")}
        try:
            img = decode_image(http_download(row["url"]))
            det = detect(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), tpl,
                         sigma=d["sigma"], scales=tuple(d["scales"]))
            if det is not None:
                entry.update({"score": round(det.score, 3), "scale": round(det.scale, 2),
                              "x": det.x, "y": det.y, "w": det.w, "h": det.h,
                              "evidence": round(det.evidence, 1)})
            if not is_strong(det, min_score, min_evidence):
                entry["status"] = "not_found"
                cv2.imwrite(os.path.join(out_dir, fid + ".before.jpg"), img,
                            [cv2.IMWRITE_JPEG_QUALITY, 88])
            else:
                entry["status"] = "removed"
                cleaned, (x1, y1, x2, y2) = remove_watermark(img, det, tpl, **cfg["remove"])
                m = args.margin
                cy1, cy2 = max(0, y1 - m), min(img.shape[0], y2 + m)
                cx1, cx2 = max(0, x1 - m), min(img.shape[1], x2 + m)
                side = np_hstack(img[cy1:cy2, cx1:cx2], cleaned[cy1:cy2, cx1:cx2])
                if args.zoom and args.zoom > 1:
                    side = cv2.resize(side, (side.shape[1] * args.zoom, side.shape[0] * args.zoom),
                                      interpolation=cv2.INTER_NEAREST)
                cv2.imwrite(os.path.join(out_dir, fid + ".compare.jpg"), side,
                            [cv2.IMWRITE_JPEG_QUALITY, 92])
                if not args.no_full:
                    cv2.imwrite(os.path.join(out_dir, fid + ".after.jpg"), cleaned,
                                [cv2.IMWRITE_JPEG_QUALITY, 88])
        except Exception as e:  # noqa: BLE001
            entry["status"] = "error"
            entry["error"] = str(e)[:150]
        summary.append(entry)
        print("  [%d/%d] %s %s  score=%s evid=%s" % (
            n, len(rows), fid[:12], entry.get("status"),
            entry.get("score", "-"), entry.get("evidence", "-")))

    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)

    ok = sum(1 for e in summary if e["status"] == "removed")
    nf = sum(1 for e in summary if e["status"] == "not_found")
    er = sum(1 for e in summary if e["status"] == "error")
    print("\nحذف: %d | بدون تشخیص: %d | خطا: %d\nخروجی: %s" % (ok, nf, er, out_dir))


def np_hstack(a, b):
    import numpy as np
    return np.hstack([a, b])


if __name__ == "__main__":
    main()
