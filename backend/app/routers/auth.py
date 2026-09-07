"""Auth: Univer-only login + first-login display-name generation."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import is_univer_account, limiter
from ..models import User
from ..schemas import LoginIn, LoginOut, UserOut
from ..security import create_access_token, random_display_name

router = APIRouter(prefix="/auth", tags=["auth"])

_PASSWORD_HINT = "Univer demo password (see .env DEMO_PASSWORD / DEMO_ALL_PASSWORD)"


async def _get_or_create_user(session: AsyncSession, username: str, password: str) -> tuple[User, bool]:
    from ..config import settings
    from ..models import ROLE_ADMIN, ROLE_SUPER_ADMIN

    username = username.strip().lower()

    # 已存在的 admin / super_admin 账号：允许使用自建域名邮箱等非 Univer 邮箱登录（如 admin@1losion.me）
    existing = await session.scalar(select(User).where(User.univer_username == username))
    if existing and existing.role in (ROLE_ADMIN, ROLE_SUPER_ADMIN):
        if existing.is_banned:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")
        allowed = settings.demo_all_password or password == settings.demo_password
        if settings.super_admin_password:
            allowed = allowed or password == settings.super_admin_password
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return existing, False

    if not is_univer_account(username):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only KazNU Univer accounts are allowed (student ID or @…kaznu.kz e-mail)",
        )

    # Demo gate. In production this check is replaced by backend/scraper.py → Univer.kz.
    demo_all = settings.demo_all_password
    if not demo_all and password != settings.demo_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if existing:
        if existing.is_banned:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")
        return existing, False

    # Assign a random default global display name: user + 7 random digits.
    user = User(
        univer_username=username,
        univer_email=username if "@" in username else f"{username}@student.kaznu.kz",
        global_display_name=random_display_name(),
        department_tag="Student",
    )
    for _attempt in range(5):
        collision = await session.scalar(
            select(User).where(User.global_display_name == user.global_display_name)
        )
        if not collision:
            break
        user.global_display_name = random_display_name()
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user, True


@router.post("/login", response_model=LoginOut)
@limiter.limit("5/minute")
async def login(
    request: Request,
    payload: LoginIn,
    session: AsyncSession = Depends(get_session),
) -> LoginOut:
    """Log in with a KazNU Univer account.

    Demo build: any Univer-shaped student id / @…kaznu.kz login succeeds (DEMO_ALL_PASSWORD=true).
    Enforced here already: username must look like a real Univer account, not an arbitrary alias.
    """
    user, is_new = await _get_or_create_user(session, payload.username, payload.password)
    token = create_access_token(user.id)
    return LoginOut(
        access_token=token,
        user=UserOut.model_validate(user),
        is_new=is_new,
    )
