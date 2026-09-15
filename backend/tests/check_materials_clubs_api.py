# -*- coding: utf-8 -*-
"""课程资料 + 社团申请 后端自检。

    python backend/tests/check_materials_clubs_api.py

无需 PostgreSQL（自动用临时 SQLite），Windows / Linux 均可直接跑。

断言内容：
  1) OpenAPI 里出现 7 个新端点（materials ×3、clubs ×4）
  2) 种子：course_materials 6 条、club_applications 4 条（含 1 条 pending）
  3) /materials/summary 的 latest 是**最新**那条（按 created_at 倒序）
  4) /materials/latest 分页自洽、按时间倒序、支持 course_code / file_format 过滤
  5) 非法 file_format → 422；POST /materials 未登录 → 401；staff 登记后立刻成为 latest
  6) /clubs 只返回 approved（pending 那条必须不可见）
  7) /clubs/apply 未登录 → 401；非法分类 / 过短名称 → 422；成功 → 201 且 status=pending
  8) 重复提交同名社团 → 409（防连点刷出重复记录）
  9) Logo 上传：multipart 传 PNG 字节流 → 返回绝对 http URL
 10) /clubs/mine 能看到自己的申请（含 pending 状态）
 11) 提交后申请人收到一条站内通知（/notifications 里能找到 club-apply）
 12) SQLAdmin：/admin/club-application/action/approve-club 通过后
     → 该社团出现在 /clubs，且状态变 approved
 13) SQLAdmin：club-application / course-material 列表页可访问（200）
"""
from __future__ import annotations

import asyncio
import base64
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 必须在导入入口前设置：临时 SQLite，避免依赖 Postgres
_db_file = Path(tempfile.gettempdir()) / "kaznu_check_materials_clubs.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-materials-clubs-secret"
# 上传目录也放到临时目录，避免污染仓库
_upload_dir = Path(tempfile.gettempdir()) / "kaznu_check_materials_uploads"
_upload_dir.mkdir(exist_ok=True)
os.environ["UPLOAD_DIR"] = str(_upload_dir)
os.environ["STORAGE_BACKEND"] = "local"
os.environ["UPLOADS_ENABLED"] = "true"

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

import main as entrypoint  # noqa: E402  ← 被测对象：仓库根 main.py

from app.admin_ui import ClubApplicationAdmin, CourseMaterialAdmin  # noqa: E402
from app.bootstrap import ensure_super_admin  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import CLUB_CATEGORIES, MATERIAL_FORMATS, ClubApplication  # noqa: E402
from app.seed import (  # noqa: E402
    seed_clubs_if_empty,
    seed_if_empty,
    seed_materials_if_empty,
)

USERNAME = os.environ["SUPER_ADMIN_USERNAME"]
PASSWORD = os.environ["SUPER_ADMIN_PASSWORD"]

EXPECTED_PATHS = [
    "/api/v1/materials/latest",
    "/api/v1/materials/summary",
    "/api/v1/materials",
    "/api/v1/clubs",
    "/api/v1/clubs/categories",
    "/api/v1/clubs/mine",
    "/api/v1/clubs/apply",
]

#: 1×1 透明 PNG（真实魔数，能过 validate_image 的白名单校验）
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+0+eAAAAAAElFTkSuQmCC"
)

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def note(msg: str) -> None:
    notes.append(f"       {msg}")


def check_page(where: str, body: dict) -> bool:
    """分页信封形状与自洽性。"""
    required = {"items", "total", "limit", "offset", "has_more"}
    missing = required - set(body)
    if missing:
        bad(f"{where} 分页信封缺字段：{sorted(missing)}")
        return False
    if not isinstance(body["items"], list):
        bad(f"{where} items 不是数组")
        return False
    if body["has_more"] != (body["offset"] + len(body["items"]) < body["total"]):
        bad(f"{where} has_more 与 total/offset 不自洽：{body['total']}/{body['offset']}/{len(body['items'])}")
        return False
    return True


async def _prepare_db(app) -> None:
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
        admin_user = await ensure_super_admin(session)
        await seed_materials_if_empty(session)
        await seed_clubs_if_empty(session, admin_user)
    app.state.db_ready = True


async def _login(client: httpx.AsyncClient) -> str:
    res = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    res.raise_for_status()
    return res.json()["access_token"]


async def _run() -> None:
    app = entrypoint.app
    await _prepare_db(app)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as anon:
        # ---- 1) OpenAPI 路由登记 ----
        schema = (await anon.get("/openapi.json")).json()
        paths = schema.get("paths", {})
        missing = [p for p in EXPECTED_PATHS if p not in paths]
        if missing:
            bad("OpenAPI 缺少新路由：" + ", ".join(missing))
        else:
            ok(f"/openapi.json 含全部 {len(EXPECTED_PATHS)} 个新端点（materials + clubs）")

        # ---- 2) 种子数据 + 摘要 + 排序 + 过滤 ----
        materials = (await anon.get("/api/v1/materials/latest?limit=50")).json()
        if check_page("/api/v1/materials/latest", materials):
            ok(f"/api/v1/materials/latest → {materials['total']} 条种子资料")
        if materials["total"] != 6:
            bad(f"种子资料数量异常：{materials['total']}（期望 6）")

        summary = (await anon.get("/api/v1/materials/summary")).json()
        latest = summary.get("latest") or {}
        if latest.get("file_name") == "Data Structures - Lecture 3.pdf":
            ok(f"/materials/summary.latest 是**最新**那条：{latest['file_name']!r}")
        else:
            bad(f"/materials/summary.latest 异常：{latest.get('file_name')!r}")
        if (summary.get("course_count") or 0) >= 4:
            ok(f"/materials/summary.course_count = {summary['course_count']}（跨课程聚合）")
        else:
            bad(f"/materials/summary.course_count 异常：{summary.get('course_count')}")

        stamps = [m["created_at"] for m in materials["items"]]
        if stamps == sorted(stamps, reverse=True):
            ok("/materials/latest 按 created_at 严格倒序（最新的在前）")
        else:
            bad("/materials/latest 未按时间倒序")

        filtered = (
            await anon.get("/api/v1/materials/latest?file_format=pdf&course_code=CS%20201")
        ).json()
        if filtered["total"] == 1 and all(
            m["file_format"] == "PDF" and m["course_code"] == "CS 201"
            for m in filtered["items"]
        ):
            ok("/materials/latest 支持 file_format + course_code 组合过滤（CS 201 的 PDF → 1 条）")
        else:
            bad(f"组合过滤结果异常：total={filtered['total']} items={filtered['items']}")

        zip_only = (await anon.get("/api/v1/materials/latest?file_format=ZIP")).json()
        if zip_only["total"] == 1 and zip_only["items"][0]["file_name"].startswith("Assignment 3"):
            ok("/materials/latest 单条件过滤（ZIP → 作业 starter code）")
        else:
            bad(f"单条件过滤异常：{zip_only['total']}")

        bad_fmt = await anon.get("/api/v1/materials/latest?file_format=EXE")
        if bad_fmt.status_code == 422:
            ok("非法 file_format → 422")
        else:
            bad(f"非法 file_format 未被拒绝：{bad_fmt.status_code}")

        unauth = await anon.post("/api/v1/materials?course_code=X&course_title=Y&file_name=Z")
        if unauth.status_code == 401:
            ok("POST /materials 未登录 → 401")
        else:
            bad(f"POST /materials 未登录返回 {unauth.status_code}（应为 401）")

        # ---- 3) 社团分类枚举 ----
        cats = (await anon.get("/api/v1/clubs/categories")).json()
        if cats == list(CLUB_CATEGORIES):
            ok(f"/clubs/categories 与后端枚举一致（{len(cats)} 项）")
        else:
            bad(f"/clubs/categories 与 CLUB_CATEGORIES 不一致：{cats}")

        # ---- 4) 公开社团列表：pending 必须不可见 ----
        clubs = (await anon.get("/api/v1/clubs?limit=50")).json()
        if check_page("/api/v1/clubs", clubs):
            ok(f"/api/v1/clubs → {clubs['total']} 个已通过社团")
        names = [c["club_name"] for c in clubs.get("items", [])]
        if clubs.get("total") == 3 and "Astro Photography Lab" not in names:
            ok("待审核社团（Astro Photography Lab）未出现在公开列表 → 审核闸门生效")
        else:
            bad(f"待审核社团泄露到公开列表：total={clubs.get('total')} names={names}")
        if clubs.get("items") and "contact_phone" not in clubs["items"][0]:
            ok("公开社团视图**不含** contact_phone（不泄露手机号）")
        else:
            bad("公开社团视图泄露了 contact_phone")

        # ---- 5) 申请：未登录 ----
        apply_unauth = await anon.post("/api/v1/clubs/apply", data={"club_name": "Robotics"})
        if apply_unauth.status_code == 401:
            ok("POST /clubs/apply 未登录 → 401")
        else:
            bad(f"未登录提交申请返回 {apply_unauth.status_code}（应为 401）")

        auth = {"Authorization": f"Bearer {await _login(anon)}"}

    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", headers=auth, timeout=30
    ) as user:
        # ---- 6) 申请：校验 / 成功 / 去重 / 我的申请 / 回执通知 ----
        bad_cat = await user.post(
            "/api/v1/clubs/apply", data={"club_name": "Robotics Club", "category": "magic"}
        )
        if bad_cat.status_code == 422:
            ok("非法 category → 422")
        else:
            bad(f"非法 category 未被拒绝：{bad_cat.status_code}")

        short = await user.post("/api/v1/clubs/apply", data={"club_name": "A", "category": "tech"})
        if short.status_code == 422:
            ok("社团名称过短 → 422")
        else:
            bad(f"过短名称未被拒绝：{short.status_code}")

        created = await user.post(
            "/api/v1/clubs/apply",
            data={
                "club_name": "Robotics Club",
                "category": "tech",
                "description": "Build line-following robots and compete in Almaty.",
                "contact_telegram": "@robotics_kaznu",
                "contact_phone": "+7 701 000 00 00",
            },
            files={"avatar": ("logo.png", PNG_BYTES, "image/png")},
        )
        club_id = ""
        if created.status_code == 201:
            body = created.json()["club"]
            club_id = body["id"]
            ok(f"提交成功 → 201 · status={body['status']} · logo={body['avatar_url']!r}")
            if body["status"] != "pending":
                bad("新申请状态不是 pending（默认 approved 会让任何人冒充官方社团）")
            if not (body.get("avatar_url") or "").startswith("http"):
                bad(f"Logo 未返回绝对 URL：{body.get('avatar_url')!r}")
            if not body.get("contact_name"):
                bad("contact_name 未自动关联当前登录学生")
        else:
            bad(f"提交申请失败 → {created.status_code} {created.text[:200]}")

        dup = await user.post(
            "/api/v1/clubs/apply", data={"club_name": "Robotics Club", "category": "tech"}
        )
        if dup.status_code == 409:
            ok("重复提交同名社团 → 409（防连点刷重复记录）")
        else:
            bad(f"重复提交未被拦截：{dup.status_code}")

        mine = (await user.get("/api/v1/clubs/mine")).json()
        if isinstance(mine, list) and any(c.get("id") == club_id for c in mine):
            ok(f"/clubs/mine → {len(mine)} 条（含刚提交的 pending 申请，带手机号）")
        else:
            bad(f"/clubs/mine 未包含刚提交的申请：{str(mine)[:160]}")

        inbox = (await user.get("/api/v1/notifications?limit=50")).json()
        items = inbox.get("items", []) if isinstance(inbox, dict) else []
        if any("Robotics" in (n.get("title") or "") for n in items):
            ok("申请人收到站内回执通知（通知中心可见）")
        else:
            bad(f"未找到申请回执通知：{[n.get('title') for n in items][:6]}")

        # ---- 7) staff 登记新资料 → 立刻成为 latest（首页卡片即时更新）----
        new_material = await user.post(
            "/api/v1/materials?course_code=CS%20310&course_title=Operating%20Systems"
            "&file_name=Lecture%201%20-%20Scheduling.pdf&file_format=PDF&size_label=2.1%20MB&pages=36"
            "&file_url=https%3A%2F%2Fexample.com%2Fos1.pdf"
        )
        if new_material.status_code == 201:
            ok(f"staff 登记资料 → 201 · {new_material.json()['file_name']!r}")
        else:
            bad(f"staff 登记资料失败：{new_material.status_code} {new_material.text[:160]}")

        after = (await user.get("/api/v1/materials/summary")).json()
        if (after.get("latest") or {}).get("file_name") == "Lecture 1 - Scheduling.pdf":
            ok("新登记的自动成为 /materials/summary.latest")
        else:
            bad(f"新登记未成为 latest：{(after.get('latest') or {}).get('file_name')!r}")

        # ---- 8) SQLAdmin：列表页 + 审核动作闭环 ----
        staff = httpx.AsyncClient(
            transport=transport, base_url="http://test", timeout=30, follow_redirects=False
        )
        login = await staff.post("/admin/login", data={"username": USERNAME, "password": PASSWORD})
        if login.status_code in (302, 303):
            for cls in (ClubApplicationAdmin, CourseMaterialAdmin):
                res = await staff.get(f"/admin/{cls.identity}/list")
                if res.status_code == 200:
                    ok(f"/admin/{cls.identity}/list → 200（{cls.__name__}）")
                else:
                    bad(f"/admin/{cls.identity}/list → {res.status_code}（{cls.__name__}）")

            material_action = await staff.get("/admin/course-material/action/hide-material")
            if material_action.status_code in (302, 303, 400):
                ok("CourseMaterialAdmin 已注册 hide-material 动作")
            else:
                bad(f"hide-material 动作异常：{material_action.status_code}")

            if club_id:
                approve = await staff.get(
                    f"/admin/club-application/action/approve-club?pks={club_id}"
                )
                if approve.status_code in (302, 303):
                    ok("后台动作 approve-club → 302（审核通过）")
                else:
                    bad(f"approve-club 动作返回 {approve.status_code}")

                public = (await user.get("/api/v1/clubs?limit=50")).json()
                names = [c["club_name"] for c in public.get("items", [])]
                if "Robotics Club" in names:
                    ok("审核通过后立刻出现在公开社团列表 → 审核闸门闭环")
                else:
                    bad(f"审核通过后仍未出现在公开列表：{names}")
        else:
            bad(f"后台登录失败 → {login.status_code}，无法验证审核动作")
        await staff.aclose()

    # ---- 9) DB 复核 ----
    async with SessionLocal() as session:
        rows = (
            await session.scalars(
                select(ClubApplication).where(ClubApplication.club_name == "Robotics Club")
            )
        ).all()
        if rows and rows[0].status == "approved" and rows[0].reviewed_at is not None:
            ok("DB 复核：status=approved 且 reviewed_at 已写入")
        else:
            bad(f"DB 复核失败：{[(r.status, r.reviewed_at) for r in rows]}")


def main() -> None:
    asyncio.run(_run())
    print("\n===== 课程资料 + 社团申请 后端自检 =====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
