"""通知中心 + 全校广播 + 推送设备注册。

三类通知的落库方式（与 ``models`` / ``push`` 的注释一致）：

    | 类型            | 落库位置                          | 已读状态            |
    |-----------------|-----------------------------------|---------------------|
    | 点赞/评论/私信   | user_notifications（每人一行）     | is_read 字段        |
    | 官方公告         | user_notifications（kind=official）| is_read 字段        |
    | 全校广播         | global_notifications（**一行**）   | 读游标时间戳        |

广播不写 N 行：一次广播给 N 个用户写 N 行通知，在真实用户量下既慢又占空间，
而广播的"已读"本质上只是"你看过这之后发的内容了" —— 一个时间戳就能表达。

点击跳转（``route`` / ``route_id``）由服务端在推送里带上，App 端在通知横幅被点击时
读取它做 Navigation（见 ``src/services/NotificationService.ts`` 与原生层约定）。
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..deps import get_current_user, require_staff
from ..models import (
    DeviceToken,
    GlobalNotification,
    NotificationReadCursor,
    User,
    UserNotification,
)
from ..push import broadcast_notification, serialize_notification, unread_badge
from ..routers.chat import unread_message_count
from ..schemas import (
    BroadcastIn,
    BroadcastOut,
    BroadcastResultOut,
    DeviceTokenIn,
    DeviceTokenOut,
    NotificationCenterOut,
    NotificationOut,
    ReadResultOut,
    UnreadCountOut,
)

router = APIRouter(tags=["notifications"])

READ_ALL_MSG = "All notifications marked as read."
DEVICE_SAVED_MSG = "Device registered for push."


def _aware(value: datetime | None) -> datetime | None:
    """SQLite 取回的时间可能是 naive 的 → 统一补 UTC，避免与 aware 时间比较报错。"""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def _broadcasts(session: AsyncSession, user_id: str, limit: int = 20) -> list[BroadcastOut]:
    """最近的全校广播 + 按游标算出各自是否已读。"""
    cursor = await session.get(NotificationReadCursor, user_id)
    since = _aware(cursor.broadcasts_read_at) if cursor else None
    rows = (
        await session.scalars(
            select(GlobalNotification)
            .where(GlobalNotification.is_active.is_(True))
            .order_by(GlobalNotification.created_at.desc())
            .limit(limit)
        )
    ).all()
    result: list[BroadcastOut] = []
    for row in rows:
        created = _aware(row.created_at)
        result.append(
            BroadcastOut(
                id=row.id,
                title=row.title,
                message=row.message,
                level=row.level,
                is_read=bool(since and created and created <= since),
                created_at=row.created_at,
            )
        )
    return result


@router.get("/notifications", response_model=NotificationCenterOut)
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationCenterOut:
    """通知中心：定向通知（分页，最新在前）+ 全校广播 + 未读总数。"""
    total = await session.scalar(
        select(func.count(UserNotification.id)).where(UserNotification.user_id == current.id)
    ) or 0
    rows = (
        await session.scalars(
            select(UserNotification)
            .where(UserNotification.user_id == current.id)
            .order_by(UserNotification.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items = [NotificationOut(**serialize_notification(row)) for row in rows]
    return NotificationCenterOut(
        items=items,
        broadcasts=await _broadcasts(session, current.id),
        total=int(total),
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < int(total),
        unread_count=await unread_badge(session, current.id),
    )


@router.post("/notifications/read", response_model=ReadResultOut)
async def read_all(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReadResultOut:
    """全部标记已读（定向通知刷 is_read + 广播游标推到当前时刻）。"""
    result = await session.execute(
        update(UserNotification)
        .where(UserNotification.user_id == current.id, UserNotification.is_read.is_(False))
        .values(is_read=True)
    )
    marked = result.rowcount or 0

    now = datetime.now(timezone.utc)
    cursor = await session.get(NotificationReadCursor, current.id)
    if cursor is None:
        session.add(NotificationReadCursor(user_id=current.id, broadcasts_read_at=now))
    else:
        cursor.broadcasts_read_at = now
    await session.commit()
    return ReadResultOut(message=READ_ALL_MSG, marked=marked)


@router.post("/notifications/{notification_id}/read", response_model=ReadResultOut)
async def read_one(
    notification_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReadResultOut:
    """标记单条已读（点击通知进入对应页面时调用）。"""
    row = await session.get(UserNotification, notification_id)
    if row is None or row.user_id != current.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not row.is_read:
        row.is_read = True
        await session.commit()
        return ReadResultOut(message="Marked as read.", marked=1)
    return ReadResultOut(message="Already read.", marked=0)


@router.get("/notifications/unread-count", response_model=UnreadCountOut)
async def notifications_unread(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UnreadCountOut:
    """角标数据：私信未读 + 通知未读（二者之和 = App 图标角标）。"""
    messages = await unread_message_count(session, current.id)
    notifications = await unread_badge(session, current.id)
    return UnreadCountOut(messages=messages, notifications=notifications, total=messages + notifications)


# =====================================================================
# 推送设备注册（普通通知用，与 Live Activity 注册分开）
# =====================================================================


@router.post("/notifications/devices", response_model=DeviceTokenOut, status_code=201)
async def register_device(
    payload: DeviceTokenIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeviceTokenOut:
    """登记/更新一台设备的推送 token（同一 user+device 覆盖，不新增行）。

    与 ``POST /live-activity/registration`` 的区别：这里**不关心 Live Activity**，
    只用于普通通知（广播 / 互动 / 私信）。用户关掉灵动岛提醒也能继续收通知。
    """
    row = await session.scalar(
        select(DeviceToken).where(
            DeviceToken.user_id == current.id, DeviceToken.device_id == payload.device_id
        )
    )
    if row is None:
        row = DeviceToken(
            user_id=current.id,
            device_id=payload.device_id,
            token=payload.token,
            platform=payload.platform,
            environment=payload.environment,
            locale=payload.locale,
            alerts_enabled=payload.alerts_enabled,
        )
        session.add(row)
    else:
        row.token = payload.token
        row.platform = payload.platform
        row.environment = payload.environment
        row.locale = payload.locale
        row.alerts_enabled = payload.alerts_enabled
        row.last_seen_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(row)
    return DeviceTokenOut(
        id=row.id,
        device_id=row.device_id,
        platform=row.platform,
        environment=row.environment,
        locale=row.locale,
        alerts_enabled=row.alerts_enabled,
        created_at=row.created_at,
    )


@router.delete("/notifications/devices/{device_id}", response_model=dict)
async def unregister_device(
    device_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """注销设备（用户关掉推送设置、或退出登录时调用）。"""
    row = await session.scalar(
        select(DeviceToken).where(
            DeviceToken.user_id == current.id, DeviceToken.device_id == device_id
        )
    )
    if row is None:
        return {"message": "Device not registered.", "removed": 0}
    await session.delete(row)
    await session.commit()
    return {"message": "Device unregistered.", "removed": 1}


# =====================================================================
# 管理端：全校广播 + 推送自检
# =====================================================================


@router.post("/notifications/broadcast", response_model=BroadcastResultOut)
async def broadcast(
    payload: BroadcastIn,
    _staff: User = Depends(require_staff),
    session: AsyncSession = Depends(get_session),
) -> BroadcastResultOut:
    """**全校广播**（staff）：App 内顶部 Banner + 通知中心 + 系统横幅（APNs）。

    落库、WebSocket、APNs 三条通路都在 ``push.broadcast_notification`` 里完成；
    未配 APNs 凭据时前两条照常工作（在线用户依然实时收到），只是不发系统横幅。
    """
    result = await broadcast_notification(
        session, title=payload.title, message=payload.message, level=payload.level
    )
    return BroadcastResultOut(
        id=result["id"], ws=result["ws"], targets=result["targets"], push=result["push"]
    )


@router.get("/notifications/push-status", response_model=dict)
async def push_status(
    _staff: User = Depends(require_staff),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """推送自检（staff）：APNs 凭据状态 + 已登记设备数 + 通知总量。"""
    from ..apns import apns

    devices = await session.scalar(select(func.count(DeviceToken.id))) or 0
    opted_in = await session.scalar(
        select(func.count(DeviceToken.id)).where(DeviceToken.alerts_enabled.is_(True))
    ) or 0
    notifications = await session.scalar(select(func.count(UserNotification.id))) or 0
    broadcasts = await session.scalar(select(func.count(GlobalNotification.id))) or 0
    return {
        "apns": apns.status(),
        "alert_topic": apns.status()["topic"].replace(".push-type.liveactivity", ""),
        "devices": {"total": int(devices), "alerts_enabled": int(opted_in)},
        "notifications": {"direct": int(notifications), "broadcasts": int(broadcasts)},
    }