"""Super-admin only endpoints: 申请审批 & 用户封禁。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..admin_service import get_application_or_404, handle_application, set_user_banned
from ..database import get_session
from ..deps import require_super_admin
from ..models import AdminApplication, User
from ..schemas import (
    AdminApplicationOut,
    AdminUserOut,
    HandleApplicationIn,
    HandleApplicationOut,
    UserBanIn,
    UserBanOut,
)

router = APIRouter(
    prefix="/super-admin",
    tags=["super-admin"],
    dependencies=[Depends(require_super_admin)],
)


def _application_out(app: AdminApplication) -> AdminApplicationOut:
    return AdminApplicationOut(
        id=app.id,
        user_id=app.user_id,
        username=app.user.univer_username,
        display_name=app.user.global_display_name,
        reason=app.reason,
        status=app.status,
        created_at=app.created_at,
    )


@router.get("/applications", response_model=list[AdminApplicationOut])
async def list_applications(
    status_filter: str = Query(default="pending", alias="status", pattern="^(pending|approved|rejected)$"),
    limit: int = Query(default=100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[AdminApplicationOut]:
    apps = (
        await session.scalars(
            select(AdminApplication)
            .options(joinedload(AdminApplication.user))
            .where(AdminApplication.status == status_filter)
            .order_by(AdminApplication.created_at.asc())
            .limit(limit)
        )
    ).all()
    return [_application_out(app) for app in apps]


@router.post("/applications/{application_id}/handle", response_model=HandleApplicationOut)
async def handle_application_endpoint(
    application_id: str,
    payload: HandleApplicationIn,
    session: AsyncSession = Depends(get_session),
) -> HandleApplicationOut:
    app = await get_application_or_404(session, application_id)
    applicant, new_status = await handle_application(session, app, payload.action)
    return HandleApplicationOut(
        message="Application approved" if payload.action == "approve" else "Application rejected",
        application_id=app.id,
        applicant_user_id=applicant.id,
        status=new_status,
        applicant_role=applicant.role,
    )


@router.post("/users/{user_id}/ban", response_model=UserBanOut)
async def ban_user_endpoint(
    user_id: str,
    payload: UserBanIn,
    session: AsyncSession = Depends(get_session),
) -> UserBanOut:
    target = await set_user_banned(session, user_id, payload.is_banned)
    return UserBanOut(
        message="User banned" if target.is_banned else "User unbanned",
        user=AdminUserOut(
            id=target.id,
            univer_username=target.univer_username,
            global_display_name=target.global_display_name,
            role=target.role,
            is_banned=target.is_banned,
        ),
    )
