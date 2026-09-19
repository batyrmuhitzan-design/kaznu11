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
    #: 新用户首次登录时，由"校园助手"演示账号主动发一条欢迎私信（演示构建默认开；生产关掉）
    demo_welcome_dm: bool = os.getenv("DEMO_WELCOME_DM", "true").lower() in {"1", "true", "yes"}

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

    # ---------- APNs / Live Activity 远程推送 ----------
    # 没配置任何凭据时 live activity 推送自动跳过（configured=False），
    # 后端照常运行 —— App 端本地触发兜底依然有效。
    apns_key_id: str = os.getenv("APNS_KEY_ID", "")
    apns_team_id: str = os.getenv("APNS_TEAM_ID", "")
    #: .p8 私钥路径（推荐），或直接用 APNS_KEY_P8 内联
    apns_key_path: str = os.getenv("APNS_KEY_PATH", "")
    apns_key_p8: str = os.getenv("APNS_KEY_P8", "")
    #: 主 App 的 Bundle ID（Live Activity topic = <bundle>.push-type.liveactivity）
    apns_bundle_id: str = os.getenv("APNS_BUNDLE_ID", "com.kaznu.helper")
    #: 开发构建/直接侧载用 sandbox；TestFlight 与 App Store 用 production
    apns_use_sandbox: bool = os.getenv("APNS_USE_SANDBOX", "true").lower() in {"1", "true", "yes"}
    #: 课前提前多久推送（秒）。需求是 15 分钟。
    live_activity_lead_seconds: int = int(os.getenv("LIVE_ACTIVITY_LEAD_SECONDS", str(15 * 60)))
    #: 是否在定时任务里真的发推送（本地调试可关）
    live_activity_push_enabled: bool = os.getenv(
        "LIVE_ACTIVITY_PUSH_ENABLED", "true"
    ).lower() in {"1", "true", "yes"}
    #: start 事件是否附带 alert（会弹普通通知；用户没授权通知时 iOS 会自动忽略）
    live_activity_alert_on_start: bool = os.getenv(
        "LIVE_ACTIVITY_ALERT_ON_START", "true"
    ).lower() in {"1", "true", "yes"}
    #: 调度循环间隔（秒）
    live_activity_tick_seconds: int = int(os.getenv("LIVE_ACTIVITY_TICK_SECONDS", "60"))

    # ---------- 图片上传 / 存储（发帖与私信的本地相册上传） ----------
    #: 上传目录（未配云存储时使用），通过 /media 静态挂载对外提供
    upload_dir: str = os.getenv("UPLOAD_DIR", "./media")
    #: 单张图片大小上限（字节），默认 8 MB
    upload_max_bytes: int = int(os.getenv("UPLOAD_MAX_BYTES", str(8 * 1024 * 1024)))
    #: 上传总开关（出问题时可以一键停掉，客户端会回退到"仅文字"发帖）
    uploads_enabled: bool = os.getenv("UPLOADS_ENABLED", "true").lower() in {"1", "true", "yes"}
    #: 对外站点根地址 —— 拼图片**绝对 URL** 用（iOS 端直接拿这个 URL 渲染，不用再拼域名）
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "https://1losion.me").rstrip("/")
    #: local（默认，零凭据可用）| s3（Supabase Storage / Azure Blob S3 网关 / R2 / MinIO）
    storage_backend: str = os.getenv("STORAGE_BACKEND", "local").lower()
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")
    s3_bucket: str = os.getenv("S3_BUCKET", "")
    s3_region: str = os.getenv("S3_REGION", "auto")
    s3_access_key_id: str = os.getenv("S3_ACCESS_KEY_ID", "")
    s3_secret_access_key: str = os.getenv("S3_SECRET_ACCESS_KEY", "")
    #: 云存储的公开读地址（如 https://<proj>.supabase.co/storage/v1/object/public/<bucket>）
    s3_public_base: str = os.getenv("S3_PUBLIC_BASE", "").rstrip("/")

    # ---------- 通知推送（全校广播 / 互动通知 / 私信离线推送） ----------
    #: 关掉后所有普通通知只入库 + 走 WebSocket，不发 APNs（调试用）
    notifications_push_enabled: bool = os.getenv(
        "NOTIFICATIONS_PUSH_ENABLED", "true"
    ).lower() in {"1", "true", "yes"}
    #: 全校广播时的 APNs 并发批次大小（避免一次性打开上千条 HTTP/2 流）
    broadcast_push_batch: int = int(os.getenv("BROADCAST_PUSH_BATCH", "120"))

    # ---------- 社区论坛（NodeBB）单点登录：session-sharing 插件 ----------
    # 原理：我们在**裸域**上写一个含 JWT 的 cookie，NodeBB 的
    # `nodebb-plugin-session-sharing` 读到就自动登录/建号 —— 不需要 OAuth 往返，
    # 也不需要用户重输密码（详见 deploy/nodebb/README.md）。
    #: 论坛地址，必须是 1losion.me 的**子域**（cookie 才能跨子域共享）。
    #: 留空 → 社区入口整体关闭（前端按钮自动隐藏，不给用户"点了没反应"）。
    community_forum_url: str = os.getenv("COMMUNITY_FORUM_URL", "").rstrip("/")
    #: 与 NodeBB 插件共用的 HS256 密钥。**必填**（留空同样视为未启用）
    community_sso_secret: str = os.getenv("COMMUNITY_SSO_SECRET", "")
    #: 共享 cookie 名（要与插件设置里的一致，插件默认 `token`）
    community_sso_cookie: str = os.getenv("COMMUNITY_SSO_COOKIE", "token")
    #: cookie 的 Domain（裸域，例 `.1losion.me`）；留空则按论坛域名自动推导
    community_cookie_domain: str = os.getenv("COMMUNITY_COOKIE_DOMAIN", "")
    #: 一次性跳转码有效期（秒）—— 只够浏览器完成一次跳转
    community_launch_ttl: int = int(os.getenv("COMMUNITY_LAUNCH_TTL", "60"))
    #: 共享 JWT 的有效期（秒，默认 12 小时）；到期后论坛会话自动失效
    community_jwt_ttl: int = int(os.getenv("COMMUNITY_JWT_TTL", str(12 * 60 * 60)))
    #: 论坛上用的用户名前缀（避免与 NodeBB 里已有的用户名撞车）
    community_username_prefix: str = os.getenv("COMMUNITY_USERNAME_PREFIX", "kaznu_")

    @property
    def community_enabled(self) -> bool:
        """论坛地址与密钥都配了才算启用。"""
        return bool(self.community_forum_url and self.community_sso_secret)

    @property
    def community_cookie_scope(self) -> str:
        """cookie 的 Domain 属性：优先用显式配置，否则从论坛 URL 推导裸域。"""
        if self.community_cookie_domain:
            return self.community_cookie_domain
        host = self.community_forum_url.split("//")[-1].split("/")[0].split(":")[0]
        parts = host.split(".")
        return f".{'.'.join(parts[-2:])}" if len(parts) >= 2 else host



@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
