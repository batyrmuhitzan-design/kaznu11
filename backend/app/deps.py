"""Shared FastAPI dependencies: auth token → User + SlowAPI limiter."""
from __future__ import annotations

import re

from fastapi import Depends, Header, HTTPException, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_session
from .models import ROLE_ADMIN, ROLE_SUPER_ADMIN, User
from .security import decode_access_token

# Rate limiting (per client IP).
#  - POST /auth/login    → 5/minute (brute-force protection)
#  - POST /reviews       → 2/minute (review spam protection)
limiter = Limiter(key_func=get_remote_address, default_limits=[])

# Univer account shape check: student ids (8+ digits) or university e-mail.
_UNIVER_USERNAME_RE = re.compile(
    r"^(?:\d{6,12}|[\w.\-]+@(?:student\.)?(?:univer\.)?kaznu\.kz)$",
    re.IGNORECASE,
)


def is_univer_account(username: str) -> bool:
    """仅允许学校 Univer 账号：学号（纯数字）或 @…kaznu.kz 校园邮箱。"""
    return bool(_UNIVER_USERNAME_RE.fullmatch(username.strip()))


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise credentials_exc
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token)
    if not payload or not payload.get("uid"):
        raise credentials_exc
    user = await session.scalar(select(User).where(User.id == payload["uid"]))
    if user is None:
        raise credentials_exc
    # 被封禁的账号：任何受保护接口一律拒绝（历史 token 也立即失效）
    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended",
        )
    return user


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    """Only `super_admin` may pass."""
    if user.role != ROLE_SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin privileges required",
        )
    return user


def require_staff(user: User = Depends(get_current_user)) -> User:
    """admin 或 super_admin 可访问（SQLAdmin 后台接口预留）。"""
    if user.role not in (ROLE_ADMIN, ROLE_SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff privileges required",
        )
    return user
