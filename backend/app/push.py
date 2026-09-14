"""通知分发：入库（通知中心）→ 在线走 WebSocket → 离线走 APNs。

三条通路的顺序与职责
-------------------
1. **入库**（``UserNotification``）：通知中心与角标的唯一来源，也是"已读状态"的来源；
2. **WebSocket**（``realtime.manager``）：App 活着时**秒到**，不消耗推送配额，
   而且前台已经看到横幅了就不该再弹系统通知（避免双重打扰）；
3. **APNs**：只有**该用户一台设备都没在线**时才发 —— 这是"微信来消息"式的体验：
   前台静默更新、后台/锁屏弹系统横幅。

⚠️ 三条通路各自 try/except：APNs 没配凭据、WS 断了，都不能影响"消息已经存下来了"。
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .apns import APNS_REASON_UNREGISTERED, APNS_REASON_BAD_TOKEN, apns
from .config import settings
from .models import (
    APNS_ENVIRONMENTS,
    DeviceToken,
    GlobalNotification,
    LiveActivityRegistration,
    NotificationReadCursor,
    UserNotification,
)
from .push_payload import build_alert_payload, build_broadcast_payload
from .realtime import manager

#: APNs 明确告诉"这个 token 废了"的两个 reason（收到了就删，别反复发）
_INVALID_TOKEN_REASONS = {APNS_REASON_UNREGISTERED, APNS_REASON_BAD_TOKEN}


@dataclass(frozen=True)
class PushTarget:
    """一个可推送的设备端点。"""

    token: str
    #: sandbox | production
    environment: str
    #: 该设备的 App 语言（推送文案按它渲染）
    locale: str


# =====================================================================
# 设备端点
# =====================================================================


async def push_targets(session: AsyncSession, user_id: str) -> list[PushTarget]:
    """合并两处来源的设备 token（去重）。

    必须同时读这两张表，否则会出现"配了灵动岛提醒才有推送、关掉就收不到私信"的怪现象：

    * ``device_tokens`` —— 通知注册（我们新加的，与灵动岛开关无关）；
    * ``live_activity_registrations.device_token`` —— 老版本已经登记过的设备，
      没走过新接口也应当能收到通知。
    """
    targets: dict[str, PushTarget] = {}

    rows = await session.scalars(
        select(DeviceToken).where(
            DeviceToken.user_id == user_id,
            DeviceToken.alerts_enabled.is_(True),
        )
    )
    for row in rows.all():
        targets[row.token] = PushTarget(
            token=row.token,
            environment=row.environment if row.environment in APNS_ENVIRONMENTS else "sandbox",
            locale=row.locale or "EN",
        )

    legacy = await session.scalars(
        select(LiveActivityRegistration).where(
            LiveActivityRegistration.user_id == user_id,
            LiveActivityRegistration.device_token.is_not(None),
        )
    )
    for row in legacy.all():
        token = (row.device_token or "").strip()
        if not token or token in targets:
            continue
        targets[token] = PushTarget(
            token=token,
            environment=row.apns_environment if row.apns_environment in APNS_ENVIRONMENTS else "sandbox",
            locale=row.locale or "EN",
        )

    return list(targets.values())


async def all_push_targets(session: AsyncSession) -> list[PushTarget]:
    """全校广播用：所有开启了通知的设备端点。"""
    targets: dict[str, PushTarget] = {}
    rows = await session.scalars(select(DeviceToken).where(DeviceToken.alerts_enabled.is_(True)))
    for row in rows.all():
        targets[row.token] = PushTarget(token=row.token, environment=row.environment, locale=row.locale or "EN")
    legacy = await session.scalars(
        select(LiveActivityRegistration).where(LiveActivityRegistration.device_token.is_not(None))
    )
    for row in legacy.all():
        token = (row.device_token or "").strip()
        if token and token not in targets:
            targets[token] = PushTarget(
                token=token,
                environment=row.apns_environment,
                locale=row.locale or "EN",
            )
    return list(targets.values())


async def purge_invalid_tokens(session: AsyncSession, tokens: list[str]) -> int:
    """删掉 APNs 已判定失效的 token（410 Unregistered / BadDeviceToken）。"""
    if not tokens:
        return 0
    result = await session.execute(
        update(DeviceToken).where(DeviceToken.token.in_(tokens)).values(alerts_enabled=False)
    )
    return result.rowcount or 0


# =====================================================================
# 未读角标
# =====================================================================


async def unread_badge(session: AsyncSession, user_id: str) -> int:
    """未读总数 = 定向通知未读 + 广播未读（广播用游标时间戳算）。"""
    direct = await session.scalar(
        select(func.count(UserNotification.id)).where(
            UserNotification.user_id == user_id,
            UserNotification.is_read.is_(False),
        )
    ) or 0

    cursor = await session.get(NotificationReadCursor, user_id)
    since = cursor.broadcasts_read_at if cursor else None
    since = _aware(since)
    broadcast_clause = [GlobalNotification.is_active.is_(True)]
    if since is not None:
        broadcast_clause.append(GlobalNotification.created_at > since)
    broadcasts = await session.scalar(
        select(func.count(GlobalNotification.id)).where(*broadcast_clause)
    ) or 0
    return int(direct) + int(broadcasts)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite 取回的 datetime 可能是 naive 的 —— 统一补成 UTC，避免比较时报错。"""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


# =====================================================================
# APNs 扇出
# =====================================================================


async def dispatch_alert(
    session: AsyncSession,
    *,
    targets: list[PushTarget],
    payload_for: Any,
    batch_size: int | None = None,
) -> dict[str, Any]:
    """把同一条通知发给多个设备端点（分批并发，自动清理失效 token）。

    Args:
        payload_for: ``(target) -> payload`` 函数 —— 因为**文案要按设备语言渲染**
            （同一用户可能一台英文机、一台俄文机），payload 必须逐设备构造。
    """
    if not targets:
        return {"sent": 0, "failed": 0, "invalid": 0, "targets": 0, "last_error": "no-targets"}

    size = max(1, batch_size or settings.broadcast_push_batch)
    invalid: list[str] = []
    sent = 0
    failed = 0
    last_error: str | None = None

    for start in range(0, len(targets), size):
        batch = targets[start : start + size]
        results = await asyncio.gather(
            *(
                apns.send_alert(
                    token=target.token,
                    payload=payload_for(target),
                    environment=target.environment,
                )
                for target in batch
            ),
            return_exceptions=True,
        )
        for target, result in zip(batch, results):
            if isinstance(result, BaseException):
                failed += 1
                last_error = f"{type(result).__name__}: {result}"
                continue
            if result.ok:
                sent += 1
                continue
            failed += 1
            last_error = result.detail or result.reason
            if result.reason in _INVALID_TOKEN_REASONS:
                invalid.append(target.token)

    if invalid:
        await purge_invalid_tokens(session, invalid)
        await session.commit()

    return {
        "sent": sent,
        "failed": failed,
        "invalid": len(invalid),
        "targets": len(targets),
        "last_error": last_error,
    }


# =====================================================================
# 定向通知（点赞 / 评论 / 私信 / 官方公告）
# =====================================================================


async def notify_user(
    session: AsyncSession,
    *,
    user_id: str,
    kind: str,
    title: str,
    body: str,
    route: str = "none",
    route_id: str | None = None,
    actor_name: str | None = None,
    dedupe_key: str | None = None,
    ws_event: dict[str, Any] | None = None,
    push_when_online: bool = False,
    text_for: Any = None,
    already_delivered: int = 0,
) -> dict[str, Any]:
    """给单个用户发通知：入库 → WebSocket →（离线才）APNs。

    Returns:
        ``{"id","online","ws","push","deduped"}`` —— 便于测试与线上排查。

    ``dedupe_key`` 非空时**幂等**：同 key 已存在就直接返回旧记录、不再打扰
    （反复点赞/取消赞只留一条通知）。

    ``text_for``: 可选 ``(locale) -> (title, body)``。给了它就**按每台设备的语言**
        渲染推送文案（同一用户可能一台英文机、一台俄文机）；入库的那条仍用
        ``title`` / ``body`` 的默认值（App 内的通知中心按 ``kind`` 本地化显示）。
    """
    if dedupe_key:
        existing = await session.scalar(
            select(UserNotification).where(
                UserNotification.user_id == user_id,
                UserNotification.dedupe_key == dedupe_key,
            )
        )
        if existing is not None:
            return {
                "id": existing.id,
                "online": manager.online(user_id),
                "ws": 0,
                "push": None,
                "deduped": True,
            }

    notification = UserNotification(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        route=route,
        route_id=route_id,
        actor_name=actor_name,
        dedupe_key=dedupe_key,
    )
    session.add(notification)
    await session.commit()
    await session.refresh(notification)

    # ---- 通路 2：WebSocket（App 活着时秒到，不消耗推送配额）
    # ``already_delivered > 0`` 表示调用方**已经**把实时帧发给这个用户了（私信就是这种情况：
    # 消息帧本身既是内容也是提醒）。此时不能再发一遍 notification 帧，否则客户端会收到
    # 两条事件、角标也可能被重复计一次 —— 但"在线"这个事实仍然是它给的，所以照样跳过 APNs。
    if already_delivered > 0:
        ws_delivered = already_delivered
    else:
        event = ws_event or {
            "type": "notification",
            "notification": serialize_notification(notification),
        }
        ws_delivered = await manager.send_to_user(user_id, event)

    # ---- 通路 3：APNs（真正离线才发，避免前台"看到横幅又收到系统通知"双重打扰）
    push_result: dict[str, Any] | None = None
    if ws_delivered == 0 or push_when_online:
        targets = await push_targets(session, user_id)
        if targets:
            badge = await unread_badge(session, user_id)
            push_result = await dispatch_alert(
                session,
                targets=targets,
                payload_for=lambda target: build_alert_payload(
                    title=(text_for(target.locale)[0] if text_for else title),
                    body=(text_for(target.locale)[1] if text_for else body),
                    route=route,
                    route_id=route_id,
                    kind=kind,
                    notification_id=notification.id,
                    badge=badge,
                ),
            )

    return {
        "id": notification.id,
        "online": ws_delivered > 0,
        "ws": ws_delivered,
        "push": push_result,
        "deduped": False,
    }


def serialize_notification(row: UserNotification) -> dict[str, Any]:
    """通知中心 / WebSocket 事件共用的序列化（字段与前端 NotificationItem 对齐）。"""
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title,
        "body": row.body,
        "route": row.route,
        "route_id": row.route_id,
        "actor_name": row.actor_name,
        "is_read": bool(row.is_read),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# =====================================================================
# 全校广播
# =====================================================================


async def broadcast_notification(
    session: AsyncSession,
    *,
    title: str,
    message: str,
    level: str = "info",
) -> dict[str, Any]:
    """全校广播：写 ``GlobalNotification`` → WS 广播 → APNs 扇出。

    **不写 N 行 UserNotification**：广播的已读状态由
    ``NotificationReadCursor.broadcasts_read_at`` 一个时间戳表达（见 models 注释）。
    """
    row = GlobalNotification(title=title, message=message, level=level, is_active=True)
    session.add(row)
    await session.commit()
    await session.refresh(row)

    ws_delivered = await manager.broadcast(
        {
            "type": "broadcast",
            "broadcast": {
                "id": row.id,
                "title": row.title,
                "message": row.message,
                "level": row.level,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            },
        }
    )

    payload = build_broadcast_payload(
        title=title, message=message, level=level, notification_id=row.id
    )
    targets = await all_push_targets(session)
    push_result = await dispatch_alert(session, targets=targets, payload_for=lambda _t: payload)

    return {"id": row.id, "ws": ws_delivered, "push": push_result, "targets": len(targets)}
