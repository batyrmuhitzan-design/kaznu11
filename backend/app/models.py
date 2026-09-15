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
    #: **News 板块融合**：官方公告帖 —— 置顶在 Feed 顶部、带官方徽章，只有 staff 能创建
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    #: 徽章 key（默认 kaznu.official）；存 key 不存文案，前端按语言取本地化字符串
    official_badge: Mapped[str | None] = mapped_column(String(40), nullable=True)
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


# =====================================================================
# Live Activity 远程推送（APNs）
# =====================================================================

#: APNs 环境：开发构建用 sandbox，TestFlight / App Store 用 production
APNS_ENVIRONMENTS = ("sandbox", "production")


class UserLesson(Base):
    """用户的课表条目（服务器侧副本）。

    为什么服务器也要存课表：Live Activity 的「课前自动弹卡片」必须由**服务器定时任务**
    发起，而 App 那时可能已被划掉、完全不在运行。客户端通过 ``POST /lessons/sync``
    把课表同步上来，调度器据此计算每节课的开课时刻。

    ``course_key`` 是客户端与服务器共用的稳定键（同一门课同一时间段 = 同一个 key），
    用于推送去重与 Activity 复用。
    """

    __tablename__ = "user_lessons"
    __table_args__ = (
        UniqueConstraint("user_id", "course_key", name="uq_user_lesson_key"),
        Index("ix_user_lesson_weekday_start", "weekday", "start_h", "start_m"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 稳定键（课程 + 星期 + 开始时刻），与 Swift KaznuLesson.id 对应
    course_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    short: Mapped[str | None] = mapped_column(String(24), nullable=True)
    room: Mapped[str | None] = mapped_column(String(80), nullable=True)
    teacher: Mapped[str | None] = mapped_column(String(160), nullable=True)
    #: 0 = 周一 … 6 = 周日（与 Swift KaznuLesson.weekday 保持一致）
    weekday: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    start_h: Mapped[int] = mapped_column(Integer, nullable=False)
    start_m: Mapped[int] = mapped_column(Integer, nullable=False)
    end_h: Mapped[int] = mapped_column(Integer, nullable=False)
    end_m: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def start_minutes(self) -> int:
        return self.start_h * 60 + self.start_m

    def end_minutes(self) -> int:
        return self.end_h * 60 + self.end_m


class LiveActivityRegistration(Base):
    """一台设备的 Live Activity 推送注册信息（每个用户 + 设备一条）。

    两类 token 用途完全不同，不能混用：

    * ``push_to_start_token``：**应用级** token（iOS 17.2+ 的
      ``Activity.pushToStartTokenUpdates``）。服务器用它发 ``event: start``，
      就能在 App **完全没运行**时把倒计时卡片直接推到锁屏 / 灵动岛
      —— 这正是"用户不打开 App 也能弹卡片"的关键。
    * ``device_token``：设备级 APNs token（``didRegisterForRemoteNotifications``），
      用于普通通知推送（本模块只做登记，便于以后复用）。
    """

    __tablename__ = "live_activity_registrations"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_la_reg_user_device"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 客户端自生成的安装标识（卸载重装会变），用于区分同一用户的多台设备
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    device_token: Mapped[str | None] = mapped_column(String(200), nullable=True)
    push_to_start_token: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    #: sandbox | production
    apns_environment: Mapped[str] = mapped_column(String(16), default="sandbox", nullable=False)
    #: 客户端上报的时区（IANA，如 Asia/Almaty）；调度器按用户本地时间算上课时刻
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Almaty", nullable=False)
    #: App 语言（EN / KZ / RU）—— 推送过来的文案由**服务器**生成，
    #: 所以必须在这里记住用户语言，否则锁屏卡片只会显示英文
    locale: Mapped[str] = mapped_column(String(8), default="EN", nullable=False)
    #: 是否开启课程提醒（与 App 内开关联动）
    alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class LiveActivitySession(Base):
    """一条正在运行的 Live Activity（每个 activity_id 一条）。

    ``push_token`` 来自 ``activity.pushTokenUpdates``，**生命周期与 Activity 绑定**：
    只有用它才能发 ``event: update`` / ``event: end`` 去刷新或收起那一张卡片。
    Activity 结束后由客户端 ``DELETE``（服务器也会按 ``ended_at`` 清理历史）。
    """

    __tablename__ = "live_activity_sessions"
    __table_args__ = (
        Index("ix_la_session_user_ended", "user_id", "ended_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    activity_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    push_token: Mapped[str] = mapped_column(String(200), nullable=False)
    course_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    phase: Mapped[str] = mapped_column(String(16), default="preClass", nullable=False)
    #: 当前阶段结束时刻（= 上课时刻 或 下课时刻），调度器据此决定 update / end
    stage_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    apns_environment: Mapped[str] = mapped_column(String(16), default="sandbox", nullable=False)
    #: push = 服务器推起来的（push-to-start）；local = App 自己起的
    started_by: Mapped[str] = mapped_column(String(16), default="local", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LiveActivityPushLog(Base):
    """已发出的推送记录 —— 调度器去重（幂等）用。

    调度循环每分钟跑一次，绝不能对同一节课重复发 ``start``；
    这里用 ``(user_id, course_key, event)`` 唯一约束兜底。
    """

    __tablename__ = "live_activity_push_log"
    __table_args__ = (
        UniqueConstraint("user_id", "course_key", "event", name="uq_la_push_dedupe"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_key: Mapped[str] = mapped_column(String(120), nullable=False)
    #: start | update | end
    event: Mapped[str] = mapped_column(String(16), nullable=False)
    #: APNs 返回的 HTTP 状态码（200 = 成功；410 = token 失效会被清掉）
    apns_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    pushed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)




# =====================================================================
# 私信 Chat / 通知中心 / 推送设备（Campus 社区功能补全）
# =====================================================================

#: 私信正文长度上限（与前端 maxLength 一致）
MESSAGE_MAX_LEN = 2000
#: 一条消息最多附带的图片数（与发帖 media_urls 上限一致）
MESSAGE_MAX_MEDIA = 6

#: 通知类型
#:   like / comment —— 别人的互动（点赞、评论）
#:   message        —— 收到私信
#:   official       —— 官方公告（News 融合后的置顶帖）
#:   broadcast      —— 全校广播（由 GlobalNotification 承载，不落 UserNotification）
#:   system         —— 其他系统消息
NOTIFICATION_KINDS = ("like", "comment", "message", "official", "broadcast", "system")

#: 官方帖默认徽章 key（前台按 key 取本地化文案，服务器不写死文案）
OFFICIAL_BADGE_DEFAULT = "kaznu.official"

#: 通知点击后的跳转目标（前端路由用）
NOTIFICATION_ROUTES = ("post", "chat", "news", "campus", "none")


class DeviceToken(Base):
    """一台设备的推送 token（每个用户 + 设备一条）。

    与 ``LiveActivityRegistration`` 的分工**必须分清**，否则会互相覆盖：

    * ``live_activity_registrations`` 是 **Live Activity 专用**：除了 device_token
      还存 push-to-start token、时区、课前提醒开关（灵动岛场景）；
    * ``device_tokens`` 是 **通知专用**：全校广播 / 点赞评论 / 私信。
      用户可以关掉灵动岛提醒但继续收通知，所以两者不能合成一张表。

    发推送时把两处的 token 合并去重（见 ``push.push_targets``）。
    """

    __tablename__ = "device_tokens"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_device_token_user_device"),
        Index("ix_device_token_token", "token"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 客户端自生成的安装标识（卸载重装会变）—— 同一用户多台设备去重
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    token: Mapped[str] = mapped_column(String(200), nullable=False)
    #: ios | android
    platform: Mapped[str] = mapped_column(String(16), default="ios", nullable=False)
    #: sandbox | production（开发构建必须 sandbox，否则 APNs 返回 BadDeviceToken）
    environment: Mapped[str] = mapped_column(String(16), default="sandbox", nullable=False)
    #: App 语言 —— 推送文案由**服务器**生成，所以必须记住用户语言
    locale: Mapped[str] = mapped_column(String(8), default="EN", nullable=False)
    #: 通知总开关（App 设置里的"接收推送"）
    alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Conversation(Base):
    """一对一私信会话。

    **参与者用 a/b 两个字段 + 规范化排序**（小的 user_id 放 a），
    这样 ``UniqueConstraint(user_a_id, user_b_id)`` 就能天然防止"同一对用户建出两条会话"，
    不需要额外 join 表 —— 需求只要求一对一私信，不需要群聊。
    """

    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_conversation_pair"),
        Index("ix_conversation_last_message", "last_message_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_a_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_b_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 列表页直接读这两个冗余字段，避免为每条会话再查一次消息表
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    last_message_preview: Mapped[str] = mapped_column(String(140), default="", nullable=False)
    last_sender_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user_a: Mapped[User] = relationship(foreign_keys=[user_a_id])
    user_b: Mapped[User] = relationship(foreign_keys=[user_b_id])

    @staticmethod
    def ordered(user_one: str, user_two: str) -> tuple[str, str]:
        """规范化参与者顺序（保证同一对用户只有一种 (a, b) 组合）。"""
        return (user_one, user_two) if user_one <= user_two else (user_two, user_one)

    def peer_of(self, user_id: str) -> str:
        """取"对方"的 user_id。"""
        return self.user_b_id if self.user_a_id == user_id else self.user_a_id


class Message(Base):
    """私信消息（支持图片附件）。

    ``client_id`` 是**离线队列的幂等键**：客户端断网时把消息排队，恢复后重发可能重复投递，
    靠 ``UniqueConstraint(conversation_id, client_id)`` 保证同一条只落库一次
    （客户端生成 uuid，服务端回显同一条，不产生重复气泡）。
    """

    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_message_conversation_created", "conversation_id", "created_at"),
        UniqueConstraint("conversation_id", "client_id", name="uq_message_client_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    media_urls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    #: 客户端幂等键（uuid；同一条重发只落库一次）
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: 对方读到的时间（null = 未读）
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: 软删除（撤回 / 管理员下架都不物理删行，保留审计轨迹）
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    sender: Mapped[User] = relationship()


class UserNotification(Base):
    """定向通知（点赞 / 评论 / 私信 / 官方公告）。

    **全校广播不写这张表** —— 广播由 ``GlobalNotification`` 承载，否则一次广播要写 N 行
    （N = 用户数）。通知中心把两者合并返回，广播的已读状态用
    ``NotificationReadCursor.broadcasts_read_at`` 一个时间戳表达。
    """

    __tablename__ = "user_notifications"
    __table_args__ = (
        Index("ix_user_notification_user_created", "user_id", "created_at"),
        Index("ix_user_notification_user_unread", "user_id", "is_read"),
        # 幂等：同一个人对同一条帖子反复点赞/取消赞，只留一条通知
        UniqueConstraint("user_id", "dedupe_key", name="uq_user_notification_dedupe"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: like | comment | message | official | system
    kind: Mapped[str] = mapped_column(String(16), default="system", index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    #: 点击后跳哪里：post / chat / news / campus / none
    route: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    #: 跳转目标 id（帖子 id / 会话 id / 新闻 id）
    route_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: 触发者显示名；**匿名互动时留空** —— 与社区匿名约定一致，不因通知泄露身份
    actor_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    #: 去重键（如 like:{post_id}），配合 UniqueConstraint 实现幂等
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class NotificationReadCursor(Base):
    """每个用户的"广播读到哪儿了"游标（配合 GlobalNotification 使用）。

    只需一行/人，就能表达"全校广播的已读状态"，避免每次广播写 N 行 UserNotification。
    """

    __tablename__ = "notification_read_cursors"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    broadcasts_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


# =====================================================================
# 课程资料（首页「最新资料 / Соңғы материалдар」卡片的数据源）
# =====================================================================

#: 资料文件格式（与前端 Materials 页的 DocFormat 一一对应，后端只校验、不渲染文案）
MATERIAL_FORMATS = ("PDF", "PPT", "DOC", "XLS", "ZIP")


class CourseMaterial(Base):
    """教师上传的课程讲义 / PPT / 数据集。

    为什么单独建表而不是复用 ``Course``：一门课在一个学期里会持续新增资料
    （Lecture 1..N、Problem Set、Lab Manual…），首页卡片要的是**跨课程的"最新 N 条"**，
    按 ``created_at`` 倒序取；这正是 ``Course`` 表表达不了的粒度。

    ``course_code`` / ``course_title`` 是**冗余快照**（不是外键）：资料是历史产物，
    课程改名/归档后旧资料的署名必须保持当时的样貌，否则历史记录会被追改。
    """

    __tablename__ = "course_materials"
    __table_args__ = (
        Index("ix_course_material_visible_created", "is_visible", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    #: 如 "CS 201"（冗余快照，见类文档）
    course_code: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    course_title: Mapped[str] = mapped_column(String(200), nullable=False)
    professor_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    file_name: Mapped[str] = mapped_column(String(240), nullable=False)
    #: PDF / PPT / DOC / XLS / ZIP
    file_format: Mapped[str] = mapped_column(String(8), default="PDF", nullable=False)
    #: 人类可读体积（"3.2 MB"）—— 前端只显示，不做计算，所以直接存成品字符串
    size_label: Mapped[str | None] = mapped_column(String(24), nullable=True)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: 下载 / 预览外链（只允许 http(s)）
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    #: 上传者署名（教师 / 助教显示名）
    uploaded_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: 下架开关（软隐藏，不物理删行）
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


# =====================================================================
# 社团 / 组织申请（Campus Hub「申请创建社团」→ CreateClubScreen）
# =====================================================================

#: 社团分类（前端 Chip 选项；文案由前端 i18n 渲染）
CLUB_CATEGORIES = (
    "academic",    # 学术
    "sports",      # 体育
    "arts",        # 艺术
    "tech",        # 科技
    "volunteer",   # 志愿公益
    "media",       # 媒体 / 文化
)

#: 申请状态：pending 待审核 / approved 通过（进入社团列表）/ rejected 驳回
CLUB_APPLICATION_STATUSES = ("pending", "approved", "rejected")


class ClubApplication(Base):
    """学生提交的社团 / 组织创建申请。

    设计要点：

    * ``status`` 默认 ``pending`` —— 按需求"存入数据库并默认为 Pending/Approved 状态"，
      但**绝不能默认 approved**：否则任何人都能凭空在公开列表里造出一个"官方社团"。
      所以默认 pending，由 admin 在 ``/admin`` 里点 Approve；
    * ``user_id`` 记录申请人（与社区匿名不同 —— 社团创建是**实名行为**，
      需要一个可追责的责任人，这也是需求里"自动关联当前登录学生"的含义）；
    * ``contact_name`` 默认取用户全局显示名，但允许覆盖（负责人可能不是申请人）；
    * ``avatar_url`` 存上传后的绝对 URL（走 ``/uploads/image``，不含用户信息）。
    """

    __tablename__ = "club_applications"
    __table_args__ = (
        Index("ix_club_application_status_created", "status", "created_at"),
        Index("ix_club_application_visible_status", "is_visible", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    club_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    #: academic / sports / arts / tech / volunteer / media
    category: Mapped[str] = mapped_column(String(24), default="academic", nullable=False, index=True)
    #: 简介 + 招新宣言
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 社团 Logo（上传后的绝对 URL）
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contact_telegram: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    #: pending | approved | rejected
    status: Mapped[str] = mapped_column(
        String(16), default="pending", index=True, nullable=False
    )
    #: 上架开关（与 status 解耦：已通过的社团也能临时下线）
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    #: 审核备注（驳回原因 / 内部记录）
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    applicant: Mapped[User] = relationship()

