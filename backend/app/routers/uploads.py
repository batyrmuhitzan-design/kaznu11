"""图片上传（本地相册 → FormData → 存储 → URL）。

为什么要服务端中转，而不是客户端直传云存储
-----------------------------------------
* 直传需要把云存储的密钥下发到客户端 → 泄露风险极高；
* 中转才能做**服务端校验**（魔数白名单、大小上限）与**统一命名**（随机 key，不带用户信息）；
* 未配云存储时本地磁盘也能跑通，迁移到 Supabase / Azure 只是换 ``STORAGE_BACKEND``。

客户端（``src/services/UploadService.ts``）在上传前会先用 canvas 压缩：
把 iPhone 原图（3-8 MB、4032×3024）压到 ~1600px / JPEG 0.82（~300-600 KB），
既省流量也避免慢网络下发帖卡住。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..config import settings
from ..deps import get_current_user, require_staff
from ..models import User
from ..schemas import UploadedImageOut, UploadStatusOut
from ..storage import UploadError, storage, storage_status, validate_image

router = APIRouter(tags=["uploads"])

#: 单次请求最多几张（前端一次选图的上限，与发帖/私信一致）
MAX_FILES_PER_REQUEST = 6


async def _store_one(upload: UploadFile) -> UploadedImageOut:
    data = await upload.read()
    try:
        mime = validate_image(data)
    except UploadError as exc:
        raise HTTPException(status_code=413 if exc.reason == "too-large" else 415, detail=exc.detail)
    stored = await storage.save(data=data, content_type=mime)
    return UploadedImageOut(
        url=stored.url, key=stored.key, size=stored.size, content_type=stored.content_type
    )


@router.post("/uploads/image", response_model=list[UploadedImageOut], status_code=201)
async def upload_images(
    files: list[UploadFile] = File(..., description="图片文件（支持多张，最多 6 张）"),
    _current: User = Depends(get_current_user),
) -> list[UploadedImageOut]:
    """上传 1-6 张图片，返回可直接渲染的绝对 URL 列表。

    * 需要登录（匿名用户不能上传，防止被当作免费图床）；
    * **按文件头**校验类型，不信任客户端的 content-type；
    * 单张上限由 ``UPLOAD_MAX_BYTES``（默认 8 MB）控制，超限返回 413。
    """
    if not settings.uploads_enabled:
        raise HTTPException(status_code=503, detail="上传功能当前已关闭")
    if not files:
        raise HTTPException(status_code=400, detail="没有收到文件")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400, detail=f"一次最多上传 {MAX_FILES_PER_REQUEST} 张图片"
        )
    return [await _store_one(upload) for upload in files]


@router.delete("/uploads/image", response_model=dict)
async def delete_image(
    key: str,
    _staff: User = Depends(require_staff),
) -> dict:
    """删除一张图片（**仅 staff**，用于内容下架）。

    不做"上传者才能删"的判断是刻意的：我们**不记录图片归属**（避免 URL ↔ 身份关联，
    符合社区匿名约定），所以删除权限只给管理员。
    """
    await storage.delete(key)
    return {"message": "Deleted.", "key": key}


@router.get("/uploads/status", response_model=UploadStatusOut)
async def upload_status(_staff: User = Depends(require_staff)) -> UploadStatusOut:
    """上传服务自检（staff）：后端类型、目录可写性、大小上限、允许类型。"""
    return UploadStatusOut(**storage_status())