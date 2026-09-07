"""Course search/browse endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models import Course, Review
from ..schemas import CourseSummary

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("", response_model=list[CourseSummary])
async def list_courses(
    q: str | None = Query(default=None, max_length=120),
    professor_id: str | None = Query(default=None),
    department: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[CourseSummary]:
    clause = []
    if q:
        like = f"%{q.strip()}%"
        clause.append(or_(Course.code.ilike(like), Course.title.ilike(like), Course.department.ilike(like)))
    if department:
        clause.append(Course.department == department.strip())
    if professor_id:
        clause.append(Course.id.in_(select(Review.course_id).where(Review.professor_id == professor_id)))

    courses = (
        await session.scalars(
            select(Course).where(*clause).order_by(Course.code).limit(limit).offset(offset)
        )
    ).all()
    if not courses:
        return []

    rows = (
        await session.execute(
            select(
                Review.course_id,
                func.count(Review.id),
                func.avg(Review.rating_quality),
            )
            .where(Review.course_id.in_([c.id for c in courses]))
            .group_by(Review.course_id)
        )
    ).all()
    stats = {cid: (cnt, avg_q) for cid, cnt, avg_q in rows}
    return [
        CourseSummary(
            id=c.id,
            code=c.code,
            title=c.title,
            department=c.department,
            credits=c.credits,
            review_count=stats.get(c.id, (0, 0.0))[0],
            rating_quality=round(stats.get(c.id, (0, 0.0))[1] or 0.0, 1),
        )
        for c in courses
    ]
