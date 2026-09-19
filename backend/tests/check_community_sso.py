# -*- coding: utf-8 -*-
"""社区论坛（NodeBB）SSO 后端自检。

    python backend/tests/check_community_sso.py

无需 PostgreSQL（自动用临时 SQLite），也**不需要真的装着 NodeBB** ——
这里验证的是**我们这一侧**的行为：
  1) 三个端点进 OpenAPI；未登录一律 401
  2) 已配置 → /community/launch-token 返回 201 + 一次性 URL；未配置 → 503（前端据此隐藏按钮）
  3) 库里只存 SHA-256 哈希，**原文码不入库**（库被读走也无法冒充用户）
  4) /community/launch：302 到论坛 + Set-Cookie 属性齐全（HttpOnly/Secure/SameSite=Lax/Domain=裸域）
  5) 下发的 JWT 能用共享密钥**自行验签通过**，且 payload 里的 id/username 正确
     —— 这一步等价于 NodeBB 插件的验签，格式不对（padding、算法、时间戳）会在这里暴露
  6) 同一个码第二次使用 → 410（一次性）；过期码 / 未知码 → 410；被封禁用户 → 403
"""
from __future__ import annotations

import asyncio
import base64 as _b64
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 必须在导入入口前设置环境：临时 SQLite + 社区 SSO 配置
_db_file = Path(tempfile.gettempdir()) / "kaznu_check_community_sso.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-community-sso-secret"
os.environ["PUBLIC_BASE_URL"] = "https://1losion.me"
os.environ["COMMUNITY_FORUM_URL"] = "https://forum.example.test"
os.environ["COMMUNITY_SSO_SECRET"] = "unit-test-shared-secret"
os.environ["COMMUNITY_SSO_COOKIE"] = "token"
os.environ["COMMUNITY_COOKIE_DOMAIN"] = ""
os.environ["COMMUNITY_LAUNCH_TTL"] = "60"

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

import main as entrypoint  # noqa: E402  ← 被测对象：仓库根 main.py

from app import config as app_config  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import CommunityLaunchCode, User  # noqa: E402
from app.security import code_hash  # noqa: E402

app = entrypoint.app
EXPECTED_PATHS = [
    "/api/v1/community/status",
    "/api/v1/community/launch-token",
    "/api/v1/community/launch",
]
SECRET = os.environ["COMMUNITY_SSO_SECRET"]
DEMO_USER = "20260001"
DEMO_PASSWORD = "123456"

fails: list[str] = []


def ok(msg: str) -> None:
    print(f"  [ok] {msg}", flush=True)


def bad(msg: str) -> None:
    fails.append(msg)
    print(f"  [!!] {msg}", flush=True)


def _b64url_decode(data: str) -> bytes:
    return _b64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def verify_jwt(token: str, secret: str) -> dict:
    """按 JWT 规范自行验签（等价于 NodeBB 里 jsonwebtoken.verify 做的事）。"""
    header_b64, payload_b64, signature_b64 = token.split(".")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64url_decode(signature_b64)):
        raise ValueError("签名不匹配（NodeBB 会拒签）")
    header = json.loads(_b64url_decode(header_b64))
    if header.get("alg") != "HS256" or header.get("typ") != "JWT":
        raise ValueError(f"header 不合规：{header}")
    payload = json.loads(_b64url_decode(payload_b64))
    if not isinstance(payload.get("exp"), int) or not isinstance(payload.get("iat"), int):
        raise ValueError("exp/iat 必须是秒级整数时间戳")
    if payload["exp"] <= int(time.time()):
        raise ValueError("已过期")
    return payload


def cookie_of(response: httpx.Response) -> str:
    return response.headers.get("set-cookie", "")


async def main() -> None:
    print("=== 1) OpenAPI 是否暴露三个端点 ===", flush=True)
    await init_db()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as anon:
        spec = (await anon.get("/openapi.json")).json()
        paths = spec.get("paths", {})
        for path in EXPECTED_PATHS:
            if path in paths:
                ok(f"OpenAPI 含 {path}")
            else:
                bad(f"OpenAPI 缺少 {path}")

        print("=== 2) 未登录一律 401 ===", flush=True)
        for method, path in (("GET", "/api/v1/community/status"), ("POST", "/api/v1/community/launch-token")):
            res = await anon.request(method, path)
            if res.status_code == 401:
                ok(f"{method} {path} 未登录 → 401")
            else:
                bad(f"{method} {path} 未登录 → {res.status_code}（期望 401）")

        print("=== 3) 登录后拿到状态 + 一次性跳转 URL ===", flush=True)
        login = await anon.post(
            "/api/v1/auth/login", json={"username": DEMO_USER, "password": DEMO_PASSWORD}
        )
        if login.status_code != 200:
            bad(f"演示账号登录失败：HTTP {login.status_code} {login.text[:160]}")
            raise SystemExit(1)
        token = login.json()["access_token"]
        user_id = login.json()["user"]["id"]
        auth = {"Authorization": f"Bearer {token}"}

        status_res = await anon.get("/api/v1/community/status", headers=auth)
        body = status_res.json() if status_res.status_code == 200 else {}
        if body.get("enabled") is True and body.get("forum_url") == os.environ["COMMUNITY_FORUM_URL"]:
            ok(f"已配置状态下 enabled=True，forum_url={body.get('forum_url')}")
        else:
            bad(f"/community/status 异常：HTTP {status_res.status_code} {str(body)[:160]}")

        minted = await anon.post("/api/v1/community/launch-token", headers=auth)
        if minted.status_code == 201:
            payload = minted.json()
            raw_code = payload["url"].split("code=", 1)[-1]
            if payload["url"].startswith(f"{os.environ['PUBLIC_BASE_URL']}/api/v1/community/launch?code="):
                ok(f"跳转 URL 形状正确（expires_in={payload['expires_in']}s）")
            else:
                bad(f"跳转 URL 形状不对：{payload['url']}")
            if payload["expires_in"] == int(os.environ["COMMUNITY_LAUNCH_TTL"]):
                ok("expires_in 与 COMMUNITY_LAUNCH_TTL 一致")
            else:
                bad(f"expires_in={payload['expires_in']}（期望 {os.environ['COMMUNITY_LAUNCH_TTL']}）")
        else:
            bad(f"POST /community/launch-token → HTTP {minted.status_code} {minted.text[:160]}")
            raise SystemExit(1)

        print("=== 4) 库里只存哈希，原文码不入库 ===", flush=True)
        async with SessionLocal() as session:
            stored = await session.scalar(
                select(CommunityLaunchCode).where(CommunityLaunchCode.code_hash == code_hash(raw_code))
            )
            raw_lookup = await session.scalar(
                select(CommunityLaunchCode).where(CommunityLaunchCode.code_hash == raw_code)
            )
            if stored is not None and stored.user_id == user_id:
                ok("按 sha256(码) 能查到记录，且归属正确")
            else:
                bad("按 sha256(码) 查不到记录 / 归属不对")
            if raw_lookup is None:
                ok("库中不存在以原文码为键的记录（原文不落库）")
            else:
                bad("原文码竟然被直接入库了")

        print("=== 5) /community/launch：302 + cookie + JWT 可验签 ===", flush=True)
        launched = await anon.get(f"/api/v1/community/launch?code={raw_code}", follow_redirects=False)
        if launched.status_code == 302:
            ok("一次性码 → 302（未跟随重定向）")
        else:
            bad(f"一次性码 → HTTP {launched.status_code}（期望 302） {launched.text[:160]}")
        if launched.headers.get("location") == os.environ["COMMUNITY_FORUM_URL"]:
            ok(f"Location 指向论坛：{launched.headers.get('location')}")
        else:
            bad(f"Location 不对：{launched.headers.get('location')}")

        cookie = cookie_of(launched)
        lowered = cookie.lower()
        for passed, label in (
            ("token=" in cookie, "cookie 名 token="),
            ("httponly" in lowered, "HttpOnly"),
            ("secure" in lowered, "Secure"),
            ("samesite=lax" in lowered, "SameSite=Lax"),
            # 按论坛域名 forum.example.test 推导出裸域 .example.test
            ("domain=.example.test" in lowered, "Domain=裸域（.example.test）"),
            ("path=/" in lowered, "Path=/"),
        ):
            if passed:
                ok(f"cookie 含 {label}")
            else:
                bad(f"cookie 缺少 {label}：{cookie}")

        jwt_value = cookie.split("token=", 1)[-1].split(";", 1)[0] if "token=" in cookie else ""
        try:
            claims = verify_jwt(jwt_value, SECRET)
            short = {k: claims.get(k) for k in ("id", "username")}
            ok(f"JWT 验签通过（等价于 NodeBB 插件校验）：{short}")
            if claims.get("id") == user_id:
                ok("JWT.id 与登录用户一致（插件据此匹配论坛账号）")
            else:
                bad(f"JWT.id={claims.get('id')} 与用户 id={user_id} 不一致")
            if str(claims.get("username", "")).startswith("kaznu_"):
                ok(f"JWT.username 带前缀：{claims.get('username')}")
            else:
                bad(f"JWT.username 缺前缀：{claims.get('username')}")
        except Exception as exc:  # noqa: BLE001
            bad(f"JWT 验签失败（NodeBB 会拒绝）：{exc}")

        print("=== 6) 一次性 / 未知 / 过期 / 封禁 ===", flush=True)
        replay = await anon.get(f"/api/v1/community/launch?code={raw_code}", follow_redirects=False)
        if replay.status_code == 410:
            ok("同一个码第二次使用 → 410（一次性生效）")
        else:
            bad(f"重放返回 {replay.status_code}（期望 410）")

        unknown = await anon.get(
            "/api/v1/community/launch?code=definitely-not-a-real-code-123456", follow_redirects=False
        )
        if unknown.status_code == 410:
            ok("未知码 → 410（不区分「不存在」与「已用过」）")
        else:
            bad(f"未知码返回 {unknown.status_code}（期望 410）")

        expired_raw = "expired-code-for-test-0123456789"
        async with SessionLocal() as session:
            session.add(
                CommunityLaunchCode(
                    code_hash=code_hash(expired_raw),
                    user_id=user_id,
                    expires_at=datetime.now(timezone.utc) - timedelta(seconds=5),
                )
            )
            await session.commit()
        expired = await anon.get(f"/api/v1/community/launch?code={expired_raw}", follow_redirects=False)
        if expired.status_code == 410:
            ok("过期码 → 410")
        else:
            bad(f"过期码返回 {expired.status_code}（期望 410）")

        banned_raw = "banned-user-code-for-test-0123456789"
        async with SessionLocal() as session:
            user = await session.scalar(select(User).where(User.id == user_id))
            session.add(
                CommunityLaunchCode(
                    code_hash=code_hash(banned_raw),
                    user_id=user_id,
                    expires_at=datetime.now(timezone.utc) + timedelta(seconds=60),
                )
            )
            if user is not None:
                user.is_banned = True
            await session.commit()
        banned = await anon.get(f"/api/v1/community/launch?code={banned_raw}", follow_redirects=False)
        if banned.status_code == 403:
            ok("被封禁用户 → 403")
        else:
            bad(f"封禁用户返回 {banned.status_code}（期望 403）")
        async with SessionLocal() as session:
            user = await session.scalar(select(User).where(User.id == user_id))
            if user is not None:
                user.is_banned = False
                await session.commit()

        print("=== 7) 未配置（域名/密钥缺失）时入口必须关闭 ===", flush=True)
        original_forum = app_config.settings.community_forum_url
        original_secret = app_config.settings.community_sso_secret
        try:
            object.__setattr__(app_config.settings, "community_forum_url", "")
            object.__setattr__(app_config.settings, "community_sso_secret", "")
            disabled_status = await anon.get("/api/v1/community/status", headers=auth)
            if disabled_status.status_code == 200 and disabled_status.json().get("enabled") is False:
                ok("未配置 → /community/status enabled=False（前端据此隐藏按钮）")
            else:
                bad(f"未配置时 status 异常：HTTP {disabled_status.status_code} {disabled_status.text[:120]}")
            disabled_mint = await anon.post("/api/v1/community/launch-token", headers=auth)
            if disabled_mint.status_code == 503:
                ok("未配置 → POST /community/launch-token 503")
            else:
                bad(f"未配置时 launch-token 返回 {disabled_mint.status_code}（期望 503）")
        finally:
            object.__setattr__(app_config.settings, "community_forum_url", original_forum)
            object.__setattr__(app_config.settings, "community_sso_secret", original_secret)

    print("\n===== 社区 SSO 自检结论 =====", flush=True)
    if fails:
        print("\n".join(f"  [!!] {f}" for f in fails), flush=True)
        raise SystemExit(1)
    print("  全部通过", flush=True)


if __name__ == "__main__":
    asyncio.run(main())



