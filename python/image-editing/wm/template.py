"""تمپلیت واترمارک پاسکال — نقشهٔ آلفا + رنگ (مدل دوتنه).

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

    # ── نمونه‌برداری پیوسته (v4) ────────────────────────────────────────────
    def sample_maps(self, w, h, s, ox, oy):
        """نقشهٔ (آلفا، رنگ) برای جعبهٔ w×h با مقیاس پیوستهٔ s و افست زیرپیکسلی.

        پیکسل (i, j) جعبه به مختصات تمپلیتِ مبنا می‌رود:
            u = (i − ox) / s ،  v = (j − oy) / s
        که ox/oy گوشهٔ چپ-بالای مهر در مختصات پیوستهٔ تصویر منهای گوشهٔ
        صحیح جعبه است (یعنی همان جابه‌جایی زیرپیکسلی با علامت مثبت).
        برای کوچک‌شده (s<1) قالب با گاوسی ملایم پیش‌تار می‌شود (ضدآلیاسینگ
        جایگزین INTER_AREA) و سپس bilinear نمونه‌برداری می‌شود.

        خروجی: (alpha h×w، color h×w×۳ BGR) — float32.
        """
        base_a = self.alpha
        base_c = self.color
        if s < 0.995:
            sig = 0.55 * (1.0 / s - 1.0)
            if sig > 0.05:
                base_a = cv2.GaussianBlur(base_a, (0, 0), sig)
                base_c = cv2.GaussianBlur(base_c, (0, 0), sig)
        th_, tw_ = base_a.shape
        us = (np.arange(w, dtype=np.float32) - ox) / s
        vs = (np.arange(h, dtype=np.float32) - oy) / s
        u0 = np.clip(np.floor(us).astype(int), 0, tw_ - 1)
        u1 = np.clip(u0 + 1, 0, tw_ - 1)
        fu = np.clip(us - u0, 0.0, 1.0)
        v0 = np.clip(np.floor(vs).astype(int), 0, th_ - 1)
        v1 = np.clip(v0 + 1, 0, th_ - 1)
        fv = np.clip(vs - v0, 0.0, 1.0)
        # نمونه‌برداری جداشدنی: اول افقی بعد عمودی
        def _samp2(m):
            top = m[v0][:, u0] * (1 - fu)[None, :] + m[v0][:, u1] * fu[None, :]
            bot = m[v1][:, u0] * (1 - fu)[None, :] + m[v1][:, u1] * fu[None, :]
            return (top * (1 - fv)[:, None] + bot * fv[:, None]).astype(np.float32)
        a = _samp2(base_a)
        c = np.stack([_samp2(base_c[:, :, ch]) for ch in range(3)], axis=2)
        return a, c

    def sample_detect(self, w, h, s, ox, oy):
        """نقشهٔ تشخیص در مقیاس پیوستهٔ s با افست زیرپیکسلی (ox, oy) — مثل sample_maps."""
        base = self.detect_map.astype(np.float32)
        if s < 0.995:
            sig = 0.55 * (1.0 / s - 1.0)
            if sig > 0.05:
                base = cv2.GaussianBlur(base, (0, 0), sig)
        th_, tw_ = base.shape
        us = (np.arange(w, dtype=np.float32) - ox) / s
        vs = (np.arange(h, dtype=np.float32) - oy) / s
        u0 = np.clip(np.floor(us).astype(int), 0, tw_ - 1)
        u1 = np.clip(u0 + 1, 0, tw_ - 1)
        fu = np.clip(us - u0, 0.0, 1.0)
        v0 = np.clip(np.floor(vs).astype(int), 0, th_ - 1)
        v1 = np.clip(v0 + 1, 0, th_ - 1)
        fv = np.clip(vs - v0, 0.0, 1.0)
        top = base[v0][:, u0] * (1 - fu)[None, :] + base[v0][:, u1] * fu[None, :]
        bot = base[v1][:, u0] * (1 - fu)[None, :] + base[v1][:, u1] * fu[None, :]
        return (top * (1 - fv)[:, None] + bot * fv[:, None]).astype(np.float32)

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
