#!/usr/bin/env python3
"""حذف واترمارک باسکول از «یک» فایل تصویر — پل اتصال UI/بک‌اند در آینده.

مثال:
    python3 remove_one.py photo.jpg -o photo_clean.jpg --json
    python3 remove_one.py https://cdn.example.com/x.jpg -o x.jpg --min-score 0.5

خروجی JSON (--json): {"status": "removed"|"not_found"|"error", "score", "scale", "x", "y", "w", "h", "evidence", "ms", ...}
کد خروج: 0=حذف شد | 2=واترمارک پیدا نشد | 1=خطا
"""
import argparse
import json
import os
import sys
import time

import cv2

from wm.config import Config
from wm.detect import detect, is_strong
from wm.remove import remove_watermark
from wm.storage import http_download
from wm.template import WatermarkTemplate


def load_input(src):
    if src.startswith("http://") or src.startswith("https://"):
        data = http_download(src)
    else:
        with open(src, "rb") as f:
            data = f.read()
    import numpy as np
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("تصویر قابل خواندن نیست: %s" % src)
    return img


def main():
    ap = argparse.ArgumentParser(description="حذف واترمارک باسکول از یک فایل تصویر")
    ap.add_argument("input", help="مسیر فایل محلی یا URL")
    ap.add_argument("-o", "--output", help="مسیر خروجی (پیش‌فرض: <ورودی>_clean.jpg — برای URL اجباری است)")
    ap.add_argument("--config", help="مسیر config.json دلخواه")
    ap.add_argument("--json", action="store_true", help="چاپ نتیجه به‌صورت JSON")
    ap.add_argument("--min-score", type=float, help="حداقل امتیاز تشخیص (پیش‌فرض از config)")
    ap.add_argument("--min-evidence", type=float, help="حداقل شواهد (پیش‌فرض از config)")
    args = ap.parse_args()

    t0 = time.time()
    cfg = Config(args.config)
    d = cfg["detect"]
    min_score = args.min_score if args.min_score is not None else d["min_score"]
    min_evidence = args.min_evidence if args.min_evidence is not None else d["min_evidence"]

    is_url = args.input.startswith("http://") or args.input.startswith("https://")
    if args.output:
        out_path = args.output
    elif not is_url:
        out_path = os.path.splitext(args.input)[0] + "_clean.jpg"
    else:
        print("برای ورودی URL باید -o بدهید", file=sys.stderr)
        sys.exit(1)

    result = {"input": args.input, "output": out_path,
              "min_score": min_score, "min_evidence": min_evidence}
    try:
        tpl = WatermarkTemplate.load(cfg.resolve(cfg["template"]))
        img = load_input(args.input)
        det = detect(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), tpl,
                     sigma=d["sigma"], scales=tuple(d["scales"]))
        if det is not None:
            result.update({"score": round(det.score, 4), "scale": round(det.scale, 3),
                           "x": det.x, "y": det.y, "w": det.w, "h": det.h,
                           "evidence": round(det.evidence, 2)})
        if not is_strong(det, min_score, min_evidence):
            result["status"] = "not_found"
            result["ms"] = round((time.time() - t0) * 1000)
            _emit(result, args.json)
            sys.exit(2)
        cleaned, bbox = remove_watermark(img, det, tpl, **cfg["remove"])
        ok = cv2.imwrite(out_path, cleaned, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError("نوشتن خروجی ناموفق بود: %s" % out_path)
        result["status"] = "removed"
        result["ms"] = round((time.time() - t0) * 1000)
        _emit(result, args.json)
        sys.exit(0)
    except Exception as e:  # noqa: BLE001
        result["status"] = "error"
        result["error"] = str(e)[:200]
        result["ms"] = round((time.time() - t0) * 1000)
        _emit(result, args.json)
        sys.exit(1)


def _emit(result, as_json):
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print("[%s] %s" % (result.get("status"), result.get("input")))
        for k in ("score", "scale", "evidence", "x", "y", "w", "h", "output", "error"):
            if k in result:
                print("  %-9s %s" % (k, result[k]))


if __name__ == "__main__":
    main()
