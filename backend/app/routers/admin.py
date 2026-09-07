"""Admin self-service: 普通学生提交“管理员申请”。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import get_current_user
from ..models import APPLICATION_PENDING, ROLE_USER, AdminApplication, User
from ..schemas import AdminApplicationOut, AdminApplyIn, AdminApplyOut

router = APIRouter(prefix="/admin", tags=["admin"])


async def _to_out(app: AdminApplication) -> AdminApplicationOut:
    return AdminApplicationOut(
        id=app.id,
        user_id=app.user_id,
        username=app.user.univer_username,
        display_name=app.user.global_display_name,
        reason=app.reason,
        status=app.status,
        created_at=app.created_at,
    )


@router.post("/apply", response_model=AdminApplyOut, status_code=201)
async def apply_for_admin(
    payload: AdminApplyIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AdminApplyOut:
    """普通用户（role=user）申请成为管理员。"""
    if current.role != ROLE_USER:
        raise HTTPException(status_code=400, detail="Only regular students may apply")

    existing = await session.scalar(
        select(AdminApplication).where(
            AdminApplication.user_id == current.id,
            AdminApplication.status == APPLICATION_PENDING,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already have a pending application")

    app = AdminApplication(user_id=current.id, reason=payload.reason.strip())
    session.add(app)
    await session.commit()
    await session.refresh(app)
    # eager-load applicant for the serialized response
    loaded = await session.scalar(
        select(AdminApplication).where(AdminApplication.id == app.id)
    )
    # relationship lazy load within same session is fine
    return AdminApplyOut(message="Application submitted for review", application=await _to_out(loaded))
