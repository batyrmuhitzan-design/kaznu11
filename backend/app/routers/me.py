"""Me: current account (display name editor etc)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import get_current_user
from ..models import User
from ..schemas import UpdateDepartmentTagIn, UpdateDisplayNameIn, UserOut

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/display-name", response_model=UserOut)
async def patch_display_name(
    payload: UpdateDisplayNameIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Allow the user to replace the auto-generated global display name."""
    user = await session.scalar(select(User).where(User.id == current.id))
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    duplicate = await session.scalar(
        select(User).where(
            User.global_display_name == payload.display_name,
            User.id != user.id,
        )
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="That display name is already taken")
    user.global_display_name = payload.display_name
    await session.commit()
    await session.refresh(user)
    return user


@router.patch("/department-tag", response_model=UserOut)
async def patch_department_tag(
    payload: UpdateDepartmentTagIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Set the coarse, public-safe label shown on reviews (e.g. 'Data Science Student')."""
    user = await session.scalar(select(User).where(User.id == current.id))
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    user.department_tag = payload.department_tag.strip()
    await session.commit()
    await session.refresh(user)
    return user

