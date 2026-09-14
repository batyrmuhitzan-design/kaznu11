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


# =====================================================================
# Campus Hub —— 校园娱乐与交流社区
# =====================================================================

#: 帖子分类（前后端共用的固定枚举；文案由前端 i18n 渲染，后端只校验）
POST_CATEGORIES = (
    "course_review",  # 选课体验
    "lost_found",     # 寻物启事
    "housing",        # 租房交流
    "hackathon",      # Hackathon / 竞赛组队
    "club",           # 社团招募
    "general",        # 闲聊 / 其他
)

#: 全局紧急通知级别（前端据此上色：info 蓝 / warning 橙 / danger 红）
NOTIFICATION_LEVELS = ("info", "warning", "danger")


class Post(Base):
    """校园墙帖子。

    隐私不变量：``is_anonymous=True`` 的帖子在**任何**响应里都不得带出
    作者 id / 用户名 / 显示名 —— 与 Review 的处理一致，只暴露 frontend 需要的
    ``is_anonymous`` 标志（实名帖才返回作者的全局显示名）。
    """

    __tablename__ = "posts"
    __table_args__ = (
        Index("ix_post_category_created", "category", "created_at"),
        Index("ix_post_hidden_created", "is_hidden", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    category: Mapped[str] = mapped_column(String(24), default="general", index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 图片 / 视频外链（JSON 数组，最多 6 条，只允许 http(s)）
    media_urls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    likes_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 管理员在 /admin 里下架（软删除），软删除后不出现在公开列表
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    author: Mapped[User] = relationship()
    comments: Mapped[list["PostComment"]] = relationship(
        back_populates="post", cascade="all, delete-orphan"
    )


class PostComment(Base):
    """帖子评论（同样支持匿名）。"""

    __tablename__ = "post_comments"
    __table_args__ = (
        Index("ix_post_comment_post_created", "post_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    post_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    post: Mapped[Post] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()


class PostLike(Base):
    """点赞记录。

    需求里的 ``POST /posts/{id}/like`` 是**点赞 / 取消赞**开关，要能正确地"再点一次就取消"，
    就必须记住"谁赞过"。这里沿用评价体系的匿名做法：只存 ``liker_hash``
    （HMAC of Univer 账号），不存任何可反查身份的字段。
    ``Post.likes_count`` 作为冗余计数供列表快速读取，二者在同一事务内更新。
    """

    __tablename__ = "post_likes"
    __table_args__ = (
        UniqueConstraint("post_id", "liker_hash", name="uq_post_like_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    post_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    liker_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ClubEvent(Base):
    """社团 / 讲座活动通告（由社团管理员提交，admin 在后台审核 ``is_approved``）。"""

    __tablename__ = "club_events"
    __table_args__ = (
        Index("ix_club_event_approved_time", "is_approved", "event_time"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    club_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 活动海报外链（只允许 http(s)）
    poster_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 报名 / 外链跳转（只允许 http(s)）
    register_link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 审核开关：只有 True 的活动才会出现在公开列表里
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GlobalNotification(Base):
    """全校级紧急通知（停水停电 / 假期安排 / 考试周提醒），显示为顶部 Push Banner。"""

    __tablename__ = "global_notifications"
    __table_args__ = (
        Index("ix_global_notification_active_created", "is_active", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # info | warning | danger
    level: Mapped[str] = mapped_column(String(16), default="info", index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

