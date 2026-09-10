"""Application settings loaded from environment / .env (python-dotenv).

Central place for:
  - DATABASE_URL      (PostgreSQL + asyncpg in production; SQLite fallback for a
                       single-box deploy or local run with no Postgres)
  - Univer demo login
  - anonymous_hash pepper
  - CORS origins
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

from dotenv import load_dotenv

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.abspath(os.path.join(_BACKEND_DIR, "..", ".."))

# .env 解析顺序（load_dotenv 不覆盖已存在的变量）：当前工作目录 → backend/.env → 仓库根 .env
load_dotenv()
load_dotenv(os.path.join(_BACKEND_DIR, "..", ".env"))
load_dotenv(os.path.join(_REPO_ROOT, ".env"))


@dataclass(frozen=True)
class Settings:
    app_name: str = "KazNU Helper API"
    app_version: str = "2.0.0-beta.1"
    debug: bool = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}

    # 数据库：
    #  - 生产（docker compose / 自建 Postgres）：设置 DATABASE_URL
    #      DATABASE_URL=postgresql+asyncpg://kaznu:password@localhost:5432/kaznu_helper
    #  - 未设置时的兜底：本地 SQLite 文件（零依赖即可跑通评价系统 / 管理后台）
    database_url: str = os.getenv(
        "DATABASE_URL",
        "sqlite+aiosqlite:///./kaznu_helper.db",
    )
    db_echo: bool = os.getenv("DB_ECHO", "false").lower() in {"1", "true", "yes"}

    # Demo Univer auth: real deployment plugs the Univer.kz check (backend/scraper.py).
    # The demo gate still enforces the *Univer account shape* (student id / @student.kaznu.kz).
    demo_password: str = os.getenv("DEMO_PASSWORD", "123456")
    demo_all_password: bool = os.getenv("DEMO_ALL_PASSWORD", "true").lower() in {"1", "true", "yes"}

    # Pepper for the per-account anonymous hash (never persisted raw).
    anon_hash_secret: str = os.getenv("ANON_HASH_SECRET", "kaznu-helper-dev-pepper-change-me")

    # 内置超级管理员账号（SQLAdmin / 超管 API 使用）。启动时自动创建（仅当不存在）。
    super_admin_username: str = os.getenv("SUPER_ADMIN_USERNAME", "superadmin@student.kaznu.kz")
    super_admin_password: str = os.getenv("SUPER_ADMIN_PASSWORD", "")
    # SQLAdmin 会话签名密钥（默认复用 anon hash pepper；生产请单独设置）
    admin_session_secret: str = os.getenv("ADMIN_SESSION_SECRET", "")

    # Allow all origins while serving a local app; tighten for production.
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS",
                "*",
            ).split(",")
            if o.strip()
        ]
    )

    # Seed the local catalog on first boot.
    seed_on_startup: bool = os.getenv("SEED_ON_STARTUP", "true").lower() in {"1", "true", "yes"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
