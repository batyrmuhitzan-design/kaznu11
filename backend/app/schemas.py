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

    匿名时 ``name`` 必须为 ``None`` —— 后端不会把匿名作者的显示名发出去，
    只给校友看的 ``department_tag``（与评价体系一致）。
    """

    is_anonymous: bool
    name: str | None = None
    department_tag: str | None = None


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
    created_at: datetime


class PostCreated(BaseModel):
    message: str
    post: PostOut


class LikeOut(BaseModel):
    id: str
    likes_count: int
    liked: bool
    message: str


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

    model_config = ConfigDict(from_attributes=True)

