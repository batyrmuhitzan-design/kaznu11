"""Async SQLAlchemy engine/session management.

Default URL is PostgreSQL via asyncpg. A SQLite + aiosqlite URL can be used
for local smoke tests / CI without a Postgres server:

  DATABASE_URL=sqlite+aiosqlite:///./dev.db
"""
from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool

from .config import settings


class Base(DeclarativeBase):
    pass


_url = settings.database_url
_engine_kwargs: dict = {"echo": settings.db_echo, "pool_pre_ping": True}
# In-memory SQLite smoke tests: force a single shared connection.
if _url.startswith("sqlite") and ":memory:" in _url:
    _engine_kwargs.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
elif _url.startswith("sqlite"):
    _engine_kwargs.update(connect_args={"check_same_thread": False})

# 测试 / 多事件循环场景：禁用连接池（每个 checkout 新建连接）。
# 原因：aiosqlite 的连接绑定在**创建它的事件循环**上。测试脚本里多次 asyncio.run()、
# 或用 TestClient 在自己的 portal 线程里跑 ASGI，都会让"上一个循环里建的连接"
# 被当前循环复用 → 回调排到已关闭的循环上 → **静默死锁**（表现为测试卡住不报错）。
# 生产是单循环长驻，不受影响，所以只提供开关、默认不启用。
if os.getenv("DB_DISABLE_POOL", "false").lower() in {"1", "true", "yes"}:
    from sqlalchemy.pool import NullPool

    _engine_kwargs.pop("poolclass", None)
    _engine_kwargs.update(poolclass=NullPool)

engine = create_async_engine(_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields one async DB session per request."""
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create all tables on startup (test-version convenience).

    Production can switch to Alembic migrations later without changing models.
    """
    # Import models so they register on the metadata before create_all.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_user_role_columns)
        await conn.run_sync(_ensure_post_official_columns)


def _ensure_user_role_columns(sync_conn: Any) -> None:
    """轻量兼容迁移：旧库 users 表补充 role / is_banned 列（CREATE TABLE 新建库自动包含）。

    Production 请迁移到 Alembic。
    """
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    if not inspector.has_table("users"):
        return
    existing = {col["name"] for col in inspector.get_columns("users")}
    statements: list[str] = []
    if "role" not in existing:
        statements.append("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'")
    if "is_banned" not in existing:
        statements.append("ALTER TABLE users ADD COLUMN is_banned BOOLEAN NOT NULL DEFAULT 0")
    for stmt in statements:
        sync_conn.execute(text(stmt))


def _ensure_post_official_columns(sync_conn: Any) -> None:
    """轻量兼容迁移：旧库 posts 表补充官方公告字段（News 融合用）。

    `create_all` 只建**新表**，不会给已存在的表加列 —— 线上库里的 posts 表
    是上一版建的，所以这两列必须显式 ALTER，否则启动后查帖子会 500。
    Production 请迁移到 Alembic。
    """
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    if not inspector.has_table("posts"):
        return
    existing = {col["name"] for col in inspector.get_columns("posts")}
    statements: list[str] = []
    if "is_official" not in existing:
        statements.append("ALTER TABLE posts ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT 0")
    if "official_badge" not in existing:
        statements.append("ALTER TABLE posts ADD COLUMN official_badge VARCHAR(40)")
    for stmt in statements:
        sync_conn.execute(text(stmt))
