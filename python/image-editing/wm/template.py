"""تمپلیت واترمارک باسکول — نقشهٔ آلفا + رنگ (مدل دوتنه).

فایل npz کلیدهای «a» (آلفا H×W) و اختیاری «c» (رنگ جوهر H×W×۳ BGR)
دارد. اگر «c» نباشد، جوهر سفید فرض می‌شود (سازگاری با قالب قدیمی).
"""
import cv2
import numpy as np


class WatermarkTemplate:
    """نقشهٔ (آلفا، رنگ) واترمارک + متادیتای منبع."""

    def __init__(self, alpha, color=None, detect=None, meta=None, path=None):
        self.alpha = np.asarray(alpha, np.float32)
        if self.alpha.ndim != 2:
            raise ValueError("نقشهٔ آلفا باید دوبعدی باشد")
        if color is None:
            color = np.full((*self.alpha.shape, 3), 255.0, np.float32)
        self.color = np.asarray(color, np.float32)
        if self.color.shape != (*self.alpha.shape, 3):
            raise ValueError("نقشهٔ رنگ باید H×W×۳ باشد")
        self._d = None if detect is None else np.asarray(detect, np.float32)
        self.meta = dict(meta or {})
        self.path = path

    @property
    def size(self):
        """(عرض، ارتفاع) تمپلیت."""
        return self.alpha.shape[1], self.alpha.shape[0]

    def resized(self, w, h):
        """آلفا در مقیاس دلخواه (برای تطبیق/حذف در اندازهٔ تشخیص‌داده‌شده)."""
        if (w, h) == self.size:
            return self.alpha
        return cv2.resize(self.alpha, (w, h), interpolation=cv2.INTER_AREA)

    def resized_color(self, w, h):
        """رنگ جوهر در مقیاس دلخواه."""
        if (w, h) == self.size:
            return self.color
        return cv2.resize(self.color, (w, h), interpolation=cv2.INTER_AREA)

    @property
    def detect_map(self):
        """نقشهٔ پاسخ مورد انتظار در زمینهٔ میانی (برای تطبیق تمپلیت).

        آلفای دوتنه تقریباً بی‌ساختار است (0.43 متن / 0.50 بدنه)؛ برای تشخیص
        باید اثر دیداری مهر — a·(c−128) — به‌کار رود که ساختار قاب و متن را دارد.
        """
        if self._d is not None:
            return self._d
        cg = self.color.mean(axis=2)
        return (self.alpha * (cg - 128.0)) / 127.0

    def resized_detect(self, w, h):
        if (w, h) == self.size:
            return self.detect_map
        return cv2.resize(self.detect_map.astype(np.float32), (w, h),
                          interpolation=cv2.INTER_AREA)

    def ink_bbox(self, thr=0.03):
        """باکس جوهر واترمارک (x1,y1,x2,y2) یا None."""
        ys, xs = np.where(self.alpha > thr)
        if len(ys) == 0:
            return None
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

    @classmethod
    def load(cls, path):
        z = np.load(path, allow_pickle=False)
        meta = {}
        for k in z.files:
            if k in ("a", "c", "W"):
                continue
            v = z[k]
            if getattr(v, "shape", None) == ():
                meta[k] = v.item()
            elif hasattr(v, "tolist"):
                meta[k] = v.tolist()
            else:
                meta[k] = v
        d = z["d"] if "d" in z.files else None
        return cls(z["a"], z["c"] if "c" in z.files else None, detect=d, meta=meta, path=path)
