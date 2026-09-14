"""图片上传存储：本地磁盘（默认）→ S3 兼容云存储（可选）。

设计取舍
--------
* **不依赖 PIL / 不做服务端图像处理**：线上服务器装了 PIL、本地测试环境没有 ——
  一旦依赖它，测试与生产行为就不一致。这里只做**魔数校验 + 原样落盘**，
  真正的压缩由客户端在**上传前**用 canvas 完成（见 ``src/services/UploadService.ts``）。
* 默认本地磁盘 + ``/media`` 静态挂载：**零凭据即可跑通**，方便自测与内网部署；
  生产建议配 ``STORAGE_BACKEND=s3`` 指向 Supabase Storage / Azure Blob（S3 网关）/ R2。
* 未装 boto3 或凭据不全 → **自动降级为本地**并打印原因（与 ``apns.py`` 的降级策略一致：
  绝不因为存储没配好就让"发帖"这个核心功能失败）。
"""
from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from .config import settings

#: 允许的图片 MIME（严格白名单 —— 仅靠扩展名判断会被改名绕过）
ALLOWED_IMAGE_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
}

#: 魔数 → MIME。**不信任客户端上报的 content-type**，一律按字节签名判定。
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),  # 需再确认第 8-12 字节是 WEBP，见 sniff_image_type
)

#: HEIC/HEIF 都是 ISO-BMFF：第 4-8 字节是 'ftyp'，品牌在 8-12 字节
_FTYP_BRANDS = {
    b"heic": "image/heic",
    b"heix": "image/heic",
    b"hevc": "image/heic",
    b"hevx": "image/heic",
    b"mif1": "image/heif",
    b"msf1": "image/heif",
    b"heif": "image/heif",
}


class UploadError(Exception):
    """上传被拒（带机器可读的 reason，路由把它映射成 4xx）。"""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class StoredFile:
    """落盘成功后的结果。``url`` 是**绝对地址**，客户端可直接渲染。"""

    url: str
    key: str
    size: int
    content_type: str


def sniff_image_type(data: bytes) -> str | None:
    """按文件头判断图片类型；无法识别返回 None（→ 拒绝上传）。"""
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            if mime == "image/webp" and data[8:12] != b"WEBP":
                return None
            return mime
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return _FTYP_BRANDS.get(data[8:12])
    return None


def validate_image(data: bytes) -> str:
    """校验字节并返回 MIME；不合法直接抛 UploadError。"""
    if not data:
        raise UploadError("empty", "文件为空")
    if len(data) > settings.upload_max_bytes:
        limit_mb = settings.upload_max_bytes / (1024 * 1024)
        raise UploadError("too-large", f"图片超过 {limit_mb:.0f} MB 上限")
    mime = sniff_image_type(data)
    if mime is None:
        raise UploadError(
            "unsupported-type",
            "只支持 JPEG / PNG / WebP / GIF / HEIC 图片（按文件头判定）",
        )
    return mime


def _object_key(mime: str) -> str:
    """生成对象键：``YYYY/MM/<uuid>.<ext>``。

    文件名用随机 uuid —— **不带用户 id / 学号**，避免 URL 泄露上传者身份
    （校园社区的匿名约定要求这一点）。
    """
    now = datetime.now(timezone.utc)
    ext = ALLOWED_IMAGE_TYPES.get(mime, "bin")
    return f"{now:%Y/%m}/{uuid.uuid4().hex}.{ext}"


class Storage(Protocol):
    name: str

    async def save(self, *, data: bytes, content_type: str) -> StoredFile: ...

    async def delete(self, key: str) -> None: ...


class LocalStorage:
    """本地磁盘存储 + ``/media`` 静态挂载（默认后端）。"""

    name = "local"

    def __init__(self, root: str | None = None, public_base: str | None = None) -> None:
        # 相对路径按**进程工作目录**解析（线上是 /opt/kaznu11-main）
        self.root = Path(root or settings.upload_dir).resolve()
        self.public_base = (public_base or settings.public_base_url).rstrip("/")

    async def save(self, *, data: bytes, content_type: str) -> StoredFile:
        key = _object_key(content_type)
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        # 写盘是阻塞 IO：丢到线程池，别卡住事件循环
        await asyncio.to_thread(target.write_bytes, data)
        return StoredFile(
            url=f"{self.public_base}/media/{key}",
            key=key,
            size=len(data),
            content_type=content_type,
        )

    async def delete(self, key: str) -> None:
        target = (self.root / key).resolve()
        # 防目录穿越：key 必须落在 root 之内
        if not str(target).startswith(str(self.root)):
            return
        await asyncio.to_thread(lambda: target.unlink(missing_ok=True))


class S3CompatStorage:
    """S3 兼容对象存储（Supabase Storage / Azure Blob S3 网关 / R2 / MinIO）。

    惰性导入 boto3：没装就**自动降级为本地**（不会让上传接口 500）。
    """

    name = "s3"

    def __init__(self) -> None:
        self.bucket = settings.s3_bucket
        self.public_base = settings.s3_public_base.rstrip("/")
        self._client: Any | None = None

    def _build(self) -> Any | None:
        if self._client is not None:
            return self._client
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError:
            print("[kaznu] ⚠️ 未安装 boto3，图片存储降级为本地磁盘（安装：pip install boto3）")
            return None
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url or None,
            region_name=settings.s3_region or None,
            aws_access_key_id=settings.s3_access_key_id or None,
            aws_secret_access_key=settings.s3_secret_access_key or None,
        )
        return self._client

    async def save(self, *, data: bytes, content_type: str) -> StoredFile:
        client = self._build()
        if client is None:
            return await LocalStorage().save(data=data, content_type=content_type)
        key = _object_key(content_type)
        await asyncio.to_thread(
            lambda: client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000, immutable",
            )
        )
        base = self.public_base or f"{settings.s3_endpoint_url.rstrip('/')}/{self.bucket}"
        return StoredFile(url=f"{base}/{key}", key=key, size=len(data), content_type=content_type)

    async def delete(self, key: str) -> None:
        client = self._build()
        if client is None:
            return
        await asyncio.to_thread(lambda: client.delete_object(Bucket=self.bucket, Key=key))


def _choose() -> Storage:
    """按配置选择后端；s3 但凭据不全时降级本地并说明原因。"""
    if settings.storage_backend == "s3":
        if not (settings.s3_bucket and settings.s3_access_key_id and settings.s3_secret_access_key):
            print(
                "[kaznu] ⚠️ STORAGE_BACKEND=s3 但缺少 S3_BUCKET / S3_ACCESS_KEY_ID / "
                "S3_SECRET_ACCESS_KEY，图片存储降级为本地磁盘"
            )
        else:
            return S3CompatStorage()
    return LocalStorage()


#: 进程内单例
storage: Storage = _choose()


def storage_status() -> dict[str, Any]:
    """供 ``GET /uploads/status`` 自检（不泄露密钥）。"""
    local_root = LocalStorage().root
    try:
        local_root.mkdir(parents=True, exist_ok=True)
        writable = os.access(local_root, os.W_OK)
    except Exception:
        writable = False
    return {
        "backend": storage.name,
        "configured_backend": settings.storage_backend,
        "uploads_enabled": settings.uploads_enabled,
        "upload_dir": str(local_root) if storage.name == "local" else None,
        "dir_writable": writable,
        "public_base_url": settings.public_base_url,
        "max_bytes": settings.upload_max_bytes,
        "allowed_types": sorted(ALLOWED_IMAGE_TYPES),
    }

