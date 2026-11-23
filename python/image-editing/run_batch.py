#!/usr/bin/env python3
"""اجرای انبوه حذف واترمارک روی فایل‌های علامت‌خورده (has_watermark=true).

جریان هر فایل: دانلود از آروان → تشخیص → حذف → انکود main/thumb →
آپلود کلید نسخه‌دار → صحت‌سنجی → آپدیت ردیف File (has_watermark=false +
watermark_fixed_at) → حذف کلیدهای قدیمی.

- اگر واترمارک پیدا نشود، فایل «دست‌نخورده» می‌ماند و فقط در گزارش not_found می‌آید.
- اجرا با state قابل ازسر‌گرفتن است (فایل‌های موفق قبلی رد می‌شوند).
- --dry-run فقط تشخیص/حذف/انکود می‌کند و چیزی آپلود/آپدیت نمی‌کند.

مثال:
    python3 run_batch.py --dry-run --limit 20
    python3 run_batch.py --limit 50 --save-previews 5
    python3 run_batch.py            # کل صف
"""
import argparse
import csv
import json
import os
import sys
import time

import cv2
import numpy as np

from wm.config import TOOL_DIR, Config, load_env
from wm.db import Db
from wm.detect import detect, is_strong
from wm.encode import decode_image, encode_main, encode_thumb
from wm.remove import remove_watermark
from wm.storage import Arvan, http_download
from wm.template import WatermarkTemplate

REMOVED_BY = "python image-editing v1 (golden-alpha reverse-compositing)"


def save_state(path, state):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description="اجرای انبوه حذف واترمارک پاسکال")
    ap.add_argument("--limit", type=int, help="حداکثر تعداد فایل در این اجرا")
    ap.add_argument("--ids", help="فقط این شناسه‌ها (جدا با کاما)")
    ap.add_argument("--dry-run", action="store_true", help="بدون آپلود/آپدیت دیتابیس")
    ap.add_argument("--min-score", type=float)
    ap.add_argument("--min-evidence", type=float)
    ap.add_argument("--state", default=os.path.join(TOOL_DIR, "output", "run-state.json"))
    ap.add_argument("--report", default=os.path.join(TOOL_DIR, "output", "run-report.csv"))
    ap.add_argument("--save-previews", type=int, default=0,
                    help="برای N فایل اول، تصویر مقایسه قبل|بعد هم ذخیره شود")
    ap.add_argument("--preview-dir", default=os.path.join(TOOL_DIR, "output", "run-previews"))
    args = ap.parse_args()

    cfg = Config()
    d = cfg["detect"]
    enc = cfg["encode"]
    dep = cfg["deploy"]
    min_score = args.min_score if args.min_score is not None else d["min_score"]
    min_evidence = args.min_evidence if args.min_evidence is not None else d["min_evidence"]

    env, missing = load_env()
    need = ["DATABASE_URL", "ARVAN_ENDPOINT", "ARVAN_ACCESS_KEY", "ARVAN_SECRET_KEY", "ARVAN_BUCKET_NAME"]
    miss = [k for k in need if not env.get(k)]
    if miss:
        print("متغیرهای محیطی ناقص: %s" % ", ".join(miss), file=sys.stderr)
        sys.exit(1)

    tpl = WatermarkTemplate.load(cfg.resolve(cfg["template"]))
    db = Db(env["DATABASE_URL"], query=cfg["batch"]["query"])
    arvan = Arvan(env["ARVAN_ENDPOINT"], env.get("ARVAN_REGION"),
                  env["ARVAN_ACCESS_KEY"], env["ARVAN_SECRET_KEY"], env["ARVAN_BUCKET_NAME"])

    if args.ids:
        ids = [s.strip() for s in args.ids.split(",") if s.strip()]
        rows = [r for r in (db.get(i) for i in ids) if r]
    else:
        rows = db.iter_marked(limit=args.limit)

    os.makedirs(os.path.dirname(args.state), exist_ok=True)
    state = {}
    if os.path.exists(args.state):
        with open(args.state, encoding="utf-8") as f:
            state = json.load(f)
    if args.save_previews:
        os.makedirs(args.preview_dir, exist_ok=True)

    total = db.count() if not args.ids else len(rows)
    done = fail = nf = skipped = previews_saved = 0
    report_rows = []
    t_start = time.time()
    remaining = total

    print("صف: %s فایل | dry-run: %s | state از قبل: %d" % (
        total or len(rows), "بله" if args.dry_run else "خیر", len(state)))

    try:
        for row in rows:
            fid = str(row["_id"])
            prev = state.get(fid)
            if prev and (prev.get("ok") or prev.get("skip")):
                skipped += 1
                continue
            rec = {"fid": fid}
            try:
                img = decode_image(http_download(row["url"]))
                det = detect(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), tpl,
                             sigma=d["sigma"], scales=tuple(d["scales"]))
                if det is not None:
                    rec.update({"score": round(det.score, 3), "scale": round(det.scale, 2),
                                "x": det.x, "y": det.y, "w": det.w, "h": det.h,
                                "evidence": round(det.evidence, 1)})
                if not is_strong(det, min_score, min_evidence):
                    rec["status"] = "not_found"
                    state[fid] = {"skip": "not-found",
                                  "score": rec.get("score", 0)}
                    nf += 1
                else:
                    cleaned, (x1, y1, x2, y2) = remove_watermark(img, det, tpl, **cfg["remove"])
                    main_buf, w, h = encode_main(
                        cleaned, max_bytes=enc["main_max_bytes"],
                        quality=enc["main_quality"], ladder=tuple(enc["quality_ladder"]))
                    thumb_buf = encode_thumb(cleaned, size=enc["thumb_size"],
                                             quality=enc["thumb_quality"])
                    rec.update({"status": "removed" if not args.dry_run else "removed(dry)",
                                "main_bytes": len(main_buf), "thumb_bytes": len(thumb_buf),
                                "img": "%dx%d" % (w, h)})

                    if args.save_previews and previews_saved < args.save_previews:
                        previews_saved += 1
                        m = 30
                        cy1, cy2 = max(0, y1 - m), min(img.shape[0], y2 + m)
                        cx1, cx2 = max(0, x1 - m), min(img.shape[1], x2 + m)
                        side = np.hstack(
                            [img[cy1:cy2, cx1:cx2], cleaned[cy1:cy2, cx1:cx2]])
                        side = cv2.resize(side, (side.shape[1] * 2, side.shape[0] * 2),
                                          interpolation=cv2.INTER_NEAREST)
                        cv2.imwrite(os.path.join(args.preview_dir, fid + ".compare.jpg"), side,
                                    [cv2.IMWRITE_JPEG_QUALITY, 92])

                    if not args.dry_run:
                        old_main = row.get("storage_key")
                        old_thumb = row.get("thumb_storage_key")
                        main_key = arvan.versioned_key(old_main or "orphans/%s.jpg" % fid)
                        thumb_key = main_key + ".thumb.jpg"
                        arvan.put(main_key, main_buf)
                        arvan.put(thumb_key, thumb_buf)
                        url = arvan.public_url(main_key)
                        thumb_url = arvan.public_url(thumb_key)
                        if dep.get("verify_upload", True):
                            if not arvan.exists(url) or not arvan.exists(thumb_url):
                                raise RuntimeError("صحت‌سنجی آپلود ناموفق")
                        if not db.mark_fixed(fid, row, main_key=main_key, thumb_key=thumb_key,
                                             url=url, thumb_url=thumb_url,
                                             main_bytes=len(main_buf), thumb_bytes=len(thumb_buf),
                                             width=w, height=h, old_key=old_main,
                                             removed_by=REMOVED_BY):
                            raise RuntimeError("آپدیت ردیف File ناموفق")
                        if dep.get("delete_old_keys", True) and old_main:
                            arvan.delete(old_main)
                            if old_thumb:
                                arvan.delete(old_thumb)
                        rec["url"] = url
                        state[fid] = {"ok": True, "main_key": main_key, "bytes": len(main_buf)}
                    else:
                        state[fid] = {"ok": True, "dry": True, "bytes": len(main_buf)}
                    done += 1
            except Exception as e:  # noqa: BLE001
                rec["status"] = "error"
                rec["error"] = str(e)[:150]
                state[fid] = {"error": str(e)[:150]}
                fail += 1
            report_rows.append(rec)
            save_state(args.state, state)
            print("  [%s] %s %s %s" % (done + nf + fail, fid[:12], rec.get("status"),
                                       "(%.2f)" % rec["score"] if "score" in rec else ""))
    except KeyboardInterrupt:
        print("\nمتوقف شد — state ذخیره است؛ دوباره اجرا کنید تا از همان‌جا ادامه یابد.")
    finally:
        try:
            remaining = db.count()
        except Exception:  # noqa: BLE001
            remaining = "-"
        db.close()

    # گزارش CSV
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    with open(args.report, "w", newline="", encoding="utf-8") as f:
        wcsv = csv.writer(f)
        wcsv.writerow(["fid", "status", "score", "scale", "evidence", "x", "y", "w", "h",
                       "img", "main_bytes", "url", "error"])
        for r in report_rows:
            wcsv.writerow([r.get("fid"), r.get("status"), r.get("score"), r.get("scale"),
                           r.get("evidence"), r.get("x"), r.get("y"), r.get("w"), r.get("h"),
                           r.get("img"), r.get("main_bytes"), r.get("url"), r.get("error")])

    dt = time.time() - t_start
    print("\nانجام‌شده: %d | بدون تشخیص: %d | خطا: %d | رد‌شده از قبل: %d | %.1fs"
          % (done, nf, fail, skipped, dt))
    print("گزارش: %s\nstate: %s" % (args.report, args.state))
    print("باقی‌ماندهٔ صف: %s" % remaining)


if __name__ == "__main__":
    main()
