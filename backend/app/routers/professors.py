"""Professor search/browse endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import get_session
from ..models import Course, Professor, Review
from ..schemas import CourseSummary, ProfessorDetail, ProfessorSummary

router = APIRouter(prefix="/professors", tags=["professors"])


def _build_summary(professor: Professor, stats: tuple[int, float, float]) -> ProfessorSummary:
    count, avg_easy, avg_quality = stats
    return ProfessorSummary(
        id=professor.id,
        name=professor.name,
        department=professor.department,
        avatar_url=professor.avatar_url,
        rating_easy=round(avg_easy or 0.0, 1),
        rating_quality=round(avg_quality or 0.0, 1),
        review_count=count or 0,
    )


@router.get("", response_model=list[ProfessorSummary])
async def list_professors(
    q: str | None = Query(default=None, max_length=120),
    department: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[ProfessorSummary]:
    clause = []
    if q:
        like = f"%{q.strip()}%"
        clause.append(or_(Professor.name.ilike(like), Professor.department.ilike(like)))
    if department:
        clause.append(Professor.department == department.strip())

    professors = (
        await session.scalars(
            select(Professor)
            .where(*clause)
            .order_by(Professor.name)
            .limit(limit)
            .offset(offset)
        )
    ).all()

    if not professors:
        return []

    rows = (
        await session.execute(
            select(
                Review.professor_id,
                func.count(Review.id),
                func.avg(Review.rating_easy),
                func.avg(Review.rating_quality),
            )
            .where(Review.professor_id.in_([p.id for p in professors]))
            .group_by(Review.professor_id)
        )
    ).all()
    stats = {pid: (count, avg_easy, avg_quality) for pid, count, avg_easy, avg_quality in rows}
    return [
        _build_summary(p, stats.get(p.id, (0, 0.0, 0.0))) for p in professors
    ]


@router.get("/{professor_id}", response_model=ProfessorDetail)
async def get_professor(
    professor_id: str,
    session: AsyncSession = Depends(get_session),
) -> ProfessorDetail:
    professor = await session.scalar(select(Professor).where(Professor.id == professor_id))
    if professor is None:
        raise HTTPException(status_code=404, detail="Professor not found")

    count, avg_easy, avg_quality = (
        await session.execute(
            select(
                func.count(Review.id),
                func.avg(Review.rating_easy),
                func.avg(Review.rating_quality),
            ).where(Review.professor_id == professor.id)
        )
    ).one()

    # Courses this professor has been reviewed for, with per-course aggregates.
    course_rows = (
        await session.execute(
            select(
                Course,
                func.count(Review.id),
                func.avg(Review.rating_quality),
            )
            .join(Review, Review.course_id == Course.id)
            .where(Review.professor_id == professor.id)
            .group_by(Course.id)
        )
    ).all()
    courses = [
        CourseSummary(
            id=c.id,
            code=c.code,
            title=c.title,
            department=c.department,
            credits=c.credits,
            review_count=cnt,
            rating_quality=round(avg_q or 0.0, 1),
        )
        for c, cnt, avg_q in course_rows
    ]

    summary = _build_summary(professor, (count, avg_easy, avg_quality))
    detail = ProfessorDetail(**summary.model_dump())
    detail.courses = courses
    return detail
