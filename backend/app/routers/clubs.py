"""社团 / 组织申请与展示（Campus Hub → Clubs & Events → CreateClubScreen）。

端点一览
--------
* ``POST /clubs/apply``      —— 提交创建申请（multipart/form-data，含社团 Logo 文件）
* ``GET  /clubs``           —— 公开的社团列表（**只返回已通过审核且上架的**）
* ``GET  /clubs/mine``      —— 我提交过的申请（含审核状态 / 驳回原因）
* ``GET  /clubs/categories``—— 分类枚举（前端 Chip 选项，文案由前端 i18n 渲染）

为什么申请状态默认 pending 而不是 approved
-------------------------------------------
需求原文是"存入数据库并默认为 Pending/Approved 状态"。这里**必须选 pending**：
``GET /clubs`` 是公开列表，如果默认 approved，任何人（包括匿名刷子）都能凭空
造出一个带官方 Logo 的"KazNU 官方社团"直接展示给全校。所以默认 pending，
由管理员在 ``/admin`` 里点 **✅ Approve** 后才进入公开列表（并在那一刻通知申请人）。

头像上传
--------
复用 ``/uploads/image`` 同一套存储与校验（魔数白名单 + 随机 key），
所以这里**不做第二套实现**：直接调 ``storage.save``，并把 ``validate_image``
的失败映射成与原接口一致的 413 / 415 状态码。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_session
from ..deps import get_current_user
from ..models import CLUB_CATEGORIES, ClubApplication, User
from ..push import notify_user
from ..schemas import ClubApplicationOut, ClubCreatedOut, ClubOut, Page
from ..storage import UploadError, storage, validate_image

router = APIRouter(tags=["clubs"])

_PENDING_MSG = "Application submitted. An administrator will review it shortly."

#: 分类文案由前端 i18n 渲染，这里只回枚举值（保持"后端不产文案"的一致约定）
CATEGORY_IDS: tuple[str, ...] = CLUB_CATEGORIES


def _sanitize_contact(value: str | None, limit: int) -> str | None:
    """联系方式清洗：去空白、限长、拒绝控制字符（防止在通知/邮件里注入换行）。"""
    if value is None:
        return None
    cleaned = "".join(ch for ch in " ".join(value.split()) if ch.isprintable()).strip()
    return cleaned[:limit] or None


async def _save_avatar(upload: UploadFile | None) -> str | None:
    """把社团 Logo 存进对象存储，返回可直接渲染的绝对 URL。"""
    if upload is None:
        return None
    data = await upload.read()
    if not data:
        return None
    if not settings.uploads_enabled:
        raise HTTPException(status_code=503, detail="上传功能当前已关闭，请稍后再试")
    try:
        mime = validate_image(data)
    except UploadError as exc:
        raise HTTPException(status_code=413 if exc.reason == "too-large" else 415, detail=exc.detail)
    stored = await storage.save(data=data, content_type=mime)
    return stored.url


def _to_club_out(row: ClubApplication) -> ClubOut:
    """公开视图：**不带手机号**（个人信息不进公开列表）。"""
    return ClubOut(
        id=row.id,
        club_name=row.club_name,
        category=row.category,
        description=row.description,
        avatar_url=row.avatar_url,
        contact_name=row.contact_name,
        contact_telegram=row.contact_telegram,
        created_at=row.created_at,
    )


def _to_application_out(row: ClubApplication) -> ClubApplicationOut:
    """申请人自己 / 管理员视图：带状态、备注与自己的手机号。"""
    return ClubApplicationOut(
        id=row.id,
        club_name=row.club_name,
        category=row.category,
        description=row.description,
        avatar_url=row.avatar_url,
        contact_name=row.contact_name,
        contact_telegram=row.contact_telegram,
        contact_phone=row.contact_phone,
        status=row.status,
        is_visible=bool(row.is_visible),
        review_note=row.review_note,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.get("/clubs/categories", response_model=list[str])
async def club_categories() -> list[str]:
    """社团分类枚举（前端 Chips 用；只回 id，文案由 i18n 提供）。"""
    return list(CATEGORY_IDS)


@router.get("/clubs", response_model=Page[ClubOut])
async def list_clubs(
    category: str | None = Query(default=None, max_length=24),
    q: str | None = Query(default=None, max_length=120, description="按社团名模糊搜索"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> Page[ClubOut]:
    """公开社团列表（只用 ``GET /clubs`` 这一条读取路径，分页信封统一）。"""
    clauses = [ClubApplication.status == "approved", ClubApplication.is_visible.is_(True)]
    if category:
        if category not in CATEGORY_IDS:
            raise HTTPException(status_code=422, detail=f"category 必须是 {CATEGORY_IDS} 之一")
        clauses.append(ClubApplication.category == category)
    if q and q.strip():
        clauses.append(ClubApplication.club_name.ilike(f"%{q.strip()}%"))

    total = await session.scalar(select(func.count(ClubApplication.id)).where(*clauses)) or 0
    rows = (
        await session.scalars(
            select(ClubApplication)
            .where(*clauses)
            .order_by(ClubApplication.created_at.desc(), ClubApplication.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return Page[ClubOut](
        items=[_to_club_out(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(rows) < total,
    )


@router.get("/clubs/mine", response_model=list[ClubApplicationOut])
async def my_club_applications(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ClubApplicationOut]:
    """我提交过的社团申请（含 pending / rejected，便于在 App 里看到进度）。"""
    rows = (
        await session.scalars(
            select(ClubApplication)
            .where(ClubApplication.user_id == current.id)
            .order_by(ClubApplication.created_at.desc())
        )
    ).all()
    return [_to_application_out(row) for row in rows]


@router.post("/clubs/apply", response_model=ClubCreatedOut, status_code=201)
async def apply_for_club(
    club_name: str = Form(..., min_length=2, max_length=160),
    category: str = Form(default="academic"),
    description: str | None = Form(default=None, max_length=2000),
    contact_name: str | None = Form(default=None, max_length=120),
    contact_telegram: str | None = Form(default=None, max_length=120),
    contact_phone: str | None = Form(default=None, max_length=40),
    avatar: UploadFile | None = File(default=None, description="社团 Logo（可选，单张图片）"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ClubCreatedOut:
    """提交社团创建申请（multipart/form-data）。

    与 JSON 接口的差异：**文件 + 字段混传必须用 multipart**，所以字段走 ``Form``
    而不是 Pydantic body —— 这也是需求里明确要求的形状。

    * 需要登录（社团创建是实名行为，申请人即责任人）；
    * ``contact_name`` 留空时自动回填当前登录学生的全局显示名（需求里的"自动关联"）；
    * ``category`` 必须是 ``GET /clubs/categories`` 里的值；
    * 提交成功即写一条站内通知（申请人可在通知中心看到"已收到申请"）。
    """
    name = " ".join(club_name.split()).strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="社团名称至少 2 个字符")
    if category not in CATEGORY_IDS:
        raise HTTPException(status_code=422, detail=f"category 必须是 {CATEGORY_IDS} 之一")

    # 同一用户 + 同名社团只允许有一条未审核的申请（防止连点提交刷出一堆重复记录）
    duplicate = await session.scalar(
        select(ClubApplication).where(
            ClubApplication.user_id == current.id,
            ClubApplication.club_name == name,
            ClubApplication.status == "pending",
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="你已经提交过同名社团，正在等待审核")

    avatar_url = await _save_avatar(avatar)

    row = ClubApplication(
        user_id=current.id,
        club_name=name,
        category=category,
        description=(description or "").strip() or None,
        avatar_url=avatar_url,
        # 需求要求"自动关联当前登录学生"：留空就回填显示名
        contact_name=_sanitize_contact(contact_name, 120) or current.global_display_name,
        contact_telegram=_sanitize_contact(contact_telegram, 120),
        contact_phone=_sanitize_contact(contact_phone, 40),
        status="pending",
        is_visible=True,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    # 回执：申请人能在通知中心看到"已收到"（审核结果由管理员动作触发第二条）
    await notify_user(
        session,
        user_id=current.id,
        kind="system",
        title=name,
        body="Your club application was received and is waiting for review.",
        route="campus",
        route_id=row.id,
        dedupe_key=f"club-apply:{row.id}",
    )

    return ClubCreatedOut(message=_PENDING_MSG, club=_to_application_out(row))

