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
