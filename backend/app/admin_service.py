"""Shared logic for admin approvals & user bans (API routers + SQLAdmin share it)."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    APPLICATION_APPROVED,
    APPLICATION_REJECTED,
    ROLE_ADMIN,
    ROLE_SUPER_ADMIN,
    AdminApplication,
    User,
)


async def get_application_or_404(session: AsyncSession, application_id: str) -> AdminApplication:
    app = await session.scalar(select(AdminApplication).where(AdminApplication.id == application_id))
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


async def handle_application(session: AsyncSession, application: AdminApplication, action: str) -> tuple[User, str]:
    """approve → 申请人 role 升为 admin；reject → 仅标记拒绝。返回 (申请人, 新状态)。"""
    applicant = await session.scalar(select(User).where(User.id == application.user_id))
    if applicant is None:
        raise HTTPException(status_code=404, detail="Applicant account not found")
    if application.status not in ("pending",):
        raise HTTPException(status_code=409, detail="Application already handled")

    if action == "approve":
        if applicant.role == ROLE_SUPER_ADMIN:
            raise HTTPException(status_code=409, detail="Applicant is already a super admin")
        applicant.role = ROLE_ADMIN
        applicant.is_banned = False
        application.status = APPLICATION_APPROVED
    else:
        application.status = APPLICATION_REJECTED
    await session.commit()
    return applicant, application.status


async def set_user_banned(session: AsyncSession, user_id: str, is_banned: bool) -> User:
    target = await session.scalar(select(User).where(User.id == user_id))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == ROLE_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super admin cannot be banned")
    target.is_banned = is_banned
    await session.commit()
    await session.refresh(target)
    return target
