"""Anonymous content reports (admin backend acts on them)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import get_current_user
from ..models import Report, Review, User
from ..schemas import ReportIn
from ..security import anonymous_hash

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", response_model=dict, status_code=201)
async def create_report(
    payload: ReportIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """举报一条评价（匿名）。管理员在 SQLAdmin/后台处理。"""
    review = await session.scalar(select(Review).where(Review.id == payload.review_id))
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    report = Report(
        review_id=review.id,
        reason=(payload.reason or "").strip() or None,
        reporter_hash=anonymous_hash(current.univer_username),
    )
    session.add(report)
    await session.commit()
    return {"message": "Report submitted", "id": report.id}
