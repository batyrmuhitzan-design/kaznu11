"""社区论坛（NodeBB）单点登录：社区入口 + 一次性跳转码 → 共享会话 cookie。

为什么是这套流程（完整论证见 deploy/nodebb/README.md「鉴权」一节）：
  * NodeBB 的**所有写请求都强制 CSRF**，而 CSRF 令牌绑在**会话**上；
    我们的 SPA 在真机上是 `capacitor://localhost` 源，WKWebView 会拦第三方 cookie
    —— 所以"前端直连 NodeBB 写接口"这条路走不通（实测 403）。
  * 于是让前端只做**入口**：点一下 → 我们签发一次性码 → 在（应用内）Safari 里打开
    `/api/v1/community/launch?code=…` → 我们 302 到论坛，并在同一个响应里
    `Set-Cookie`（内含 HS256 JWT）→ NodeBB 的 `nodebb-plugin-session-sharing`
    读到就**自动登录/建号**。全程不需要用户重输密码，也不碰 CSRF。

安全要点：
  * 码只存 SHA-256 哈希，60 秒有效，**用一次即作废**；
  * 真正的 JWT 只在 `Set-Cookie` 里下发，**不经过 URL**（URL 会进历史/Referer/日志）；
  * cookie 为 `HttpOnly; Secure; SameSite=Lax`，作用域是裸域（`.1losion.me`），
    才能被 `forum.1losion.me` 读到；
  * 未配置论坛地址或密钥时整个入口自动关闭，前端据此隐藏按钮。
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_session
from ..deps import get_current_user, limiter
from ..models import CommunityLaunchCode, User
from ..schemas import CommunityLaunchOut, CommunityStatusOut
from ..security import code_hash, sign_jwt_hs256

router = APIRouter(tags=["community"])

_NOT_CONFIGURED = "Community forum is not configured on this server."


def _launch_username(user: User) -> str:
    """NodeBB 上的用户名：加前缀避免与论坛既有用户名撞车。"""
    raw = (user.global_display_name or user.univer_username or "student").strip()
    # NodeBB 用户名不接受这些字符，统一换成下划线
    safe = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in raw)[:32]
    return f"{settings.community_username_prefix}{safe}"[:64]


@router.get("/community/status", response_model=CommunityStatusOut)
async def community_status(user: User = Depends(get_current_user)) -> CommunityStatusOut:
    """前端入口按钮据此显示/隐藏（未配置时不给出"点了没反应"的按钮）。"""
    return CommunityStatusOut(
        enabled=settings.community_enabled,
        forum_url=settings.community_forum_url or None,
    )


@router.post(
    "/community/launch-token",
    response_model=CommunityLaunchOut,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def create_launch_token(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CommunityLaunchOut:
    """登录用户换取一次性跳转 URL（前端拿到后直接打开）。"""
    if not settings.community_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_CONFIGURED)

    raw_code = secrets.token_urlsafe(32)
    ttl = max(15, settings.community_launch_ttl)
    session.add(
        CommunityLaunchCode(
            code_hash=code_hash(raw_code),
            user_id=user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl),
        )
    )
    await session.commit()

    url = f"{settings.public_base_url}/api/v1/community/launch?code={raw_code}"
    return CommunityLaunchOut(url=url, expires_in=ttl)


@router.get("/community/launch")
async def launch(
    code: str = Query(min_length=16, max_length=200),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """校验并消费一次性码 → 302 到论坛，同时下发共享 session cookie。"""
    if not settings.community_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_CONFIGURED)

    row = await session.scalar(
        select(CommunityLaunchCode).where(CommunityLaunchCode.code_hash == code_hash(code))
    )
    now = datetime.now(timezone.utc)
    if row is None or row.used_at is not None:
        # 不区分"不存在"与"已用过"，避免探测
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Launch link is invalid or already used. Open the community again from the app.",
        )
    expires_at = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Launch link expired. Open the community again from the app.",
        )

    user = await session.scalar(select(User).where(User.id == row.user_id))
    if user is None or user.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account suspended")

    # 先作废再跳转：即使浏览器/网络中途中止，码也不会被二次使用
    row.used_at = now
    await session.commit()

    payload: dict[str, object] = {"id": user.id, "username": _launch_username(user)}
    if user.univer_email:
        payload["email"] = user.univer_email
    token = sign_jwt_hs256(payload, settings.community_sso_secret, settings.community_jwt_ttl)

    response = RedirectResponse(
        # `?kz_app=1` 让注入的 JS 给 <html> 加 `.kz-app`，从而只在"从 App / 入口卡进入"
        # 的会话里启用 App 内嵌极简主题（直接访问 forum 域名或 ACP 后台都不受影响）。
        url=f"{settings.community_forum_url}?kz_app=1",
        status_code=status.HTTP_302_FOUND,
    )
    response.set_cookie(
        key=settings.community_sso_cookie,
        value=token,
        domain=settings.community_cookie_scope,
        path="/",
        max_age=settings.community_jwt_ttl,
        httponly=True,
        secure=True,  # 只走 HTTPS（生产域名已强制 https）
        samesite="lax",  # 顶层导航（子域之间）会携带，跨站 POST 不会
    )
    return response
