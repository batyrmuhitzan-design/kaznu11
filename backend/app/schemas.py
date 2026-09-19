"""Pydantic request/response schemas.

Privacy invariant: review payloads NEVER contain display_name, anonymous_hash,
username or any personally identifying field — only the coarse department tag.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

ATTENDANCE_CHOICES = ["not_mandatory", "recommended", "mandatory"]
DISPLAY_NAME_RE = re.compile(r"^[A-Za-z0-9_]{3,24}$")


# ---------- Identity ----------
class UserOut(BaseModel):
    id: str
    univer_username: str
    global_display_name: str
    department_tag: str
    role: str = "user"
    is_banned: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = True


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    # True only on the very first login (frontend can show “default username assigned”).
    is_new: bool = False


class UpdateDisplayNameIn(BaseModel):
    display_name: str

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if not DISPLAY_NAME_RE.fullmatch(v):
            raise ValueError("Display name must be 3–24 chars using A–Z, a–z, 0–9 or _")
        return v


class UpdateDepartmentTagIn(BaseModel):
    department_tag: str = Field(min_length=2, max_length=120)


# ---------- Professor / Course ----------
class ProfessorSummary(BaseModel):
    id: str
    name: str
    department: str | None
    avatar_url: str | None
    rating_easy: float
    rating_quality: float
    review_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProfessorDetail(ProfessorSummary):
    courses: list["CourseSummary"] = []


class CourseSummary(BaseModel):
    id: str
    code: str | None
    title: str
    department: str | None
    credits: int
    review_count: int = 0
    rating_quality: float | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------- Review ----------
class ReviewIn(BaseModel):
    professor_id: str = Field(min_length=8, max_length=40)
    course_id: str | None = None
    rating_easy: int = Field(ge=1, le=5)
    rating_quality: int = Field(ge=1, le=5)
    attendance_strictness: str = "not_mandatory"
    comment: str | None = Field(default=None, max_length=1200)
    tags: list[str] = Field(default_factory=list, max_length=12)
    user_department_tag: str | None = Field(default=None, max_length=120)

    @field_validator("attendance_strictness")
    @classmethod
    def check_attendance(cls, v: str) -> str:
        if v not in ATTENDANCE_CHOICES:
            raise ValueError(f"attendance_strictness must be one of {ATTENDANCE_CHOICES}")
        return v


class ReviewOut(BaseModel):
    id: str
    professor_id: str
    course_id: str | None
    course_code: str | None = None
    course_title: str | None = None
    rating_easy: int
    rating_quality: int
    attendance_strictness: str
    comment: str | None
    tags: list[str] = []
    likes_count: int
    # Sole public identity — anonymous on purpose.
    user_department_tag: str | None
    created_at: datetime


class ReviewCreated(BaseModel):
    id: str
    message: str
    review: ReviewOut


class ReviewEligibility(BaseModel):
    can_review: bool = True
    reason: str | None = None
    existing_review_id: str | None = None

# ---------- Admin / Super-admin ----------
class AdminApplyIn(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)


class AdminApplicationOut(BaseModel):
    id: str
    user_id: str
    username: str
    display_name: str
    reason: str
    status: str
    created_at: datetime


class AdminApplyOut(BaseModel):
    message: str
    application: AdminApplicationOut


class HandleApplicationIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")


class HandleApplicationOut(BaseModel):
    message: str
    application_id: str
    applicant_user_id: str
    status: str
    applicant_role: str


class AdminUserOut(BaseModel):
    id: str
    univer_username: str
    global_display_name: str
    role: str
    is_banned: bool


class UserBanIn(BaseModel):
    is_banned: bool


class UserBanOut(BaseModel):
    message: str
    user: AdminUserOut


# ---------- Reports（用户举报 → 后台处理） ----------
class ReportIn(BaseModel):
    review_id: str = Field(min_length=8, max_length=40)
    reason: str | None = Field(default=None, max_length=1000)


# =====================================================================
# Campus Hub —— 校园墙 / 社团活动 / 全局通知
# =====================================================================

T = TypeVar("T")

#: 一条帖子最多挂 6 个媒体外链
MAX_MEDIA_ITEMS = 6
#: 只接受 http(s) 外链 —— 挡掉 javascript: / data: 之类的注入面
_HTTP_URL_RE = re.compile(r"^https?://\S+$", re.IGNORECASE)


def _clean_media_urls(urls: list[str]) -> list[str]:
    """校验并规整媒体外链列表（去空、限长、限数量、强制 http(s)）。"""
    cleaned: list[str] = []
    for raw in urls:
        url = (raw or "").strip()
        if not url:
            continue
        if not _HTTP_URL_RE.match(url):
            raise ValueError("media_urls 只接受 http(s):// 开头的外链")
        if len(url) > 500:
            raise ValueError("media_urls 单条链接长度上限 500")
        cleaned.append(url)
    if len(cleaned) > MAX_MEDIA_ITEMS:
        raise ValueError(f"media_urls 最多 {MAX_MEDIA_ITEMS} 条")
    return cleaned


class Page(BaseModel, Generic[T]):
    """统一的分页信封。

    所有**列表型**新接口都返回这一个形状，前端只需要一套解析逻辑：

        { "items": [...], "total": 42, "limit": 20, "offset": 0, "has_more": true }

    注：1.3 时代的老接口（``/api/news``、``/api/v1/reviews`` 等）保持返回裸数组不变，
    以免已发布的客户端解析失败。
    """

    items: list[T]
    total: int
    limit: int
    offset: int
    has_more: bool


class PostAuthorOut(BaseModel):
    """帖子 / 评论的作者信息。

    匿名时 ``name`` / ``department_tag`` / ``id`` **都必须为 None** —— 后端不会把匿名作者
    的任何身份信息发出去（``id`` 也一样：带着它就能反查用户，等于把匿名废掉）。
    实名时额外返回 ``id``，供前端"私信作者"入口调用 ``POST /chat/conversations``（peer_id）。
    """

    is_anonymous: bool
    name: str | None = None
    department_tag: str | None = None
    #: 用户 id —— **仅实名帖返回**（匿名帖恒为 None）
    id: str | None = None


class PostIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    category: str = "general"
    is_anonymous: bool = True
    media_urls: list[str] = Field(default_factory=list)

    @field_validator("content")
    @classmethod
    def strip_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content 不能为空")
        return v

    @field_validator("category")
    @classmethod
    def check_category(cls, v: str) -> str:
        from .models import POST_CATEGORIES

        v = (v or "general").strip().lower()
        if v not in POST_CATEGORIES:
            raise ValueError(f"category 必须是 {list(POST_CATEGORIES)} 之一")
        return v

    @field_validator("media_urls")
    @classmethod
    def check_media_urls(cls, v: list[str]) -> list[str]:
        return _clean_media_urls(v)


class PostOut(BaseModel):
    id: str
    category: str
    content: str
    media_urls: list[str] = []
    is_anonymous: bool
    author: PostAuthorOut
    likes_count: int
    comment_count: int = 0
    #: 当前请求者是否已点赞（未登录恒为 False）
    liked: bool = False
    #: News 板块融合：官方公告帖（Feed 置顶 + 徽章）
    is_official: bool = False
    #: 徽章 key（kaznu.official）；前端按 key 取本地化文案，服务器不写死文案
    official_badge: str | None = None
    created_at: datetime


class PostCreated(BaseModel):
    message: str
    post: PostOut


class LikeOut(BaseModel):
    id: str
    likes_count: int
    liked: bool
    message: str


class CommunityStatusOut(BaseModel):
    """社区入口状态：未配置时前端隐藏按钮，避免"点了没反应"。"""

    enabled: bool
    forum_url: str | None = None


class CommunityLaunchOut(BaseModel):
    """一次性跳转 URL（前端拿到后直接在（应用内）浏览器打开）。"""

    url: str
    expires_in: int


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=800)
    is_anonymous: bool = True

    @field_validator("content")
    @classmethod
    def strip_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content 不能为空")
        return v


class CommentOut(BaseModel):
    id: str
    post_id: str
    content: str
    is_anonymous: bool
    author: PostAuthorOut
    created_at: datetime


class CommentCreated(BaseModel):
    message: str
    comment: CommentOut


class ClubEventOut(BaseModel):
    id: str
    club_name: str
    title: str
    description: str | None = None
    poster_url: str | None = None
    event_time: datetime
    location: str | None = None
    register_link: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GlobalNotificationOut(BaseModel):
    id: str
    title: str
    message: str
    #: info | warning | danger
    level: str
    created_at: datetime
    #: 上一次真正推送的时间（管理员点「📣 Push now」时写入）。
    #: 前端把它拼进"投递 id"做横幅/系统通知去重 —— 否则重复推送不会再次响铃。
    pushed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# =====================================================================
# Live Activity 远程推送（APNs）+ 服务器侧课表
# =====================================================================


class LiveActivityRegistrationIn(BaseModel):
    """App 上报的推送注册信息（token 变更时重复调用即可，按 user+device 覆盖）。"""

    device_id: str = Field(min_length=4, max_length=64)
    device_token: str | None = Field(default=None, max_length=200)
    push_to_start_token: str | None = Field(default=None, max_length=200)
    environment: str = "sandbox"
    timezone: str = Field(default="Asia/Almaty", max_length=64)
    locale: str = Field(default="EN", max_length=8)
    alerts_enabled: bool = True

    @field_validator("environment")
    @classmethod
    def check_environment(cls, v: str) -> str:
        from .models import APNS_ENVIRONMENTS

        value = (v or "sandbox").strip().lower()
        if value not in APNS_ENVIRONMENTS:
            raise ValueError(f"environment 必须是 {list(APNS_ENVIRONMENTS)} 之一")
        return value

    @field_validator("locale")
    @classmethod
    def check_locale(cls, v: str) -> str:
        value = (v or "EN").strip().upper()
        return value if value in {"EN", "KZ", "RU"} else "EN"


class LiveActivityRegistrationOut(BaseModel):
    device_id: str
    has_device_token: bool
    has_push_to_start_token: bool
    environment: str
    timezone: str
    locale: str
    alerts_enabled: bool
    updated_at: datetime


class LiveActivitySessionIn(BaseModel):
    """App 启动 / 发现 Live Activity 后上报它的 push token。"""

    activity_id: str = Field(min_length=4, max_length=120)
    push_token: str = Field(min_length=8, max_length=200)
    course_key: str | None = Field(default=None, max_length=120)
    phase: str = "preClass"
    stage_end: datetime | None = None
    environment: str = "sandbox"
    #: push = 服务器推起来的；local = App 自己起的
    started_by: str = "local"

    @field_validator("phase")
    @classmethod
    def check_phase(cls, v: str) -> str:
        value = (v or "preClass").strip()
        return value if value in {"preClass", "inClass"} else "preClass"


class LiveActivitySessionOut(BaseModel):
    activity_id: str
    course_key: str | None
    phase: str
    stage_end: datetime | None
    environment: str
    started_by: str
    started_at: datetime
    ended_at: datetime | None


class LessonIn(BaseModel):
    """课表条目（与 Swift ``KaznuLesson`` 字段一一对应）。"""

    course_key: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=200)
    short: str | None = Field(default=None, max_length=24)
    room: str | None = Field(default=None, max_length=80)
    teacher: str | None = Field(default=None, max_length=160)
    #: 0 = 周一 … 6 = 周日
    weekday: int = Field(ge=0, le=6)
    start_h: int = Field(ge=0, le=23)
    start_m: int = Field(ge=0, le=59)
    end_h: int = Field(ge=0, le=23)
    end_m: int = Field(ge=0, le=59)


class LessonsSyncIn(BaseModel):
    """整表同步（先删后插）：比增量合并更简单，也不会留下幽灵课程。"""

    lessons: list[LessonIn] = Field(default_factory=list, max_length=80)
    #: 是否同时开启课程提醒
    alerts_enabled: bool = True


class LessonsSyncOut(BaseModel):
    message: str
    count: int
    alerts_enabled: bool


class LiveActivityStatusOut(BaseModel):
    """App 的自检面板用：我的注册 / 在跑的 Activity / APNs 服务端状态。"""

    registrations: list[LiveActivityRegistrationOut]
    sessions: list[LiveActivitySessionOut]
    lesson_count: int
    lead_seconds: int
    apns: dict


class SchedulerRunOut(BaseModel):
    """手动触发一轮调度（管理员调试用）。"""

    at: str
    planned: int
    sent: int
    failed: int
    skipped: str | None = None
    details: list[dict] = []



# =====================================================================
# 私信 Chat / 通知中心 / 图片上传
# =====================================================================


class ChatPeerOut(BaseModel):
    """私信对方（**实名**信息）。

    与校园墙的匿名约定**刻意不同**：私信是一对一沟通，对方必须知道自己在跟谁说话，
    所以这里始终返回全局显示名 + 院系标签（不提供匿名私信）。
    """

    id: str
    display_name: str
    department_tag: str | None = None


class ConversationOut(BaseModel):
    """会话列表项（含冗余的"最后一条消息"与未读数，避免前端再查两次）。"""

    id: str
    peer: ChatPeerOut
    last_message_preview: str = ""
    last_message_at: datetime | None = None
    last_sender_id: str | None = None
    #: 当前用户在这个会话里的未读数
    unread_count: int = 0
    created_at: datetime | None = None


class ConversationCreated(BaseModel):
    message: str
    conversation: ConversationOut


class StartConversationIn(BaseModel):
    """开启会话：既支持 peer_id（从用户列表点进来），也支持 peer_username（从帖子作者点进来）。"""

    peer_id: str | None = Field(default=None, max_length=36)
    peer_username: str | None = Field(default=None, max_length=120)


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    body: str = ""
    media_urls: list[str] = []
    #: 客户端幂等键（离线队列重发时用来对齐本地气泡）
    client_id: str | None = None
    read_at: datetime | None = None
    is_deleted: bool = False
    created_at: datetime | None = None
    #: 是不是"我发的"（前端据此决定气泡左右与颜色）
    is_mine: bool = False


class MessageIn(BaseModel):
    body: str = Field(default="", max_length=2000)
    media_urls: list[str] = Field(default_factory=list)
    #: 客户端生成的 uuid —— 离线重发时保证幂等（不会出现两个气泡）
    client_id: str | None = Field(default=None, max_length=64)


class MessageCreated(BaseModel):
    message: str
    sent: MessageOut


class MarkReadIn(BaseModel):
    conversation_id: str


class UnreadCountOut(BaseModel):
    """角标数据：私信未读 + 通知未读（二者相加 = App 图标角标）。"""

    messages: int = 0
    notifications: int = 0
    total: int = 0


# ---------------------------------------------------------------- 通知中心


class NotificationOut(BaseModel):
    id: str
    #: like | comment | message | official | system
    kind: str
    title: str
    body: str = ""
    #: 点击跳转：post / chat / news / campus / none
    route: str = "none"
    route_id: str | None = None
    actor_name: str | None = None
    is_read: bool = False
    created_at: datetime | None = None


class BroadcastOut(BaseModel):
    """全校广播项（来自 GlobalNotification；已读用游标时间戳算，不落 N 行）。"""

    id: str
    title: str
    message: str
    level: str = "info"
    is_read: bool = False
    created_at: datetime | None = None


class NotificationCenterOut(BaseModel):
    """通知中心：定向通知（分页）+ 全校广播（不分页，量本来就不大）+ 未读总数。"""

    items: list[NotificationOut] = []
    broadcasts: list[BroadcastOut] = []
    total: int = 0
    limit: int = 20
    offset: int = 0
    has_more: bool = False
    unread_count: int = 0


class ReadResultOut(BaseModel):
    message: str
    marked: int = 0


class DeviceTokenIn(BaseModel):
    """App 上报推送设备（普通通知用，与 Live Activity 注册分开）。"""

    device_id: str = Field(min_length=4, max_length=64)
    token: str = Field(min_length=8, max_length=200)
    platform: str = Field(default="ios", pattern="^(ios|android)$")
    environment: str = Field(default="sandbox", pattern="^(sandbox|production)$")
    locale: str = Field(default="EN", pattern="^(EN|KZ|RU)$")
    alerts_enabled: bool = True


class DeviceTokenOut(BaseModel):
    id: str
    device_id: str
    platform: str
    environment: str
    locale: str
    alerts_enabled: bool
    created_at: datetime | None = None


class BroadcastIn(BaseModel):
    """管理员全校广播（App 内顶部 Banner + 系统横幅 + 通知中心）。"""

    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)
    level: str = Field(default="info", pattern="^(info|warning|danger)$")


class BroadcastResultOut(BaseModel):
    id: str
    ws: int = 0
    targets: int = 0
    push: dict = {}


# ---------------------------------------------------------------- 图片上传


class UploadedImageOut(BaseModel):
    """上传成功返回的图片描述。``url`` 是绝对地址，客户端可直接渲染。"""

    url: str
    key: str
    size: int
    content_type: str


class UploadStatusOut(BaseModel):
    """上传服务自检（staff）。"""

    backend: str
    configured_backend: str
    uploads_enabled: bool
    upload_dir: str | None = None
    dir_writable: bool = False
    public_base_url: str
    max_bytes: int
    allowed_types: list[str] = []


# =====================================================================
# 课程资料（首页「最新资料」卡片 + Materials 页）
# =====================================================================


class MaterialOut(BaseModel):
    """一条课程资料。字段与前端 ``MaterialItem``（src/services/MaterialService.ts）对齐。"""

    id: str
    course_code: str
    course_title: str
    professor_name: str | None = None
    file_name: str
    #: PDF | PPT | DOC | XLS | ZIP
    file_format: str
    size_label: str | None = None
    pages: int | None = None
    file_url: str | None = None
    uploaded_by: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MaterialListOut(Page[MaterialOut]):
    """``GET /materials/latest`` 的返回（与 Campus 列表同构的分页信封）。"""


class MaterialSummaryOut(BaseModel):
    """首页卡片用的轻量摘要：只回最新一条 + 总数，避免首页为了一个卡片拉整页数据。"""

    latest: MaterialOut | None = None
    total: int = 0
    course_count: int = 0


# =====================================================================
# 社团 / 组织申请（CreateClubScreen → /clubs/apply）
# =====================================================================


class ClubOut(BaseModel):
    """已通过审核、公开展示的社团。

    ``contact_*`` 只在**公开渠道**（Telegram / 邮箱之外）返回：
    手机号属于个人信息，仅申请人自己（``/clubs/mine``）与管理员可见。
    """

    id: str
    club_name: str
    #: academic | sports | arts | tech | volunteer | media
    category: str
    description: str | None = None
    avatar_url: str | None = None
    contact_name: str | None = None
    contact_telegram: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClubApplicationOut(ClubOut):
    """我提交的申请（``/clubs/mine``）：额外带审核状态与备注，且含自己的手机号。"""

    status: str
    is_visible: bool = True
    review_note: str | None = None
    contact_phone: str | None = None
    reviewed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ClubCreatedOut(BaseModel):
    """``POST /clubs/apply`` 的返回。"""

    message: str
    club: ClubApplicationOut

