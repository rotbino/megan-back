"""دسترسی به کالکشن File در MongoDB (هم‌تراز با اسکیمای Prisma — نام فیلدها snake_case).

نکته: برخلاف Prisma که در ترکیب فیلترهای nullable مقید بود، اینجا فیلتر مستقیم
Mongo است و دقیقاً همان چیزی را برمی‌گرداند که می‌خواهیم.
"""
from datetime import datetime, timezone

from bson import ObjectId
from pymongo import MongoClient

PROJECTION = {
    "_id": 1, "name": 1, "related_model": 1, "field_key": 1,
    "url": 1, "storage_key": 1, "thumb_url": 1, "thumb_storage_key": 1,
    "size": 1, "mime_type": 1, "metadata": 1,
    "has_watermark": 1, "watermark_reviewed_at": 1, "watermark_fixed_at": 1,
}

DEFAULT_QUERY = {"related_model": "Product", "field_key": "gallery", "has_watermark": True}


class Db:
    def __init__(self, url, query=None):
        self.client = MongoClient(
            url,
            retryWrites=True,
            serverSelectionTimeoutMS=20000,
            connectTimeoutMS=10000,
            socketTimeoutMS=30000,
        )
        self.db = self.client.get_default_database()
        self.col = self.db["File"]
        self.query = dict(query or DEFAULT_QUERY)

    def close(self):
        self.client.close()

    def count(self):
        return self.col.count_documents(self.query)

    def sample(self, n):
        """نمونهٔ تصادفی از فایل‌های علامت‌خورده (برای پیش‌نمایش)."""
        return list(self.col.aggregate([{"$match": self.query}, {"$sample": {"size": int(n)}}]))

    def iter_marked(self, limit=None):
        """پیمایش مرتب همهٔ فایل‌های صف (برای اجرای انبوه)."""
        cur = self.col.find(self.query, projection=PROJECTION).sort("_id", 1)
        if limit:
            cur = cur.limit(int(limit))
        for doc in cur:
            yield doc

    def get(self, fid):
        return self.col.find_one({"_id": ObjectId(fid)}, projection=PROJECTION)

    def mark_fixed(self, fid, row, *, main_key, thumb_key, url, thumb_url,
                   main_bytes, thumb_bytes, width, height, old_key, removed_by):
        """ثبت اصلاح موفق — همان قرارداد اسکریپت‌های قبلی:
        has_watermark=False + watermark_fixed_at=now (+ متادیتای تعویض).
        """
        now = datetime.now(timezone.utc)
        meta = dict(row.get("metadata") or {})
        meta.update({
            "originalSize": int(main_bytes),
            "width": int(width),
            "height": int(height),
            "replacedAt": now.isoformat(),
            "replacedBy": "ai-bot (z.ai)",
            "watermarked": False,
            "watermarkRemovedBy": removed_by,
            "replacedFromKey": old_key,
        })
        res = self.col.update_one(
            {"_id": ObjectId(fid)},
            {"$set": {
                "size": int(main_bytes),
                "mime_type": "image/jpeg",
                "url": url,
                "storage_key": main_key,
                "thumb_url": thumb_url,
                "thumb_storage_key": thumb_key,
                "metadata": meta,
                "has_watermark": False,
                "watermark_fixed_at": now,
                "updated_at": now,
            }},
        )
        return res.modified_count == 1
