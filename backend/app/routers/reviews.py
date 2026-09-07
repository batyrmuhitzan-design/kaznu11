"""Anonymized review endpoints + anti-spam / anti-fraud logic."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import get_session
from ..deps import get_current_user, limiter
from ..models import Course, Professor, Review, User
from ..schemas import ReviewCreated, ReviewEligibility, ReviewIn, ReviewOut
from ..security import anonymous_hash

router = APIRouter(prefix="/reviews", tags=["reviews"])

_STATUS_MESSAGE = "Review saved anonymously. Your identity is never shown on this rating."


def _to_out(review: Review) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        professor_id=review.professor_id,
        course_id=review.course_id,
        course_code=review.course.code if review.course else None,
        course_title=review.course.title if review.course else None,
        rating_easy=review.rating_easy,
        rating_quality=review.rating_quality,
        attendance_strictness=review.attendance_strictness,
        comment=review.comment,
        tags=review.tags or [],
        likes_count=review.likes_count,
        user_department_tag=review.user_department_tag,
        created_at=review.created_at,
    )


@router.get("/eligibility", response_model=ReviewEligibility)
async def review_eligibility(
    professor_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewEligibility:
    """A single account may rate a given professor only once (anonymous_hash based)."""
    professor = await session.scalar(select(Professor).where(Professor.id == professor_id))
    if professor is None:
        raise HTTPException(status_code=404, detail="Professor not found")
    existing = await session.scalar(
        select(Review).where(
            Review.professor_id == professor_id,
            Review.anonymous_hash == anonymous_hash(current.univer_username),
        )
    )
    if existing:
        return ReviewEligibility(can_review=False, existing_review_id=existing.id)
    return ReviewEligibility(can_review=True)


@router.get("", response_model=list[ReviewOut])
async def list_reviews(
    professor_id: str | None = None,
    course_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
) -> list[ReviewOut]:
    """Public review feed — anonymized: shows only department tags, never usernames."""
    clause = []
    if professor_id:
        clause.append(Review.professor_id == professor_id)
    if course_id:
        clause.append(Review.course_id == course_id)

    rows = (
        await session.scalars(
            select(Review)
            .options(joinedload(Review.course))
            .where(*clause)
            .order_by(Review.created_at.desc())
            .limit(min(limit, 200))
            .offset(offset)
        )
    ).all()
    return [_to_out(r) for r in rows]

@router.post("", response_model=ReviewCreated, status_code=201)
@limiter.limit("2/minute")
async def create_review(
    request: Request,
    payload: ReviewIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewCreated:
    """Submit one review. Anonymous by design, capped at one per professor per account."""
    professor = await session.scalar(select(Professor).where(Professor.id == payload.professor_id))
    if professor is None:
        raise HTTPException(status_code=404, detail="Professor not found")

    course: Course | None = None
    if payload.course_id:
        course = await session.scalar(select(Course).where(Course.id == payload.course_id))
        if course is None:
            raise HTTPException(status_code=404, detail="Course not found")

    anon_hash = anonymous_hash(current.univer_username)
    existing = await session.scalar(
        select(Review).where(
            Review.professor_id == professor.id,
            Review.anonymous_hash == anon_hash,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="You have already rated this professor once")

    department_tag = (payload.user_department_tag or current.department_tag or "Student").strip()
    review = Review(
        professor_id=professor.id,
        course_id=course.id if course else None,
        rating_easy=payload.rating_easy,
        rating_quality=payload.rating_quality,
        attendance_strictness=payload.attendance_strictness,
        comment=(payload.comment or "").strip() or None,
        tags=payload.tags[:12],
        anonymous_hash=anon_hash,
        user_department_tag=department_tag[:120],
    )
    session.add(review)

    # Keep the professor roll-up current.
    count, avg_easy, avg_quality = (
        await session.execute(
            select(
                func.count(Review.id),
                func.avg(Review.rating_easy),
                func.avg(Review.rating_quality),
            ).where(Review.professor_id == professor.id)
        )
    ).one()
    professor.rating_easy = round(avg_easy or payload.rating_easy, 2)
    professor.rating_quality = round(avg_quality or payload.rating_quality, 2)
    await session.commit()
    await session.refresh(review)
    # Refresh joined course for the response payload.
    review = await session.scalar(
        select(Review).options(joinedload(Review.course)).where(Review.id == review.id)
    )
    return ReviewCreated(id=review.id, message=_STATUS_MESSAGE, review=_to_out(review))


@router.post("/{review_id}/like", response_model=dict)
async def like_review(
    review_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    review = await session.scalar(select(Review).where(Review.id == review_id))
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    review.likes_count = (review.likes_count or 0) + 1
    await session.commit()
    return {"id": review.id, "likes_count": review.likes_count}

