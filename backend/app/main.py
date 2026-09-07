"""KazNU Helper 2.0 beta — FastAPI application entry.

Run (PostgreSQL):   uvicorn app.main:app --reload --port 8000
Smoke (SQLite):     set DATABASE_URL=sqlite+aiosqlite:///./dev.db then uvicorn app.main:app
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import ensure_super_admin
from .config import settings
from .database import SessionLocal, init_db
from .deps import limiter
from .routers import admin as admin_routes
from .routers import auth, courses, me, professors, reports as report_routes
from .routers import reviews, super_admin
from .seed import seed_if_empty

# SlowAPI rate limiter — optional import keeps the app runnable if the wheel
# can't be installed on an exotic Python build (fallback = no limiting).
try:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    _SLOWAPI = True
except ImportError:  # pragma: no cover
    _SLOWAPI = False


def _make_app() -> FastAPI:
    @asynccontextmanager
    async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await init_db()
        if settings.seed_on_startup:
            async with SessionLocal() as session:
                await seed_if_empty(session)
        # 保证内置超级管理员一定存在（应用首次启动时创建）
        async with SessionLocal() as session:
            await ensure_super_admin(session)
        yield

    app = FastAPI(
        title=settings.app_name,
        description=(
            "KazNU Helper 2.0 (test build) — Univer account identity + "
            "anonymous professor/course ratings. "
            "Reviews never expose display names, only coarse department tags."
        ),
        version=settings.app_version,
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if _SLOWAPI:
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        app.add_middleware(SlowAPIMiddleware)

    # New 2.0 API surface (RateMyProf + identity).
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(me.router, prefix="/api/v1")
    app.include_router(professors.router, prefix="/api/v1")
    app.include_router(courses.router, prefix="/api/v1")
    app.include_router(reviews.router, prefix="/api/v1")
    # 管理端：申请/审批/封禁/举报
    app.include_router(admin_routes.router, prefix="/api/v1")
    app.include_router(super_admin.router, prefix="/api/v1")
    app.include_router(report_routes.router, prefix="/api/v1")

    # Legacy endpoints the 1.3 frontend already consumes (/api/schedule etc).
    app.include_router(_legacy_router())

    # SQLAdmin 管理后台（可选，未安装 sqladmin 时自动跳过）
    try:
        from .admin_ui import setup_admin_ui

        setup_admin_ui(app)
    except Exception as exc:  # pragma: no cover - graceful degradation
        print(f"[warn] SQLAdmin unavailable, admin panel disabled: {exc}")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict:
        return {"status": "ok", "version": settings.app_version}

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"status": "online", "message": f"{settings.app_name} {settings.app_version}"}

    return app


def _legacy_router():
    """Keep /api/news, /api/schedule, /api/gpa working for the shipped 1.3 app."""
    from fastapi import APIRouter, Query

    router = APIRouter()

    @router.get("/api/schedule")
    async def get_schedule(student_id: str = Query(default="20260001")):
        return {
            "0": [
                {"id": "c1", "name": "Linear Algebra", "room": "204", "prof": "Akhmetov N.T.", "type": "lecture", "startH": 9, "startM": 0, "endH": 10, "endM": 30},
                {"id": "c2", "name": "Higher Math II", "room": "315", "prof": "Bekova A.K.", "type": "lecture", "startH": 11, "startM": 0, "endH": 12, "endM": 30},
            ],
            "1": [
                {"id": "c5", "name": "Data Structures", "room": "301", "prof": "Seitkali B.M.", "type": "lecture", "startH": 9, "startM": 0, "endH": 10, "endM": 30},
            ],
            "2": [
                {"id": "c8", "name": "Physics II", "room": "Lab 3", "prof": "Nurlanova G.S.", "type": "lab", "startH": 14, "startM": 0, "endH": 15, "endM": 30},
            ],
            "3": [
                {"id": "c11", "name": "English C1", "room": "108", "prof": "Omarova D.S.", "type": "seminar", "startH": 16, "startM": 0, "endH": 17, "endM": 30},
            ],
        }

    @router.get("/api/gpa")
    async def get_gpa():
        return {"gpa": 3.82, "change": 0.04, "rank": "top 5%", "history": [3.55, 3.62, 3.70, 3.75, 3.78, 3.82]}

    @router.get("/api/news")
    async def get_news():
        news_file = Path(__file__).resolve().parent.parent.parent / "src" / "data" / "realNews.json"
        try:
            data = json.loads(news_file.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    return router


app = _make_app()
