"""بارگذاری تنظیمات (config.json) و متغیرهای محیطی (.env)."""
import copy
import json
import os

from dotenv import dotenv_values

# wm/
PKG_DIR = os.path.dirname(os.path.abspath(__file__))
# image-editing/
TOOL_DIR = os.path.dirname(PKG_DIR)
# megan-back/
REPO_DIR = os.path.dirname(os.path.dirname(TOOL_DIR))

ENV_KEYS = (
    "DATABASE_URL",
    "ARVAN_ENDPOINT",
    "ARVAN_REGION",
    "ARVAN_ACCESS_KEY",
    "ARVAN_SECRET_KEY",
    "ARVAN_BUCKET_NAME",
)

DEFAULTS = {
    "template": "templates/pascal-golden.npz",
    "detect": {
        "sigma": 7.0,
        "scales": [0.55, 0.62, 0.7, 0.78, 0.85, 0.92, 1.0, 1.08, 1.15, 1.25, 1.35, 1.5, 1.65],
        "min_score": 0.45,
        "min_evidence": 5.0,
    },
    "remove": {
        "alpha_floor": 0.12,
        "ink_threshold": 0.03,
        "denoise_sigma": 0.7,
    },
    "encode": {
        "main_max_bytes": 512000,
        "main_quality": 84,
        "quality_ladder": [78, 72, 66, 60, 54, 48],
        "thumb_size": 500,
        "thumb_quality": 78,
    },
    "deploy": {
        "delete_old_keys": True,
        "verify_upload": True,
    },
    "batch": {
        "query": {"related_model": "Product", "field_key": "gallery", "has_watermark": True},
    },
}


class Config:
    """تنظیمات ابزار؛ مقادیر config.json روی پیش‌فرض‌ها سوار می‌شوند."""

    def __init__(self, path=None):
        self.path = path or os.path.join(TOOL_DIR, "config.json")
        data = copy.deepcopy(DEFAULTS)
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                user = json.load(f)
            for section, values in user.items():
                if isinstance(values, dict) and isinstance(data.get(section), dict):
                    data[section].update(values)
                else:
                    data[section] = values
        self.data = data
        self.base = TOOL_DIR

    def __getitem__(self, key):
        return self.data[key]

    def get(self, key, default=None):
        return self.data.get(key, default)

    def resolve(self, rel):
        """مسیر نسبی را نسبت به پوشهٔ image-editing حل می‌کند."""
        if rel is None:
            return None
        return rel if os.path.isabs(rel) else os.path.join(TOOL_DIR, rel)


def _valid(k, v):
    """مقدار معتبر است؟ (مثلاً DATABASE_URL محیط سندباکس/سیستم ممکن است چیز دیگری باشد)"""
    if not v:
        return False
    if k == "DATABASE_URL":
        return v.startswith("mongodb://") or v.startswith("mongodb+srv://")
    return True


def load_env():
    """متغیرهای محیطی ابزار.

    اولویت: .env ابزار > .env ریپو > متغیر محیط (فقط اگر مقدار معتبر داشته باشد).
    فایل‌های .env منبع حقیقت‌اند (در این ریپو .env کامیت می‌شود) تا متغیرهای
    بی‌ربط محیط — مثل DATABASE_URL سرویس‌های دیگر — آن‌ها را باز ننویسند.

    خروجی: (dict, missing_keys)
    """
    env = {}
    for k in ENV_KEYS:
        if _valid(k, os.environ.get(k)):
            env[k] = os.environ[k]
    for p in (os.path.join(REPO_DIR, ".env"), os.path.join(TOOL_DIR, ".env")):
        if os.path.exists(p):
            for k, v in dotenv_values(p).items():
                if _valid(k, v):
                    env[k] = v
    missing = [k for k in ENV_KEYS if not env.get(k)]
    return env, missing
