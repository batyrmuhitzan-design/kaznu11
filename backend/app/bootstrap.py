"""Startup bootstrap: ensure the built-in Super Admin account exists."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import ROLE_SUPER_ADMIN, User


async def ensure_super_admin(session: AsyncSession) -> User:
    """Create (or fix) the super admin from environment variables.

    SUPER_ADMIN_USERNAME  默认 superadmin（可用校园邮箱/学号）
    SUPER_ADMIN_PASSWORD  默认留空 = 复用 DEMO_PASSWORD
    """
    username = settings.super_admin_username.strip().lower() or "superadmin"
    user = await session.scalar(select(User).where(User.univer_username == username))
    if user is None:
        user = User(
            univer_username=username,
            univer_email=username if "@" in username else f"{username}@student.kaznu.kz",
            global_display_name="Super Admin",
            department_tag="Admin Team",
            role=ROLE_SUPER_ADMIN,
            is_banned=False,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    elif user.role != ROLE_SUPER_ADMIN:
        user.role = ROLE_SUPER_ADMIN
        user.is_banned = False
        await session.commit()
        await session.refresh(user)
    return user
