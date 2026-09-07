"""Pydantic request/response schemas.

Privacy invariant: review payloads NEVER contain display_name, anonymous_hash,
username or any personally identifying field — only the coarse department tag.
"""
from __future__ import annotations

import re
from datetime import datetime

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

