"""Async SQLAlchemy engine/session management.

Default URL is PostgreSQL via asyncpg. A SQLite + aiosqlite URL can be used
for local smoke tests / CI without a Postgres server:

  DATABASE_URL=sqlite+aiosqlite:///./dev.db
"""
from __future__ import annotations

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
