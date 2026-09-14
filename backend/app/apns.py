"""APNs 发送端（Live Activity 远程推送）。

设计要点
--------
* **按需依赖**：``PyJWT`` / ``cryptography`` / ``h2`` 只在真正要发推送时导入。
  没装或没配凭据 → ``ApnsClient.configured == False``，发送直接跳过并返回说明，
  **不会让 API 进程崩**（这样没有付费开发者账号的部署也能正常服务）。
* **JWT 缓存**：APNs 要求 token 有效期 ≤ 1 小时，这里 40 分钟刷新一次。
* **topic**：Live Activity 的推送 topic 必须是 ``<bundle>.push-type.liveactivity``，
  不是普通推送的 bundle id —— 用错 topic 会被 APNs 以 ``TopicDisallowed`` 拒绝。
* **HTTP/2**：APNs 只接受 HTTP/2（httpx 需要 ``h2`` 包：``pip install "httpx[http2]"``）。
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import settings

APNS_HOST_SANDBOX = "https://api.sandbox.push.apple.com"
APNS_HOST_PRODUCTION = "https://api.push.apple.com"

#: JWT 刷新间隔（APNs 上限 1 小时）
_JWT_TTL_SECONDS = 40 * 60


def live_activity_topic(bundle_id: str | None = None) -> str:
    """Live Activity 的 APNs topic。"""
    bundle = (bundle_id or settings.apns_bundle_id or "com.kaznu.helper").strip()
    return f"{bundle}.push-type.liveactivity"


@dataclass
class ApnsResult:
    """一次发送的结果。``status=None`` 表示压根没发（未配置 / 依赖缺失）。"""

    ok: bool
    status: int | None = None
    reason: str | None = None
    detail: str | None = None

    @property
    def token_invalid(self) -> bool:
        """token 失效（410 / BadDeviceToken 等）→ 调用方应清理这条注册。"""
        if self.status == 410:
            return True
        return self.reason in {
            "BadDeviceToken",
            "DeviceTokenNotForTopic",
            "Unregistered",
            "ExpiredToken",
        }


class _JwtCache:
    """ES256 JWT 生成 + 缓存（线程安全，异步发送场景下也只需一把锁）。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token: str | None = None
        self._issued_at = 0.0
        self._error: str | None = None

    def get(self) -> tuple[str | None, str | None]:
        """返回 ``(token, error)``；无需 token 时 error 说明原因。"""
        with self._lock:
            now = time.time()
            if self._token and (now - self._issued_at) < _JWT_TTL_SECONDS:
                return self._token, None
            token, error = self._mint()
            if token is None:
                self._error = error
                return None, error
            self._token = token
            self._issued_at = now
            self._error = None
            return token, None

    def _private_key(self) -> tuple[str | None, str | None]:
        if settings.apns_key_p8.strip():
            return settings.apns_key_p8.strip(), None
        path = settings.apns_key_path.strip()
        if not path:
            return None, "APNS_KEY_PATH / APNS_KEY_P8 未配置"
        try:
            return Path(path).read_text(encoding="utf-8"), None
        except OSError as exc:
            return None, f"读取 .p8 失败: {exc}"

    def _mint(self) -> tuple[str | None, str | None]:
        key_id = settings.apns_key_id.strip()
        team_id = settings.apns_team_id.strip()
        if not key_id or not team_id:
            return None, "APNS_KEY_ID / APNS_TEAM_ID 未配置"
        key, error = self._private_key()
        if key is None:
            return None, error
        try:
            import jwt  # PyJWT；缺依赖时给明确提示而不是抛栈
        except ImportError:
            return None, '缺少 PyJWT，安装：pip install "PyJWT[crypto]"'
        try:
            return (
                jwt.encode(
                    {"iss": team_id, "iat": int(time.time())},
                    key,
                    algorithm="ES256",
                    headers={"kid": key_id},
                ),
                None,
            )
        except Exception as exc:  # pragma: no cover - 取决于凭据内容
            return None, f"生成 APNs JWT 失败: {type(exc).__name__}: {exc}"


class ApnsClient:
    """Live Activity 推送发送器（进程内单例）。

    用法::

        result = await apns.send_live_activity(
            token=push_to_start_token, payload=build_start_payload(...),
            environment="sandbox", event="start",
        )
        if not result.ok: ...
    """

    def __init__(self) -> None:
        self._jwt = _JwtCache()
        self._client: Any | None = None

    # ------------------------------------------------------------ 状态

    @property
    def configured(self) -> bool:
        """是否配置了完整的 APNs 凭据（key id + team id + .p8）。"""
        has_key = bool(settings.apns_key_p8.strip() or settings.apns_key_path.strip())
        return bool(settings.apns_key_id.strip() and settings.apns_team_id.strip() and has_key)

    def status(self) -> dict[str, Any]:
        """供 ``GET /live-activity/apns-status`` 自检用（不泄露密钥内容）。"""
        error: str | None = None
        usable = False
        if self.configured:
            token, error = self._jwt.get()
            usable = token is not None
        else:
            error = "APNs 凭据未配置（APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_PATH）"
        return {
            "configured": self.configured,
            "usable": usable,
            "error": error,
            "topic": live_activity_topic(),
            "environment": "sandbox" if settings.apns_use_sandbox else "production",
            "push_enabled": settings.live_activity_push_enabled,
            "alert_on_start": settings.live_activity_alert_on_start,
            "lead_seconds": settings.live_activity_lead_seconds,
        }

    # ------------------------------------------------------------ HTTP

    async def _http(self) -> Any | None:
        """惰性创建 HTTP/2 客户端；缺 h2 / httpx 时返回 None。"""
        if self._client is not None:
            return self._client
        try:
            import httpx
        except ImportError:  # pragma: no cover
            return None
        self._client = httpx.AsyncClient(http2=True, timeout=15.0)
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------ 发送

    async def send_live_activity(
        self,
        *,
        token: str,
        payload: dict[str, Any],
        event: str = "update",
        environment: str | None = None,
        priority: int = 10,
        collapse_id: str | None = None,
        expiration: int = 0,
    ) -> ApnsResult:
        """发送一条 Live Activity 推送（start / update / end）。

        Args:
            token: push-to-start token（start）或某个 Activity 的 push token（update/end）
            payload: ``live_activity_payload`` 里构造好的 ``{"aps": {...}}``
            environment: sandbox / production；缺省用全局配置
        """
        if not settings.live_activity_push_enabled:
            return ApnsResult(False, None, "push-disabled", "LIVE_ACTIVITY_PUSH_ENABLED=false")
        if not self.configured:
            return ApnsResult(False, None, "apns-not-configured", "缺少 APNs 凭据，未发送")

        jwt_token, error = self._jwt.get()
        if jwt_token is None:
            return ApnsResult(False, None, "jwt-unavailable", error)

        client = await self._http()
        if client is None:
            return ApnsResult(False, None, "httpx-unavailable", "httpx 未安装")

        env = (environment or ("sandbox" if settings.apns_use_sandbox else "production")).lower()
        host = APNS_HOST_SANDBOX if env == "sandbox" else APNS_HOST_PRODUCTION

        headers = {
            "authorization": f"bearer {jwt_token}",
            "apns-topic": live_activity_topic(),
            "apns-push-type": "liveactivity",
            "apns-priority": str(priority),
            "apns-expiration": str(expiration),
            "content-type": "application/json",
        }
        if collapse_id:
            # 同一门课的多次更新合并成一条，避免锁屏出现重复/闪烁
            headers["apns-collapse-id"] = collapse_id[:64]

        try:
            response = await client.post(
                f"{host}/3/device/{token}",
                headers=headers,
                content=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            )
        except Exception as exc:  # 网络 / HTTP2 协商失败
            return ApnsResult(False, None, "transport-error", f"{type(exc).__name__}: {exc}")

        if response.status_code == 200:
            return ApnsResult(True, 200, None, f"{event} delivered")

        reason: str | None = None
        detail = response.text[:280]
        try:
            reason = json.loads(response.text).get("reason")
        except Exception:
            pass
        return ApnsResult(False, response.status_code, reason, detail)


#: 进程内单例（路由与调度器共用同一个连接池）
apns = ApnsClient()
