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
import secrets
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
from .push_payload import THREAD_SYSTEM, build_alert_payload, build_broadcast_payload, snippet
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


def _delivery_id(row_id: str, at: datetime) -> str:
    """每次投递的**唯一**标识（客户端按它去重，决定是否再次弹窗/响铃）。

    ⚠️ 不能用秒级时间戳：管理员连点两次「📣 Push now」、或"建广播后立刻推送"
    都会落在**同一秒**，于是两次拿到同一个 id，客户端直接去重 → 用户只觉得"点了没反应"。
    这里用微秒 + 3 字节随机后缀，保证任何情况下两次投递都不会撞。
    """
    return f"{row_id}:{int(at.timestamp() * 1_000_000)}-{secrets.token_hex(3)}"


async def _deliver_broadcast(
    session: AsyncSession, row: GlobalNotification, *, delivery_id: str
) -> dict[str, Any]:
    """把一条广播**真正投递出去**：WS 实时帧 + APNs 扇出。

    ``delivery_id`` 是每次投递的唯一标识：客户端用它做横幅/系统通知去重。
    用 ``row.id`` 会在"先轮询看到、再点 Push now"时被去重掉（不再响铃），
    所以每次显式投递都要生成新的（见 ``_delivery_id``）。
    """
    ws_delivered = await manager.broadcast(
        {
            "type": "broadcast",
            "broadcast": {
                "id": row.id,
                "delivery_id": delivery_id,
                "title": row.title,
                "message": row.message,
                "level": row.level,
                "pushed_at": row.pushed_at.isoformat() if row.pushed_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            },
        }
    )

    payload = build_broadcast_payload(
        title=row.title, message=row.message, level=row.level, notification_id=row.id
    )
    targets = await all_push_targets(session)
    push_result = await dispatch_alert(session, targets=targets, payload_for=lambda _t: payload)
    return {"ws": ws_delivered, "push": push_result, "targets": len(targets)}


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
    now = datetime.now(timezone.utc)
    row = GlobalNotification(
        title=title, message=message, level=level, is_active=True, pushed_at=now
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    # API 建的广播天生就是"已推送"，delivery_id 带时间戳 → 客户端一定视为新的一条
    delivered = await _deliver_broadcast(
        session, row, delivery_id=_delivery_id(row.id, now)
    )
    return {"id": row.id, **delivered}


async def push_existing_notification(
    session: AsyncSession, row: GlobalNotification
) -> dict[str, Any]:
    """把**已存在**的通知重新推送一次（管理端「📣 Push now」）。

    与 ``broadcast_notification`` 的区别：不新建行，只更新 ``pushed_at`` 并重新投递。
    每次调用都会拿到新的 delivery_id，所以**重复推送会再次响铃/弹窗** ——
    这正是管理员的预期（"我按了推送键，用户就该收到提示"）。
    """
    now = datetime.now(timezone.utc)
    row.is_active = True
    row.pushed_at = now
    await session.commit()
    await session.refresh(row)
    delivered = await _deliver_broadcast(
        session, row, delivery_id=_delivery_id(row.id, now)
    )
    return {"id": row.id, "pushed_at": row.pushed_at.isoformat(), **delivered}


# =====================================================================
# 「有新内容」全量通告（新官方新闻 / 新社团活动）
# =====================================================================


async def announce_content(
    session: AsyncSession,
    *,
    title: str,
    body: str,
    route: str,
    route_id: str | None,
    kind: str,
    ws_event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """把"新内容上线"通知**全量设备**（含 App 已被杀掉的那些）。

    与 ``broadcast_notification`` 的区别（两者不能混用）：

    |                | 全校广播（broadcast）        | 内容通告（本文）            |
    |----------------|------------------------------|------------------------------|
    | 数据源          | 写 ``GlobalNotification`` 行 | **不写表**，内容本身才是载体 |
    | App 内表现      | 顶部紧急通知栏（可关闭）      | 通知中心 / Campus 里已有该条  |
    | 典型场景        | 停水停电 / 考试周提醒         | 新官方公告 / 新社团活动       |

    不写 ``GlobalNotification`` 是刻意的：新闻和活动**自己就是内容实体**，
    再往紧急通知栏塞一条"有新新闻"会让紧急栏失去"紧急"的含义。

    为什么需要它在服务端存在（而不是等 App 自己发现）
    ------------------------------------------------
    App 被用户划掉后**没有任何后台执行权**（iOS 限制），不可能自己轮询到新内容。
    唯一能让"新新闻 / 新活动"像课前提醒那样弹在锁屏和灵动岛的途径，
    就是服务端在他创建/审核通过的那一刻发 APNs alert 推给全量设备。
    未配 APNs 凭据时这里会如实返回 ``push.targets=0``（不抛异常、不影响写入）。
    """
    payload = build_alert_payload(
        title=title,
        body=body,
        route=route,
        route_id=route_id,
        kind=kind,
        thread_id=f"{THREAD_SYSTEM}.content",
    )
    ws_delivered = await manager.broadcast(
        ws_event
        or {
            "type": "content",
            "content": {"kind": kind, "title": title, "body": body, "route": route, "route_id": route_id},
        }
    )
    targets = await all_push_targets(session)
    push_result = await dispatch_alert(session, targets=targets, payload_for=lambda _t: payload)
    return {"ws": ws_delivered, "push": push_result, "targets": len(targets)}


async def announce_official_post(session: AsyncSession, *, post: Any) -> dict[str, Any]:
    """新官方公告（``Post.is_official``）→ 全量通告，点击进入该帖。"""
    return await announce_content(
        session,
        title=(post.official_badge or "KazNU Official"),
        body=snippet(post.content, 120),
        route="post",
        route_id=post.id,
        kind="official",
    )


async def announce_club_event(session: AsyncSession, *, event: Any) -> dict[str, Any]:
    """新社团活动（审核通过）→ 全量通告，点击进 Campus 活动区。"""
    return await announce_content(
        session,
        title=f"{event.club_name} · {event.title}",
        body=snippet(event.description or event.location or "New club event", 120),
        route="campus",
        route_id=event.id,
        kind="club",
    )
