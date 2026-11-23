#!/usr/bin/env python3
"""خروجی تمپلیت دوتنه به یک فایل TypeScript برای بک‌اند (megan-back).

بک‌اند روی ورسل (تابع Node) اجرا می‌شود و پایتون ندارد؛ همین تمپلیت به‌صورت
کوانتیزهٔ base64 داخل یک ماژول TS صادر می‌شود تا در باندل serverless هم
به‌درستی همراه بیاید:
  a → u8 (×255) | cB,cG,cR → u8 | d → u8 ((d/0.65+1)×127.5)
"""
import base64
import os

import numpy as np

BASE = "/home/z/my-project/repos/megan-back/python/image-editing"
OUT = "/home/z/my-project/repos/megan-back/src/importer/pascal-template.ts"

z = np.load(os.path.join(BASE, "templates/pascal-golden.npz"))
a, c, d = z["a"], z["c"], z["d"]
H, W = a.shape
assert c.shape == (H, W, 3) and d.shape == (H, W)

def q(x, lo, hi):
    y = np.clip((x - lo) / (hi - lo) * 255.0, 0, 255).round().astype(np.uint8)
    return base64.b64encode(y.tobytes()).decode()

b64 = {
    "a": q(a, 0.0, 1.0),
    "cB": q(c[..., 0], 0.0, 255.0),
    "cG": q(c[..., 1], 0.0, 255.0),
    "cR": q(c[..., 2], 0.0, 255.0),
    "d": q(d, -0.65, 0.65),
}

src = f"""// توسط python/image-editing/export_template.py ساخته شده — دستی ویرایش نکنید.
// تمپلیت دوتنهٔ واترمارک پاسکال (خروجی build_template.py v3 از جفت طلایی).
// کوانتیزه: a=آلفا×255 | cB/cG/cR=رنگ | d=نقشهٔ تشخیص (−0.65..0.65).

export const PASCAL_TEMPLATE = {{
  w: {W},
  h: {H},
  a: '{b64['a']}',        // آلفا 0..1 (÷255)
  cB: '{b64['cB']}',      // رنگ جوهر — کانال آبی 0..255
  cG: '{b64['cG']}',      // سبز
  cR: '{b64['cR']}',      // قرمز
  d: '{b64['d']}',        // نقشهٔ تشخیص (−0.65..0.65)
}} as const;
"""
with open(OUT, "w", encoding="utf-8") as f:
    f.write(src)
print("نوشته شد:", OUT, f"({os.path.getsize(OUT)} bytes) — تمپلیت {W}×{H}")
