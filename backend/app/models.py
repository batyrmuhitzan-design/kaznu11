"""ORM models for the RateMyProf community schema + user identity system."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Roles ----------
ROLE_USER = "user"            # 普通学生
ROLE_ADMIN = "admin"          # 管理员（审核/内容管理）
ROLE_SUPER_ADMIN = "super_admin"  # 超级管理员（审批/封禁）
ADMIN_ROLES = (ROLE_ADMIN, ROLE_SUPER_ADMIN)


class User(Base):
    """Univer account holder. Global display name is generated on first login."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    univer_username: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    # e.g. 20260001@student.kaznu.kz — never exposed publicly.
    univer_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    global_display_name: Mapped[str] = mapped_column(String(40), nullable=False)
    department_tag: Mapped[str] = mapped_column(String(120), default="Student", nullable=False)
    # user / admin / super_admin
    role: Mapped[str] = mapped_column(String(20), default=ROLE_USER, index=True, nullable=False)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Professor(Base):
    __tablename__ = "professors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    rating_easy: Mapped[float] = mapped_column(Float, default=0.0)
    rating_quality: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    reviews: Mapped[list["Review"]] = relationship(back_populates="professor")


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=0)

    reviews: Mapped[list["Review"]] = relationship(back_populates="course")


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        # One account (identified only by anonymous_hash) → at most one rating per professor.
        UniqueConstraint("professor_id", "anonymous_hash", name="uq_review_prof_anon"),
        Index("ix_review_professor_created", "professor_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    professor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("professors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    rating_easy: Mapped[int] = mapped_column(Integer, nullable=False)
    rating_quality: Mapped[int] = mapped_column(Integer, nullable=False)
    attendance_strictness: Mapped[str] = mapped_column(String(24), default="not_mandatory", nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    likes_count: Mapped[int] = mapped_column(Integer, default=0)
    # Server-side hash derived from the Univer account. Never shown in any response.
    anonymous_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    # The ONLY human-visible identity on a review.
    user_department_tag: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    professor: Mapped[Professor] = relationship(back_populates="reviews")
    course: Mapped[Course | None] = relationship(back_populates="reviews")

# ---------- Application statuses ----------
APPLICATION_PENDING = "pending"
APPLICATION_APPROVED = "approved"
APPLICATION_REJECTED = "rejected"


class AdminApplication(Base):
    """普通学生 → 管理员 的申请记录。"""

    __tablename__ = "admin_applications"
    __table_args__ = (
        Index("ix_admin_app_status_created", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=APPLICATION_PENDING, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship()


class Report(Base):
    """对某条 Review 的匿名举报（供 admin / super_admin 在后台处理）。"""

    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    review_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("reviews.id", ondelete="CASCADE"), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 举报人的匿名 hash（同评价体系：永不展示）
    reporter_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

