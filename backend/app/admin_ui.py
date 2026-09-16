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
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import Select
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
    ClubApplication,
    ClubEvent,
    Conversation,
    Course,
    CourseMaterial,
    GlobalNotification,
    Message,
    Post,
    PostComment,
    Professor,
    Report,
    Review,
    User,
)
from .push import (
    all_push_targets,
    announce_club_event,
    dispatch_alert,
    notify_user,
    push_existing_notification,
)
from .push_payload import build_broadcast_payload
from .realtime import manager

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


# =====================================================================
# Campus Hub —— 校园墙 / 社团活动 / 全局通知 审核面板
# =====================================================================


def _post_author_label(model: Post, _attr: str) -> str:
    """帖子作者显示名。

    ⚠️ 这是**员工后台**：为了追责与封禁，这里会显示作者显示名（匿名帖也显示）。
    公开 API（/api/v1/posts）永远不会返回匿名作者身份 —— 两处是不同表面。
    """
    return model.author.global_display_name if model.author else "—"


def _post_content_preview(model: Post, _attr: str) -> str:
    text = " ".join((model.content or "").split())
    if not text:
        return "—"
    return text if len(text) <= 60 else text[:60] + "…"


def _comment_post_label(model: PostComment, _attr: str) -> str:
    """评论所属帖子的摘要，方便判断上下文。"""
    post = model.post
    if post is None:
        return "—"
    text = " ".join((post.content or "").split())
    return (text[:40] + "…") if len(text) > 40 else (text or "—")


class PostAdmin(ModelView, model=Post):
    """admin & super_admin：校园墙帖子审核（一键隐藏 / 恢复 / 删除）。"""

    name = L("Post")
    name_plural = L("Posts")
    category = L("Campus Hub")
    category_icon = "fa-solid fa-people-group"
    icon = "fa-solid fa-comments"

    # 帖子来自 App，后台不新建；但可以编辑（例如改分类）与删除
    can_create = False
    can_edit = True
    can_delete = True

    column_list = [
        Post.id,
        Post.category,
        Post.content,
        Post.author,
        Post.is_anonymous,
        Post.likes_count,
        Post.is_hidden,
        Post.created_at,
    ]
    column_labels = make_column_labels(
        {
            Post.id: "ID",
            Post.category: "Category",
            Post.content: "Post Content",
            Post.author: "Author",
            Post.is_anonymous: "Anonymous",
            Post.likes_count: "Likes",
            Post.is_hidden: "Hidden",
            Post.created_at: "Created At",
        }
    )
    column_formatters = {
        Post.content: _post_content_preview,
        Post.author: _post_author_label,
    }
    column_searchable_list = [Post.content]
    column_default_sort = [("created_at", True)]
    # FK / 统计列不进表单：编辑时保持原值；likes_count 由 App 维护，手改没意义
    form_excluded_columns = [Post.id, Post.user_id, Post.likes_count]
    page_size = 30

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    @action(
        name="hide",
        label=L("🙈 Hide"),
        confirmation_message=L("Hide the selected posts?"),
        add_in_detail=True,
    )
    async def hide_posts(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                post = await session.get(Post, pk)
                if post is not None:
                    post.is_hidden = True
            await session.commit()
        return _redirect(request, self.identity)

    @action(
        name="unhide",
        label=L("👁 Unhide"),
        confirmation_message=L("Unhide the selected posts?"),
        add_in_detail=True,
    )
    async def unhide_posts(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                post = await session.get(Post, pk)
                if post is not None:
                    post.is_hidden = False
            await session.commit()
        return _redirect(request, self.identity)


class PostCommentAdmin(ModelView, model=PostComment):
    """admin & super_admin：评论审核（删除违规评论）。"""

    name = L("Post Comment")
    name_plural = L("Post Comments")
    category = L("Campus Hub")
    icon = "fa-solid fa-comment-dots"

    can_create = False
    can_edit = False
    can_delete = True

    column_list = [
        PostComment.id,
        PostComment.post,
        PostComment.content,
        PostComment.author,
        PostComment.is_anonymous,
        PostComment.created_at,
    ]
    column_labels = make_column_labels(
        {
            PostComment.id: "ID",
            PostComment.post: "Post",
            PostComment.content: "Comment Content",
            PostComment.author: "Author",
            PostComment.is_anonymous: "Anonymous",
            PostComment.created_at: "Created At",
        }
    )
    column_formatters = {
        PostComment.post: _comment_post_label,
        PostComment.author: _post_author_label,
    }
    column_searchable_list = [PostComment.content]
    column_default_sort = [("created_at", True)]
    page_size = 30

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)


class ClubEventAdmin(ModelView, model=ClubEvent):
    """admin & super_admin：社团活动审核（通过 / 下架）。"""

    name = L("Club Event")
    name_plural = L("Club Events")
    category = L("Campus Hub")
    icon = "fa-solid fa-calendar-star"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        ClubEvent.id,
        ClubEvent.club_name,
        ClubEvent.title,
        ClubEvent.event_time,
        ClubEvent.location,
        ClubEvent.is_approved,
        ClubEvent.register_link,
    ]
    column_labels = make_column_labels(
        {
            ClubEvent.id: "ID",
            ClubEvent.club_name: "Club Name",
            ClubEvent.title: "Event Title",
            ClubEvent.description: "Description",
            ClubEvent.poster_url: "Poster URL",
            ClubEvent.event_time: "Event Time",
            ClubEvent.location: "Location",
            ClubEvent.register_link: "Register Link",
            ClubEvent.is_approved: "Approved",
        }
    )
    column_searchable_list = [ClubEvent.title, ClubEvent.club_name]
    column_default_sort = [("event_time", True)]
    form_excluded_columns = [ClubEvent.id]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    @action(
        name="approve-event",
        label=L("✅ Approve"),
        confirmation_message=L("Approve the selected events?"),
        add_in_detail=True,
    )
    async def approve_events(self, request: Request) -> RedirectResponse:
        """审核通过 —— 并在**通过的这一刻**给全量设备发系统推送。

        为什么要在这里推送（而不是等 App 自己发现）
        ------------------------------------------
        App 被用户划掉后没有任何后台执行权（iOS 限制），不可能轮询到"有新活动"。
        所以在管理员点通过的时刻发一次 APNs alert 是唯一能让它在锁屏 / 灵动岛弹出来的途径。
        只对**从「未通过 → 通过」这一刻**真正发生变化的行发通告，重复点 Approve 不会重复打扰。
        """
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        newly_approved: list[ClubEvent] = []
        async with self.session_maker() as session:
            for pk in pks:
                event = await session.get(ClubEvent, pk)
                if event is not None and not event.is_approved:
                    event.is_approved = True
                    newly_approved.append(event)
            await session.commit()
            # 通告必须在 commit 之后：广播里会再开事务写日志，混在同一事务里容易锁表
            for event in newly_approved:
                await announce_club_event(session, event=event)
        return _redirect(request, self.identity)

    @action(
        name="unapprove-event",
        label=L("⛔ Unapprove"),
        confirmation_message=L("Unapprove the selected events?"),
        add_in_detail=True,
    )
    async def unapprove_events(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                event = await session.get(ClubEvent, pk)
                if event is not None:
                    event.is_approved = False
            await session.commit()
        return _redirect(request, self.identity)


class GlobalNotificationAdmin(ModelView, model=GlobalNotification):
    """admin & super_admin：全校级紧急通知（顶部 Push Banner 的内容源）。

    管理员在这里新建一条并把 ``is_active`` 打开，App 顶部立刻出现高亮通知栏；
    关闭 ``is_active`` 即下线（历史记录仍然保留在后台）。
    """

    name = L("Global Notification")
    name_plural = L("Global Notifications")
    category = L("Campus Hub")
    icon = "fa-solid fa-tower-broadcast"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        GlobalNotification.id,
        GlobalNotification.title,
        GlobalNotification.message,
        GlobalNotification.level,
        GlobalNotification.is_active,
        GlobalNotification.created_at,
    ]
    column_labels = make_column_labels(
        {
            GlobalNotification.id: "ID",
            GlobalNotification.title: "Notification Title",
            GlobalNotification.message: "Message",
            GlobalNotification.level: "Level",
            GlobalNotification.is_active: "Active",
            GlobalNotification.created_at: "Created At",
        }
    )
    column_searchable_list = [GlobalNotification.title, GlobalNotification.message]
    column_default_sort = [("created_at", True)]
    form_excluded_columns = [GlobalNotification.id]

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    @action(
        name="activate-notification",
        label=L("🔔 Activate"),
        confirmation_message=L("Activate the selected notifications?"),
        add_in_detail=True,
    )
    async def activate_notifications(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                item = await session.get(GlobalNotification, pk)
                if item is not None:
                    item.is_active = True
            await session.commit()
        return _redirect(request, self.identity)

    @action(
        name="deactivate-notification",
        label=L("🔕 Deactivate"),
        confirmation_message=L("Deactivate the selected notifications?"),
        add_in_detail=True,
    )
    async def deactivate_notifications(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                item = await session.get(GlobalNotification, pk)
                if item is not None:
                    item.is_active = False
            await session.commit()
        return _redirect(request, self.identity)

    @action(
        name="push-notification",
        label=L("📣 Push now"),
        confirmation_message=L("Send this notification to all devices now?"),
        add_in_detail=True,
    )
    async def push_notifications(self, request: Request) -> RedirectResponse:
        """立刻把这条通知**推送到全量设备**（APNs 系统横幅 + WebSocket 实时帧）。

        为什么需要这个动作（而不是"新建即推送"）
        ----------------------------------------
        * 在后台**新建一行**只写数据库，App 只能靠 45s 前台轮询才看得到；
        * 但也不能"保存即推送" —— 管理员常常先存草稿、改好文案再发，误推收不回来。

        所以做成**显式动作**：勾选 → 📣 Push now →
          · 打开 ``is_active``（在线用户立刻看到顶部通知栏）
          · **WebSocket 实时帧**（在线设备秒到，带新的 delivery_id）
          · APNs 扇出（离线 / 被杀掉的用户走系统横幅，参照微信来消息体验）

        每次点击都会写入新的 ``pushed_at`` 并生成新的 delivery_id，
        所以**重复推送仍会响铃 + 弹窗**（客户端按投递 id 去重，而不是按通知 id）。

        未配置 APNs 凭据时**不报错**：``dispatch_alert`` 如实返回 ``targets=0``，
        数据库与在线通路照常生效（这也是没有付费开发者账号时的预期行为）。
        """
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                item = await session.get(GlobalNotification, pk)
                if item is None:
                    continue
                await push_existing_notification(session, item)
        return _redirect(request, self.identity)


class CourseMaterialAdmin(ModelView, model=CourseMaterial):
    """admin & super_admin：课程资料（首页「最新资料」卡片 / Materials 页的内容源）。"""

    name = L("Course Material")
    name_plural = L("Course Materials")
    category = L("Academics")
    icon = "fa-solid fa-file-lines"

    can_create = True
    can_edit = True
    can_delete = True

    column_list = [
        CourseMaterial.id,
        CourseMaterial.course_code,
        CourseMaterial.course_title,
        CourseMaterial.file_name,
        CourseMaterial.file_format,
        CourseMaterial.size_label,
        CourseMaterial.is_visible,
        CourseMaterial.created_at,
    ]
    column_labels = make_column_labels(
        {
            CourseMaterial.id: "ID",
            CourseMaterial.course_code: "Course Code",
            CourseMaterial.course_title: "Course Title",
            CourseMaterial.professor_name: "Professor",
            CourseMaterial.file_name: "File Name",
            CourseMaterial.file_format: "Format",
            CourseMaterial.size_label: "Size",
            CourseMaterial.pages: "Pages",
            CourseMaterial.file_url: "File URL",
            CourseMaterial.uploaded_by: "Uploaded By",
            CourseMaterial.is_visible: "Visible",
            CourseMaterial.created_at: "Uploaded At",
        }
    )
    column_searchable_list = [
        CourseMaterial.course_code,
        CourseMaterial.course_title,
        CourseMaterial.file_name,
    ]
    column_default_sort = [("created_at", True)]
    form_excluded_columns = [CourseMaterial.id]
    page_size = 30

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    @action(
        name="hide-material",
        label=L("🙈 Hide"),
        confirmation_message=L("Hide the selected materials from students?"),
        add_in_detail=True,
    )
    async def hide_materials(self, request: Request) -> RedirectResponse:
        """下架（软隐藏）：首页卡片与 Materials 页立刻看不到，历史记录保留。"""
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                row = await session.get(CourseMaterial, pk)
                if row is not None:
                    row.is_visible = False
            await session.commit()
        return _redirect(request, self.identity)

    @action(
        name="show-material",
        label=L("👁 Unhide"),
        confirmation_message=L("Show the selected materials again?"),
        add_in_detail=True,
    )
    async def show_materials(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                row = await session.get(CourseMaterial, pk)
                if row is not None:
                    row.is_visible = True
            await session.commit()
        return _redirect(request, self.identity)


class ClubApplicationAdmin(ModelView, model=ClubApplication):
    """admin & super_admin：社团 / 组织创建申请审核。

    审核通过后该社团才会出现在 ``GET /clubs``（Campus Hub 的社团列表）里，
    并**自动给申请人发一条结果通知**（站内可见；离线设备走 APNs 系统横幅）。
    """

    name = L("Club Application")
    name_plural = L("Club Applications")
    category = L("Campus Hub")
    icon = "fa-solid fa-users-rectangle"

    can_create = False
    can_edit = True
    can_delete = True

    column_list = [
        ClubApplication.id,
        ClubApplication.club_name,
        ClubApplication.category,
        ClubApplication.status,
        ClubApplication.is_visible,
        ClubApplication.contact_name,
        ClubApplication.contact_telegram,
        ClubApplication.created_at,
    ]
    column_labels = make_column_labels(
        {
            ClubApplication.id: "ID",
            ClubApplication.club_name: "Club Name",
            ClubApplication.category: "Category",
            ClubApplication.description: "Description",
            ClubApplication.avatar_url: "Logo URL",
            ClubApplication.contact_name: "Contact Name",
            ClubApplication.contact_telegram: "Telegram",
            ClubApplication.contact_phone: "Phone",
            ClubApplication.status: "Status",
            ClubApplication.is_visible: "Visible",
            ClubApplication.review_note: "Review Note",
            ClubApplication.created_at: "Submitted At",
            ClubApplication.reviewed_at: "Reviewed At",
        }
    )
    column_searchable_list = [ClubApplication.club_name, ClubApplication.description]
    column_default_sort = [("created_at", True)]
    form_excluded_columns = [ClubApplication.id, ClubApplication.user_id, ClubApplication.reviewed_at]
    page_size = 30

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    async def _decide(self, request: Request, *, approve: bool) -> RedirectResponse:
        """通过 / 驳回的公共逻辑（两处只差 status 与文案）。"""
        from datetime import datetime, timezone

        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                row = await session.get(ClubApplication, pk)
                if row is None:
                    continue
                row.status = "approved" if approve else "rejected"
                row.reviewed_at = datetime.now(timezone.utc)
                await session.commit()
                # 结果通知：申请人站内可见；App 不在线时走 APNs 系统横幅
                await notify_user(
                    session,
                    user_id=row.user_id,
                    kind="system",
                    title=row.club_name,
                    body=(
                        "Your club was approved and is now visible on the campus hub."
                        if approve
                        else "Your club application was reviewed and not approved."
                    ),
                    route="campus",
                    route_id=row.id,
                    dedupe_key=f"club-{'approved' if approve else 'rejected'}:{row.id}",
                )
        return _redirect(request, self.identity)

    @action(
        name="approve-club",
        label=L("✅ Approve club"),
        confirmation_message=L("Approve the selected club applications?"),
        add_in_detail=True,
    )
    async def approve_clubs(self, request: Request) -> RedirectResponse:
        return await self._decide(request, approve=True)

    @action(
        name="reject-club",
        label=L("⛔ Reject club"),
        confirmation_message=L("Reject the selected club applications?"),
        add_in_detail=True,
    )
    async def reject_clubs(self, request: Request) -> RedirectResponse:
        return await self._decide(request, approve=False)


def _chat_sender_label(model: Message, _attr: str) -> str:
    """私信发送者（管理端要能追责，这里显示全局显示名 + 学号）。

    ⚠️ 必须防 DetachedInstanceError：列表页的行对象在模板渲染时可能已经与 Session
    分离，此时访问 ``model.sender`` 会抛
    ``Parent instance <Message> is not bound to a Session; lazy load operation of
    attribute 'sender' cannot proceed`` → **整个后台页面 500**（线上实测踩到：
    本地临时库没有私信，空表不触发格式化函数，所以本地一直是 200）。
    这里先看属性是否已加载；没加载就退回 sender_id，绝不让页面挂掉。
    """
    if "sender" in sa_inspect(model).unloaded:
        return model.sender_id or "—"
    sender = model.sender
    if sender is None:
        return "—"
    name = sender.global_display_name or "—"
    return f"{name} (@{sender.univer_username})"


def _chat_conversation_label(model: Message, _attr: str) -> str:
    """会话参与者摘要（a ↔ b），让人一眼看懂这条私信在谁和谁之间。"""
    if "conversation" in sa_inspect(model).unloaded:
        return model.conversation_id or "—"
    conversation = model.conversation
    if conversation is None:
        return model.conversation_id or "—"
    state = sa_inspect(conversation)
    if "user_a" in state.unloaded or "user_b" in state.unloaded:
        return conversation.id
    a = conversation.user_a
    b = conversation.user_b
    if a is None or b is None:
        return conversation.id
    return f"{a.global_display_name} ↔ {b.global_display_name}"


class MessageAdmin(ModelView, model=Message):
    """admin & super_admin：**私信内容审核**（查看 / 下架违规私信）。

    为什么私信也要进后台
    --------------------
    私信是用户生成内容里**最容易出问题**的部分（骚扰、诈骗、交易）。
    之前没有任何后台可见性 —— 用户举报了也无从核实。
    这里把最近的消息按时间倒序列出，支持按正文搜索、一键下架（软删除，
    对方 App 立刻显示"消息已被撤回"）+ 恢复。
    """

    name = L("Chat Message")
    name_plural = L("Chat Messages")
    category = L("Campus Hub")
    icon = "fa-solid fa-comment-sms"

    can_create = False
    can_edit = False
    can_delete = True

    column_list = [
        Message.id,
        Message.conversation,
        Message.sender,
        Message.body,
        Message.media_urls,
        Message.is_deleted,
        Message.deleted_by,
        Message.created_at,
    ]
    column_labels = make_column_labels(
        {
            Message.id: "ID",
            Message.conversation: "Conversation",
            Message.sender: "Chat Sender",
            Message.body: "Message Body",
            Message.media_urls: "Media",
            Message.is_deleted: "Deleted",
            Message.deleted_by: "Deleted By",
            Message.read_at: "Read At",
            Message.created_at: "Sent At",
        }
    )
    column_formatters = {
        Message.conversation: _chat_conversation_label,
        Message.sender: _chat_sender_label,
    }
    column_searchable_list = [Message.body]
    column_default_sort = [("created_at", True)]
    page_size = 40

    # 预加载关联对象：格式化函数要显示"谁发给谁的"，
    # 不预加载就会在模板渲染阶段触发 lazy load → DetachedInstanceError → 整页 500。
    # （格式化函数里另有兜底，这里是为了正常情况下真的显示出人名字。）
    # ⚠️ 这一版 sqladmin 的 list_query 是**方法**（list_query(request) -> Select），
    #    直接写成类属性会得到 `TypeError: 'Select' object is not callable`。
    def list_query(self, request: Request) -> Select:
        return super().list_query(request).options(
            selectinload(Message.sender),
            selectinload(Message.conversation).selectinload(Conversation.user_a),
            selectinload(Message.conversation).selectinload(Conversation.user_b),
        )

    def form_details_query(self, request: Request) -> Select:
        """详情页（管理员点开一条私信准备下架时走的页面）同样要预加载关联对象。"""
        return super().form_details_query(request).options(
            selectinload(Message.sender),
            selectinload(Message.conversation).selectinload(Conversation.user_a),
            selectinload(Message.conversation).selectinload(Conversation.user_b),
        )

    def is_accessible(self, request: Request) -> bool:
        return _allowed(request, STAFF_ROLES)

    @action(
        name="hide-message",
        label=L("🙈 Take down"),
        confirmation_message=L("Take down the selected messages? The sender and receiver will both see “message recalled”."),
        add_in_detail=True,
    )
    async def hide_messages(self, request: Request) -> RedirectResponse:
        """下架违规私信（软删除，保留审计）：双方 UI 立即可见"已撤回"。"""
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                row = await session.get(Message, pk)
                if row is None or row.is_deleted:
                    continue
                row.is_deleted = True
                row.deleted_by = "staff"
                await session.commit()
                conversation = await session.get(Conversation, row.conversation_id)
                if conversation is not None:
                    for participant in (conversation.user_a_id, conversation.user_b_id):
                        await manager.send_to_user(
                            participant,
                            {
                                "type": "message-deleted",
                                "conversation_id": row.conversation_id,
                                "message_id": row.id,
                                "deleted_by": "staff",
                            },
                        )
        return _redirect(request, self.identity)

    @action(
        name="restore-message",
        label=L("♻️ Restore"),
        confirmation_message=L("Restore the selected messages?"),
        add_in_detail=True,
    )
    async def restore_messages(self, request: Request) -> RedirectResponse:
        pks = [pk for pk in request.query_params.get("pks", "").split(",") if pk]
        async with self.session_maker() as session:
            for pk in pks:
                row = await session.get(Message, pk)
                if row is None:
                    continue
                row.is_deleted = False
                row.deleted_by = None
            await session.commit()
        return _redirect(request, self.identity)


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
    # Campus Hub：校园墙帖子 / 评论 / 社团活动 / 全局紧急通知 / 社团申请
    admin.add_model_view(PostAdmin)
    admin.add_model_view(PostCommentAdmin)
    admin.add_model_view(ClubEventAdmin)
    admin.add_model_view(GlobalNotificationAdmin)
    admin.add_model_view(ClubApplicationAdmin)
    # 私信审核（用户生成内容里最容易出问题的部分：骚扰 / 诈骗 / 交易）
    admin.add_model_view(MessageAdmin)
    # 课程资料（首页「最新资料」卡片 / Materials 页）
    admin.add_model_view(CourseMaterialAdmin)
    # 视图清单**从实际挂载结果生成**：之前这行是手写死的字符串，加了 MessageAdmin
    # 之后日志里没有它 —— 排查"管理端看不到私信"时会被这行日志误导（踩过）。
    mounted = " / ".join(str(view.name_plural) for view in admin.views)
    print(f"[kaznu] SQLAdmin 管理后台已挂载: /admin （{mounted}）")
    print(
        "[kaznu] 管理后台语言: "
        + " / ".join(ADMIN_LOCALES)
        + f"（默认 {DEFAULT_LOCALE}"
        + (f"，自带语言包 {', '.join(registered)}" if registered else "，无自带语言包")
        + "）"
    )
    return admin

