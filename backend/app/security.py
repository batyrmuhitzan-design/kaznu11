"""Security primitives.

- anonymous_hash: HMAC-SHA256(secret, univer_username) → stable per-account hash.
  Used ONLY for duplicate-spam prevention; the raw hash is never exposed to clients.
- Signed bearer tokens: stateless HMAC-signed token carrying {uid}.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

from .config import settings

TOKEN_TTL_SECONDS = 15 * 24 * 60 * 60  # remember me: 15 days


def anonymous_hash(univer_username: str) -> str:
    """Deterministic per-account hash. Same account → same hash (per professor uniqueness)."""
    normalized = univer_username.strip().lower()
    digest = hmac.new(
        settings.anon_hash_secret.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest


def random_display_name() -> str:
    """First-login default: `user` + 7 random digits, e.g. user9728642."""
    return f"user{1000000 + int.from_bytes(uuid.uuid4().bytes[:4], 'big') % 9000000}"


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str) -> str:
    return hmac.new(settings.anon_hash_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()


def create_access_token(user_id: str) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS, "jti": uuid.uuid4().hex}
    payload_b64 = _b64encode(json.dumps(payload).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def sign_jwt_hs256(payload: dict[str, Any], secret: str, ttl_seconds: int) -> str:
    """签发**标准 JWT（HS256）** —— 给 NodeBB 的 session-sharing 插件用。

    为什么不装 PyJWT：本模块已经有 HMAC + base64url 的手写实现，为 20 行功能
    再加一个依赖不划算。格式必须与 JS 的 `jsonwebtoken` 完全一致，否则 NodeBB 验签失败：
      · header 固定 `{"alg":"HS256","typ":"JWT"}`
      · `iat` / `exp` 是**秒级** Unix 时间戳
      · base64url 且**去掉 `=` 填充**（`_b64encode` 已如此）
      · 签名是对 `header.payload` 这段 ASCII 字符串做 HMAC-SHA256
    payload 里**不要放隐私数据**：JWT 只签名不加密，Base64 可被任何人解开。
    """
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + ttl_seconds}
    segments = (
        f"{_b64encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))}."
        f"{_b64encode(json.dumps(body, separators=(',', ':')).encode('utf-8'))}"
    )
    signature = hmac.new(secret.encode("utf-8"), segments.encode("ascii"), hashlib.sha256).digest()
    return f"{segments}.{_b64encode(signature)}"


def code_hash(raw_code: str) -> str:
    """一次性跳转码只存哈希，避免"库被读走 = 能冒充任何用户登录论坛"。"""
    return hashlib.sha256(raw_code.encode("utf-8")).hexdigest()



def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        payload_b64, signature = token.split(".")
        if not hmac.compare_digest(_sign(payload_b64), signature):
            return None
        payload = json.loads(_b64decode(payload_b64))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None
