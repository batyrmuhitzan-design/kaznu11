"""课程资料接口（首页「最新资料 / Соңғы материалдар」卡片 + Materials 页）。

背景（产品修正）
----------------
首页 GPA 卡右侧那张卡片最早被写成"作业 Deadline"，实际业务是
**最新课程教材 / 资料更新**（Course Materials / Standard Learning Content）——
学生真正需要的是"老师刚上传了什么"，而不是"还剩几小时交作业"。
所以后端提供跨课程的"最新 N 条资料"，前端卡片与 Materials 页共用同一数据源。

返回格式
--------
* ``GET /materials/latest``  → ``Page[MaterialOut]``（与 Campus 列表同构的信封）
* ``GET /materials/summary`` → ``MaterialSummaryOut``（首页卡片专用轻量摘要）
* ``POST /materials``        → 仅 staff（教师/管理员）可登记新资料

读取接口**不需要登录**：课程资料是公开教学资源，未登录也应能看到
（与新闻一致；发帖/私信才要求登录）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import require_staff
from ..models import MATERIAL_FORMATS, CourseMaterial, User
from ..schemas import MaterialListOut, MaterialOut, MaterialSummaryOut

router = APIRouter(tags=["materials"])

_CREATED_MSG = "Material registered."


def _sanitize_url(url: str | None) -> str | None:
    """只放行 http(s) 外链（``javascript:`` / ``data:`` 一律丢弃）。

    与 Campus 的 ``media_urls`` 校验同一套规则：宁可字段为空，也不让
    前端把它塞进 ``href`` 造成 XSS。
    """
    if not url:
        return None
    cleaned = url.strip()
    if not cleaned:
        return None
    return cleaned if cleaned.lower().startswith(("http://", "https://")) else None


@router.get("/materials/latest", response_model=MaterialListOut)
async def latest_materials(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    course_code: str | None = Query(default=None, max_length=40, description="只取某门课的资料"),
    file_format: str | None = Query(default=None, description="PDF / PPT / DOC / XLS / ZIP"),
    session: AsyncSession = Depends(get_session),
) -> MaterialListOut:
    """按上传时间倒序取资料（最新的在前）。"""
    clauses = [CourseMaterial.is_visible.is_(True)]
    if course_code:
        clauses.append(CourseMaterial.course_code == course_code.strip())
    if file_format:
        fmt = file_format.strip().upper()
        if fmt not in MATERIAL_FORMATS:
            raise HTTPException(status_code=422, detail=f"file_format 必须是 {MATERIAL_FORMATS} 之一")
        clauses.append(CourseMaterial.file_format == fmt)

    total = await session.scalar(select(func.count(CourseMaterial.id)).where(*clauses)) or 0
    rows = (
        await session.scalars(
            select(CourseMaterial)
            .where(*clauses)
            .order_by(CourseMaterial.created_at.desc(), CourseMaterial.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return MaterialListOut(
        items=[MaterialOut.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(rows) < total,
    )


@router.get("/materials/summary", response_model=MaterialSummaryOut)
async def materials_summary(session: AsyncSession = Depends(get_session)) -> MaterialSummaryOut:
    """首页卡片专用：最新一条 + 总数 + 涉及课程数。

    首页只有一个 2 行高的卡片，拉整页（20 条）纯属浪费流量；
    这里一次查询聚合出三个数，卡片渲染完即可。
    """
    latest = await session.scalar(
        select(CourseMaterial)
        .where(CourseMaterial.is_visible.is_(True))
        .order_by(CourseMaterial.created_at.desc(), CourseMaterial.id.desc())
        .limit(1)
    )
    total = await session.scalar(
        select(func.count(CourseMaterial.id)).where(CourseMaterial.is_visible.is_(True))
    ) or 0
    course_count = await session.scalar(
        select(func.count(func.distinct(CourseMaterial.course_code))).where(
            CourseMaterial.is_visible.is_(True)
        )
    ) or 0
    return MaterialSummaryOut(
        latest=MaterialOut.model_validate(latest) if latest else None,
        total=total,
        course_count=course_count,
    )


@router.post("/materials", response_model=MaterialOut, status_code=201)
async def create_material(
    course_code: str = Query(..., max_length=40),
    course_title: str = Query(..., max_length=200),
    file_name: str = Query(..., max_length=240),
    file_format: str = Query(default="PDF"),
    professor_name: str | None = Query(default=None, max_length=160),
    size_label: str | None = Query(default=None, max_length=24),
    pages: int | None = Query(default=None, ge=1, le=10000),
    file_url: str | None = Query(default=None, max_length=500),
    _staff: User = Depends(require_staff),
    session: AsyncSession = Depends(get_session),
) -> MaterialOut:
    """登记一条资料（**仅 staff**）。

    用 query 参数而不是 JSON body 是为了让 ``curl -X POST '…?course_code=…'``
    一行就能建数据（教师端接入前的过渡手段，也是自动化测试最省事的形状）。
    """
    fmt = file_format.strip().upper()
    if fmt not in MATERIAL_FORMATS:
        raise HTTPException(status_code=422, detail=f"file_format 必须是 {MATERIAL_FORMATS} 之一")

    row = CourseMaterial(
        course_code=course_code.strip(),
        course_title=course_title.strip(),
        professor_name=(professor_name or "").strip() or None,
        file_name=file_name.strip(),
        file_format=fmt,
        size_label=(size_label or "").strip() or None,
        pages=pages,
        file_url=_sanitize_url(file_url),
        uploaded_by=_staff.global_display_name,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return MaterialOut.model_validate(row)
