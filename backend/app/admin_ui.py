"""SQLAdmin management panel with role-based access control.

Permissions:
  - super_admin : everything (User, AdminApplication, Professor, Course, Review, Report)
  - admin       : content only (Professor, Course, Review, Report)
  - user        : no access
"""
from __future__ import annotations

from pathlib import Path

from fastapi import Request
from sqladmin import Admin, ModelView, action
from sqladmin.authentication import AuthenticationBackend
from sqlalchemy import select
from starlette.responses import RedirectResponse

from .admin_service import get_application_or_404, handle_application, set_user_banned
from .config import settings
from .database import SessionLocal, engine
from .i18n import (
    ADMIN_LOCALES,
    DEFAULT_LOCALE,
    L,
    build_i18n_config,
    make_column_labels,
    register_catalogs,
)
from .models import (
    ROLE_ADMIN,
    ROLE_SUPER_ADMIN,
    AdminApplication,
    Course,
    Professor,
    Report,
    Review,
    User,
)

SESSION_KEY = "kaznu_admin_user"


def _role_of(request: Request) -> str | None:
    data = getattr(request.state, "admin_user", None)
    return data.get("role") if data else None


def _allowed(request: Request, roles: tuple[str, ...]) -> bool:
    role = _role_of(request)
    return bool(role and role in roles)


async def _load_user_for_login(username: str, password: str) -> User | None:
    """后台登录校验：账号必须存在、未封禁、role ∈ {admin, super_admin}，密码匹配。

    数据库不可用时返回 None（表现为登录失败），避免直接 500 —— 便于在服务器上先确认 /admin 可达。
    """
    expected = settings.super_admin_password or settings.demo_password
    if password != expected:
        return None
    try:
        async with SessionLocal() as session:
            user = await session.scalar(
                select(User).where(User.univer_username == username.strip().lower())
            )
    except Exception as exc:  # pragma: no cover - 取决于部署环境
        print(f"[kaznu] ⚠️ 管理后台登录时无法访问数据库: {type(exc).__name__}: {exc}")
        return None
    if not user or user.is_banned or user.role not in (ROLE_ADMIN, ROLE_SUPER_ADMIN):
        return None
    return user

from sqladmin.authentication import AuthenticationBackend


class KaznuAdminAuth(AuthenticationBackend):
    """SQLAdmin 登录：必须 role ∈ {admin, super_admin} 且未封禁。"""

    def __init__(self, secret_key: str) -> None:
        super().__init__(secret_key=secret_key)

    async def login(self, request) -> bool:
        form = await request.form()
        username = str(form.get("username", ""))
        password = str(form.get("password", ""))
        user = await _load_user_for_login(username, password)
        if not user:
            return False
        request.session[SESSION_KEY] = {"id": user.id, "role": user.role}
        return True

    async def logout(self, request) -> bool:
        request.session.pop(SESSION_KEY, None)
        return True

    async def authenticate(self, request) -> bool:
        data = request.session.get(SESSION_KEY)
        if not data:
            return False
        try:
            async with SessionLocal() as session:
                user = await session.get(User, data.get("id"))
        except Exception as exc:  # pragma: no cover - 取决于部署环境
            print(f"[kaznu] ⚠️ 管理后台会话校验无法访问数据库: {type(exc).__name__}: {exc}")
            return False
        if not user or user.is_banned or user.role not in (ROLE_ADMIN, ROLE_SUPER_ADMIN):
            request.session.pop(SESSION_KEY, None)
            return False
        request.state.admin_user = {"id": user.id, "username": user.univer_username, "role": user.role}
        return True


STAFF_ROLES = (ROLE_ADMIN, ROLE_SUPER_ADMIN)


def _redirect(request: Request, identity: str) -> RedirectResponse:
    return RedirectResponse(request.url_for("admin:list", identity=identity), status_code=303)


class UserAdmin(ModelView, model=User):
    """仅 super_admin：用户管理 + 一键封禁/解封。"""

    # 名称/分类用 L() 包装：渲染时才解析语言（见 app/i18n.py）
    name = L("User")
    name_plural = L("Users")
    category = L("Super Admin")
    icon = "fa-solid fa-users"

    column_list = [
        User.id,
        User.univer_username,
        User.global_display_name,
        User.department_tag,
        User.role,
        User.is_banned,
        User.created_at,
    ]
    column_labels = make_column_labels(
        {
            User.id: "ID",
            User.univer_username: "Univer Username",
            User.global_display_name: "Display Name",
            User.department_tag: "Department Tag",
            User.role: "Role",
            User.is_banned: "Banned",
            User.created_at: "Created At",
        }
    )
    column_searchable_list = [User.univer_username, User.global_display_name]
    column_default_sort = [("created_at", True)]
    form_excluded_columns = [User.id, User.created_at, User.updated_at]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, (ROLE_SUPER_ADMIN,))

    @action(
        name="ban",
        label=L("🚫 Ban"),
        confirmation_message=L("Ban the selected users?"),
        add_in_detail=True,
    )
    async def ban_users(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                await set_user_banned(session, pk, True)
        return _redirect(request, self.identity)

    @action(
        name="unban",
        label=L("✅ Unban"),
        confirmation_message=L("Unban the selected users?"),
        add_in_detail=True,
    )
    async def unban_users(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                await set_user_banned(session, pk, False)
        return _redirect(request, self.identity)


def _application_user_label(model: AdminApplication, _attr: str) -> str:
    """申请列表显示申请人账号，而不是对象地址。"""
    return model.user.univer_username if model.user else "—"


class AdminApplicationAdmin(ModelView, model=AdminApplication):
    """仅 super_admin：管理员申请审批面板。"""

    name = L("Admin Application")
    name_plural = L("Admin Applications")
    category = L("Super Admin")
    icon = "fa-solid fa-file-circle-check"
    can_create = False
    can_edit = False
    can_delete = True

    column_list = [AdminApplication.user, AdminApplication.reason, AdminApplication.status, AdminApplication.created_at]
    column_labels = make_column_labels(
        {
            AdminApplication.user: "Applicant",
            AdminApplication.reason: "Reason",
            AdminApplication.status: "Status",
            AdminApplication.created_at: "Created At",
        }
    )
    column_formatters = {AdminApplication.user: _application_user_label}
    column_searchable_list = [AdminApplication.reason]
    column_default_sort = [("created_at", True)]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, (ROLE_SUPER_ADMIN,))

    @action(
        name="approve",
        label=L("✅ Approve"),
        confirmation_message=L("Approve: promote the applicants to admin?"),
        add_in_detail=True,
    )
    async def approve_applications(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                app = await get_application_or_404(session, pk)
                await handle_application(session, app, "approve")
        return _redirect(request, self.identity)

    @action(
        name="reject",
        label=L("❌ Reject"),
        confirmation_message=L("Reject the selected applications?"),
        add_in_detail=True,
    )
    async def reject_applications(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                app = await get_application_or_404(session, pk)
                await handle_application(session, app, "reject")
        return _redirect(request, self.identity)


class ProfessorAdmin(ModelView, model=Professor):
    """admin & super_admin：教师内容管理。"""

    name = L("Professor")
    name_plural = L("Professors")
    category = L("Content")
    icon = "fa-solid fa-chalkboard-user"
    column_list = [Professor.id, Professor.name, Professor.department, Professor.rating_easy, Professor.rating_quality, Professor.created_at]
    column_labels = make_column_labels(
        {
            Professor.id: "ID",
            Professor.name: "Name",
            Professor.department: "Department",
            Professor.rating_easy: "Easy Rating",
            Professor.rating_quality: "Quality Rating",
            Professor.created_at: "Created At",
        }
    )
    column_searchable_list = [Professor.name, Professor.department]
    column_default_sort = [("name", False)]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)


class CourseAdmin(ModelView, model=Course):
    name = L("Course")
    name_plural = L("Courses")
    category = L("Content")
    icon = "fa-solid fa-book"
    column_list = [Course.id, Course.code, Course.title, Course.department, Course.credits]
    column_labels = make_column_labels(
        {
            Course.id: "ID",
            Course.code: "Code",
            Course.title: "Title",
            Course.department: "Department",
            Course.credits: "Credits",
        }
    )
    column_searchable_list = [Course.code, Course.title, Course.department]
    column_default_sort = [("code", False)]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)


def _review_professor_label(model: Review, _attr: str) -> str:
    """列表/详情里显示教授姓名，而不是 <app.models.Professor object at 0x…>。"""
    return model.professor.name if model.professor else "—"


def _review_course_label(model: Review, _attr: str) -> str:
    course = model.course
    if not course:
        return "—"
    return f"{course.code} · {course.title}" if course.code else course.title


def _review_comment_preview(model: Review, _attr: str) -> str:
    """把评价正文压成一行短文本，便于在列表里快速审核。"""
    text = " ".join((model.comment or "").split())
    if not text:
        return "—"
    return text if len(text) <= 60 else text[:60] + "…"


class ReviewAdmin(ModelView, model=Review):
    name = L("Review")
    name_plural = L("Reviews")
    category = L("Content")
    icon = "fa-solid fa-star"
    column_list = [
        Review.id,
        Review.professor,
        Review.course,
        Review.comment,
        Review.rating_quality,
        Review.rating_easy,
        Review.attendance_strictness,
        Review.likes_count,
        Review.user_department_tag,
        Review.created_at,
    ]
    column_labels = make_column_labels(
        {
            Review.id: "ID",
            Review.professor: "Professor",
            Review.course: "Course",
            Review.comment: "Comment",
            Review.rating_quality: "Quality",
            Review.rating_easy: "Easy",
            Review.attendance_strictness: "Attendance",
            Review.likes_count: "Likes",
            Review.user_department_tag: "Department Tag",
            Review.created_at: "Created At",
            Review.tags: "Tags",
        }
    )
    # 教授/课程列默认会渲染成对象地址，评价正文也需要预览列 —— 审核时可直接看到内容。
    column_formatters = {
        Review.professor: _review_professor_label,
        Review.course: _review_course_label,
        Review.comment: _review_comment_preview,
    }
    column_details_list = [Review.id, Review.professor, Review.course, Review.comment, Review.tags,
                           Review.rating_quality, Review.rating_easy, Review.attendance_strictness,
                           Review.user_department_tag, Review.likes_count, Review.created_at]
    column_searchable_list = [Review.user_department_tag]
    column_default_sort = [("created_at", True)]
    form_excluded_columns = [Review.id, Review.anonymous_hash, Review.created_at, Review.likes_count]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)


class ReportAdmin(ModelView, model=Report):
    name = L("Report")
    name_plural = L("Reports")
    category = L("Content")
    icon = "fa-solid fa-flag"
    can_create = False
    column_list = [Report.id, Report.review_id, Report.reason, Report.created_at]
    column_labels = make_column_labels(
        {
            Report.id: "ID",
            Report.review_id: "Review ID",
            Report.reason: "Reason",
            Report.created_at: "Created At",
        }
    )
    column_searchable_list = [Report.reason]
    column_default_sort = [("created_at", True)]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)


def setup_admin_ui(app) -> Admin:
    """挂载 SQLAdmin 管理后台到 /admin（含 EN / RU / ZH 语言切换器）。"""
    secret = settings.admin_session_secret or settings.anon_hash_secret

    # 1) 先把本仓库自带的中文语言包注册进 SQLAdmin 的 i18n 运行时。
    #    必须在 Admin(...) 之前调用：LocaleMiddleware 与 set_locale() 都是
    #    在请求时读取 sqladmin.i18n.SUPPORTED_LOCALES / translations 的。
    #    SQLAdmin 只内置 en / de / az / ru / tr，没有中文与哈萨克语。
    registered = register_catalogs()

    # 2) 自定义模板目录（backend/templates）。SQLAdmin 的 Jinja loader 把项目目录放在
    #    第一位，因此这里只需放一个 sqladmin/login.html 就能给登录页也加上语言切换器，
    #    其余模板自动回退到 SQLAdmin 包内版本。父目录是 backend/，所以用绝对路径，
    #    不受启动时工作目录影响。
    templates_dir = str(Path(__file__).resolve().parents[1] / "templates")

    admin = Admin(
        app,
        engine=engine,
        session_maker=SessionLocal,
        authentication_backend=KaznuAdminAuth(secret_key=secret),
        title="KazNU Helper Admin",
        logo_url=None,
        base_url="/admin",
        templates_dir=templates_dir,
        # 语言切换器：language_switcher 长度 > 1 时 SQLAdmin 会在导航栏渲染下拉框，
        # 链接形如 /admin/...?lang=zh，由 LocaleMiddleware 写入 cookie 持久化。
        i18n_config=build_i18n_config(),
    )
    # Super Admin 专属
    admin.add_model_view(UserAdmin)
    admin.add_model_view(AdminApplicationAdmin)
    # Admin / Super Admin 通用（内容管理）
    admin.add_model_view(ProfessorAdmin)
    admin.add_model_view(CourseAdmin)
    admin.add_model_view(ReviewAdmin)
    admin.add_model_view(ReportAdmin)
    print(
        "[kaznu] SQLAdmin 管理后台已挂载: /admin"
        " （Users / Admin Applications / Professors / Courses / Reviews / Reports）"
    )
    print(
        "[kaznu] 管理后台语言: "
        + " / ".join(ADMIN_LOCALES)
        + f"（默认 {DEFAULT_LOCALE}"
        + (f"，自带语言包 {', '.join(registered)}" if registered else "，无自带语言包")
        + "）"
    )
    return admin

