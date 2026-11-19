"""انکود JPEG (پلهٔ کیفیت تا سقف حجم) + ساخت thumb — هم‌تراز با خط لولهٔ قبلی deploy."""
from io import BytesIO

import cv2
import numpy as np
from PIL import Image


def decode_image(data):
    """بایت‌های تصویر → BGR ndarray (یا خطا)."""
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("تصویر قابل رمزگشایی نیست")
    return img


def _to_pil(img_bgr):
    return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))


def _save_jpeg(pil, quality):
    buf = BytesIO()
    pil.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def encode_main(img_bgr, max_bytes=512000, quality=84, ladder=(78, 72, 66, 60, 54, 48)):
    """فایل اصلی: کیفیت شروع و پله‌های پایین‌تر تا زیر سقف حجم.

    خروجی: (bytes, width, height)
    """
    pil = _to_pil(img_bgr)
    buf = _save_jpeg(pil, quality)
    for q in ladder:
        if len(buf) <= max_bytes:
            break
        buf = _save_jpeg(pil, q)
    h, w = img_bgr.shape[:2]
    return buf, w, h


def encode_thumb(img_bgr, size=500, quality=78):
    """بندانگشتی مربع‌ساز (بدون بزرگ‌کردن)."""
    pil = _to_pil(img_bgr)
    pil.thumbnail((size, size), Image.LANCZOS)
    return _save_jpeg(pil, quality)
