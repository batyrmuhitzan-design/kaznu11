"""验证 FastAPI 入口挂载是否正确：ProfReviews 路由 + SQLAdmin 管理后台 + 旧接口兼容。

无需 PostgreSQL（自动使用临时 SQLite 文件），可直接在 Windows / 任何机器上跑：

    python backend/tests/check_admin_mount.py

断言内容：
  1) /docs 200，且 /openapi.json 包含全部评价 / 管理端路由
  2) /admin 与 /admin/login 不是 404（SQLAdmin 已挂载在 /admin）
  3) /healthz 报告 db_ready=true 且给出 admin 路径
  4) 旧接口兼容：/api/news、/api/schedule、/api/gpa、/api/v1/schedule、/api/v1/grades 均 200
  5) /api/v1/professors 能读到种子数据（教授目录）
  6) 若存在 dist/：/app 能返回前端 index.html
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 必须在导入入口前设置：临时 SQLite，避免依赖 Postgres
_db_file = Path(tempfile.gettempdir()) / "kaznu_check_admin.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-admin-session-secret"

import httpx  # noqa: E402

import main as entrypoint  # noqa: E402  ← 被测对象：仓库根 main.py（线上 uvicorn main:app 用的入口）

from app.bootstrap import ensure_super_admin  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402

EXPECTED_PATHS = [
    # 评价相关（ProfReviews）
    "/api/v1/reviews",
    "/api/v1/reviews/eligibility",
    "/api/v1/reviews/{review_id}/like",
    "/api/v1/professors",
    "/api/v1/professors/{professor_id}",
    "/api/v1/courses",
    # 身份 / 账号
    "/api/v1/auth/login",
    "/api/v1/me",
    "/api/v1/me/display-name",
    "/api/v1/me/department-tag",
    # 管理端（评价审核/审批/封禁/举报）
    "/api/v1/admin/apply",
    "/api/v1/super-admin/applications",
    "/api/v1/super-admin/applications/{application_id}/handle",
    "/api/v1/super-admin/users/{user_id}/ban",
    "/api/v1/reports",
    # meta
    "/healthz",
]

LEGACY_PATHS = [
    "/api/news",
    "/api/schedule",
    "/api/gpa",
    "/api/v1/schedule?student_id=20260001",
    "/api/v1/grades?student_id=20260001",
]

failures: list[str] = []
notes: list[str] = []


def ok(msg: str) -> None:
    notes.append("  [ok] " + msg)


def bad(msg: str) -> None:
    failures.append("  [!!] " + msg)


async def _prepare_db(app) -> None:
    """等价于 lifespan 的初始化（httpx ASGITransport 不会自动执行 lifespan）。"""
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
    async with SessionLocal() as session:
        await ensure_super_admin(session)
    app.state.db_ready = True


async def _run() -> None:
    app = entrypoint.app
    await _prepare_db(app)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # ---- 1) 文档与 OpenAPI ----
        docs = await client.get("/docs")
        if docs.status_code == 200:
            ok("/docs → 200（Swagger UI 可用）")
        else:
            bad(f"/docs → {docs.status_code}")

        schema = (await client.get("/openapi.json")).json()
        paths = schema.get("paths", {})
        missing = [p for p in EXPECTED_PATHS if p not in paths]
        if missing:
            bad("OpenAPI 缺少路径：" + ", ".join(missing))
        else:
            ok(f"/openapi.json 含全部 {len(EXPECTED_PATHS)} 条关键路由（评价 / 管理端 / meta）")
        review_paths = sorted(p for p in paths if "/reviews" in p or "/professors" in p)
        notes.append("      评价相关路径：" + ", ".join(review_paths))

        # ---- 2) SQLAdmin 管理后台 ----
        admin = await client.get("/admin", follow_redirects=False)
        if admin.status_code in (200, 302, 303, 307):
            ok(f"/admin → {admin.status_code}（SQLAdmin 已挂载）")
        else:
            bad(f"/admin → {admin.status_code}（管理后台未挂载）")
        login = await client.get("/admin/login")
        if login.status_code == 200 and ("password" in login.text.lower() or "login" in login.text.lower()):
            ok("/admin/login → 200 登录页可渲染")
        else:
            bad(f"/admin/login → {login.status_code}")

        # ---- 3) /healthz ----
        health = (await client.get("/healthz")).json()
        if health.get("db_ready") is True and health.get("admin") == "/admin":
            ok(f"/healthz → db_ready=true, admin={health['admin']}, version={health.get('version')}")
        else:
            bad(f"/healthz 内容异常：{health}")

        # ---- 4) 旧接口兼容 ----
        for path in LEGACY_PATHS:
            res = await client.get(path)
            if res.status_code == 200:
                ok(f"{path} → 200（兼容保留）")
            else:
                bad(f"{path} → {res.status_code}")

        # ---- 5) 种子教授目录 ----
        profs = await client.get("/api/v1/professors")
        if profs.status_code == 200 and isinstance(profs.json(), list) and profs.json():
            ok(f"/api/v1/professors → 200（{len(profs.json())} 位教授）")
        else:
            bad(f"/api/v1/professors → {profs.status_code} / {profs.text[:120]}")

        # ---- 6) 前端静态站（dist/ 存在时）----
        web_dir = ROOT / "dist"
        if (web_dir / "index.html").is_file():
            page = await client.get("/app/")
            if page.status_code == 200 and 'id="root"' in page.text:
                ok("/app → 200（前端构建产物已挂载）")
            else:
                bad(f"/app → {page.status_code}")
        else:
            notes.append("  [--] 未发现 dist/index.html，跳过 /app 检查（先 npm run build）")


def main() -> None:
    asyncio.run(_run())
    print("\n===== 入口挂载自检（main.py）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
