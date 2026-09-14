"""APNs **普通通知**（alert push）payload 契约 —— 唯一来源。

与 ``live_activity_payload.py`` 的关系与区别：

    |              | Live Activity 帧              | 普通通知（本文）              |
    |--------------|-------------------------------|------------------------------|
    | apns-topic   | <bundle>.push-type.liveactivity | <bundle>（主 App topic）    |
    | apns-push-type | liveactivity                | alert                        |
    | 用途          | 锁屏倒计时卡片                 | 系统横幅（微信来消息那种体验）|

⚠️ 三个必须遵守的 APNs 规则（都踩过）：

1. ``apns-topic`` **必须**是主 App 的 Bundle ID；发 Live Activity 用的
   ``…push-type.liveactivity`` 会直接被拒（`TopicDisallowed`）。
2. 通知点击后的路由信息放在**自定义顶层键**（本文用 ``kaznu``），
   iOS 会把它原样塞进 ``userInfo``，原生层读它决定跳到哪个帖子 / 会话。
3. ``thread-id`` 相同的通知在通知中心会被 iOS **自动折叠成一组** ——
   同一会话的消息天然归组（微信体验），所以 chat 用 ``kaznu.chat.<conversation_id>``。
"""
from __future__ import annotations

from typing import Any

from .models import NOTIFICATION_ROUTES

#: 通知归组前缀（通知中心里按会话/帖子折叠）
THREAD_CHAT = "kaznu.chat"
THREAD_SOCIAL = "kaznu.social"
THREAD_SYSTEM = "kaznu.system"

#: 服务器生成文案时需要知道用户语言的三个选项（与 Live Activity 一致）
_LOCALES = ("EN", "KZ", "RU")


def normalize_locale(locale: str | None) -> str:
    """把客户端上报的语言规整成 EN / KZ / RU（未知一律 EN）。"""
    value = (locale or "EN").strip().upper()
    return value if value in _LOCALES else "EN"


def thread_for(route: str, route_id: str | None) -> str:
    """按跳转目标决定通知线程（用于 iOS 通知中心归组）。"""
    if route == "chat":
        return f"{THREAD_CHAT}.{route_id}" if route_id else THREAD_CHAT
    if route in ("post", "news"):
        return THREAD_SOCIAL
    return THREAD_SYSTEM


def build_alert_payload(
    *,
    title: str,
    body: str,
    route: str = "none",
    route_id: str | None = None,
    kind: str = "system",
    notification_id: str | None = None,
    badge: int | None = None,
    thread_id: str | None = None,
    sound: str = "default",
    interruption_level: str | None = "active",
) -> dict[str, Any]:
    """构造一条普通通知的 APNs payload。

    Args:
        route / route_id: 点击横幅后前端要跳到哪里（见 ``NOTIFICATION_ROUTES``）
        badge: App 图标角标数（未读总数）；None = 不动角标
        interruption_level: ``active`` 立即亮屏提示（私信/广播要的就是这个体验），
            ``passive`` 静默投递到通知中心，``time-sensitive`` 可穿透专注模式
    """
    if route not in NOTIFICATION_ROUTES:
        route = "none"

    aps: dict[str, Any] = {
        "alert": {"title": title, "body": body},
        "sound": sound,
        # 让 Notification Service Extension 有机会改内容（本项目暂无扩展，
        # 但保留这个标记不影响投递，且以后加图片预览时不用改契约）
        "mutable-content": 1,
        "thread-id": thread_id or thread_for(route, route_id),
    }
    if badge is not None:
        aps["badge"] = max(0, int(badge))
    if interruption_level:
        aps["interruption-level"] = interruption_level

    return {
        "aps": aps,
        # 自定义顶层键 → 原生 userInfo["kaznu"] → 点击路由
        "kaznu": {
            "route": route,
            "route_id": route_id,
            "kind": kind,
            "notification_id": notification_id,
        },
    }


def build_broadcast_payload(
    *,
    title: str,
    message: str,
    level: str = "info",
    notification_id: str | None = None,
) -> dict[str, Any]:
    """全校广播：走 campus 落地页（App 内顶部 Banner 与通知中心都能看到同一条）。"""
    return build_alert_payload(
        title=title,
        body=message,
        route="campus",
        route_id=notification_id,
        kind="broadcast",
        notification_id=notification_id,
        # 紧急级用 time-sensitive（可穿透专注模式），普通级用 active
        interruption_level="time-sensitive" if level == "danger" else "active",
        thread_id=f"{THREAD_SYSTEM}.broadcast",
    )


# ---------------------------------------------------------------- 文案（三语）

#: 互动通知的文案模板。服务器按**接收者**的语言渲染 —— 所以推送里是成品文案，
#: 客户端不需要再查表（与 Live Activity 的文案策略一致）。
_TEXTS: dict[str, dict[str, str]] = {
    "EN": {
        "like_title": "New like",
        "like_body": "{actor} liked your post",
        "like_body_anon": "Someone liked your post",
        "comment_title": "New comment",
        "comment_body": "{actor} commented: {snippet}",
        "comment_body_anon": "Someone commented: {snippet}",
        "message_title": "New message",
        "message_body": "{actor}: {snippet}",
        "official_title": "Official announcement",
    },
    "KZ": {
        "like_title": "Жаңа лайк",
        "like_body": "{actor} жазбаңызды ұнатты",
        "like_body_anon": "Біреу жазбаңызды ұнатты",
        "comment_title": "Жаңа пікір",
        "comment_body": "{actor} пікір жазды: {snippet}",
        "comment_body_anon": "Біреу пікір жазды: {snippet}",
        "message_title": "Жаңа хабарлама",
        "message_body": "{actor}: {snippet}",
        "official_title": "Ресми хабарлама",
    },
    "RU": {
        "like_title": "Новый лайк",
        "like_body": "{actor} оценил(а) ваш пост",
        "like_body_anon": "Кто-то оценил(а) ваш пост",
        "comment_title": "Новый комментарий",
        "comment_body": "{actor} прокомментировал(а): {snippet}",
        "comment_body_anon": "Кто-то прокомментировал(а): {snippet}",
        "message_title": "Новое сообщение",
        "message_body": "{actor}: {snippet}",
        "official_title": "Официальное объявление",
    },
}


def text(locale: str | None, key: str, **kwargs: Any) -> str:
    """取本地化文案（缺 key 时回退英文；占位符用 ``str.format`` 填充）。"""
    table = _TEXTS.get(normalize_locale(locale), _TEXTS["EN"])
    template = table.get(key) or _TEXTS["EN"].get(key, "")
    try:
        return template.format(**kwargs) if kwargs else template
    except (KeyError, IndexError):
        return template


def snippet(body: str, limit: int = 80) -> str:
    """把消息 / 评论截断成适合通知横幅的一行（去掉换行，避免横幅被撑高）。"""
    flat = " ".join((body or "").split())
    return flat if len(flat) <= limit else f"{flat[: limit - 1]}…"
