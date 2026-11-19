"""استوریج آروان (سازگار با S3) — دانلود عمومی، آپلود کلید نسخه‌دار، حذف کلید قدیمی.

قراردادها همان deploy قبلی است:
- کلید نسخه‌دار: name.ext → name.r<timestamp>.ext
- ACL عمومی + CacheControl immutable
- نقطهٔ پایان ممکن است با نام باکت شروع شود (bucket-hosted) یا path-style باشد
"""
import time
from urllib.parse import urlparse

import boto3
import requests
from botocore.config import Config as BotoConfig


def http_download(url, timeout=25, retries=3, min_bytes=1000):
    """دانلود از URL عمومی (CDN) با تلاش مجدد."""
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, timeout=timeout)
            if r.status_code == 200 and len(r.content) >= min_bytes:
                return r.content
            last = "HTTP %s" % r.status_code
        except Exception as e:  # noqa: BLE001
            last = str(e)[:100]
        time.sleep(1 + i)
    raise RuntimeError("download failed: %s (%s)" % (url[:120], last))


class Arvan:
    def __init__(self, endpoint, region, access_key, secret_key, bucket):
        u = urlparse(endpoint)
        host = u.hostname
        bucket_hosted = host.startswith(bucket + ".")
        api_host = host[len(bucket) + 1:] if bucket_hosted else host
        self.api_endpoint = "%s://%s" % (u.scheme, api_host)
        self.public_base = (
            ("%s://%s" % (u.scheme, host)) if bucket_hosted
            else ("%s://%s/%s" % (u.scheme, host, bucket))
        ).rstrip("/")
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=self.api_endpoint,
            region_name=region or "us-east-1",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=BotoConfig(
                retries={"max_attempts": 4},
                connect_timeout=8,
                read_timeout=20,
                s3={"addressing_style": "path"},
            ),
        )

    def public_url(self, key):
        return "%s/%s" % (self.public_base, key)

    def versioned_key(self, key):
        """کلید جدید با مُهر زمانی — بدون بازنویسی شیء قدیمی (immutable cache)."""
        slash = key.rfind("/")
        dot = key.rfind(".")
        if dot > slash:
            return "%s.r%d.%s" % (key[:dot], int(time.time() * 1000), key[dot + 1:])
        return "%s.r%d" % (key, int(time.time() * 1000))

    def put(self, key, body, content_type="image/jpeg"):
        self.s3.put_object(
            Bucket=self.bucket, Key=key, Body=body, ContentType=content_type,
            ACL="public-read", CacheControl="public, max-age=31536000, immutable",
        )

    def delete(self, key):
        try:
            self.s3.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False

    def exists(self, url, timeout=15):
        try:
            return requests.get(url, timeout=timeout).status_code == 200
        except Exception:  # noqa: BLE001
            return False
