"""تمپلیت آلفای واترمارک باسکول (قالب ثابت، استخراج‌شده از «جفت طلایی»)."""
import cv2
import numpy as np


class WatermarkTemplate:
    """نقشهٔ آلفای واترمارک (۰..۱) + متادیتای منبع.

    فایل npz حداقل کلید «a» (آلفا) را دارد؛ کلیدهای دیگر (fidA/fidB/posA/posB/…)
    فقط متادیتا هستند و در self.meta می‌آیند.
    """

    def __init__(self, alpha, meta=None, path=None):
        self.alpha = np.asarray(alpha, np.float32)
        if self.alpha.ndim != 2:
            raise ValueError("نقشهٔ آلفا باید دوبعدی باشد")
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
            if k in ("a", "W"):
                continue
            v = z[k]
            if getattr(v, "shape", None) == ():
                meta[k] = v.item()
            elif hasattr(v, "tolist"):
                meta[k] = v.tolist()
            else:
                meta[k] = v
        return cls(z["a"], meta=meta, path=path)
