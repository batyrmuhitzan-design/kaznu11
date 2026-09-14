"""Live Activity 的 APNs 推送契约（payload 构造）。

⚠️ 这个文件是**契约的唯一来源**，另一侧是 Swift 的
``KaznuCourseAttributes.ContentState``（ios/App/App/KaznuCourseAttributes.swift）。
两边字段名/类型必须逐一对齐，`backend/tests/check_live_activity_contract.py` 会自动比对。

三个最容易踩的坑，都在这里处理掉：

1. **Date 的编码基准是 2001-01-01**，不是 Unix epoch。
   ActivityKit 用默认的 ``JSONDecoder``（``.deferredToDate``）解 ``content-state``，
   而 Swift 的 ``Date`` 编码成「距 2001-01-01 00:00:00 UTC 的秒数」。
   服务端若按 Unix 时间戳发，锁屏计时器会显示到 1970 年附近（差约 9.78 亿秒）。
   → 统一走 ``apple_reference_seconds()``。

2. **``event: "start"`` 必须带 ``attributes-type`` 与 ``attributes``**。
   静态属性服务器侧本来不可见，缺这两个键 iOS 会静默丢弃整条推送。

3. **``stale-date`` 只负责「内容过期后的样式」**，倒计时本身靠
   ``Text(timerInterval:)`` / ``ProgressView(timerInterval:)`` 由系统逐秒自走。
   所以千万别为了秒级刷新高频推送 —— 一条推送就够跑完整个倒计时。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

#: APNs 允许的 event 取值
APNS_EVENTS = ("start", "update", "end")

#: Swift 侧 ``KaznuCourseAttributes`` 的类型名（start 事件必须原样带上）
ATTRIBUTES_TYPE = "KaznuCourseAttributes"

#: Apple 的 Date 参考时刻（2001-01-01T00:00:00Z）
APPLE_REFERENCE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)

#: 活动结束后卡片再保留多久（dismissal-date），期间用户仍能看到「已结束」
DISMISSAL_GRACE_SECONDS = 10 * 60

#: 展开视图里的跳转按钮（与 App 的 URL Scheme 一致）
NAVIGATION_URL = "kaznuhelper://schedule"


def apple_reference_seconds(when: datetime) -> float:
    """把 datetime 转成 Swift ``Date`` 的 JSON 表示（距 2001-01-01 的秒数）。"""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (when.astimezone(timezone.utc) - APPLE_REFERENCE_EPOCH).total_seconds()


# --------------------------------------------------------------------- 文案
#
# 推送路径上 App 可能根本没运行，所以文案必须由服务器生成。
# 用注册信息里的 locale 选语言（EN / KZ / RU），与 App 内三语保持一致。

_LABELS: dict[str, dict[str, str]] = {
    "EN": {
        "startsIn": "Starts in {m} min",
        "endsIn": "Class ends in {m} min",
        "startingNow": "Starting now",
        "endingNow": "Ending now",
        "alertStart": "Starts in {m} min · {room}",
        "alertEnd": "Class finished",
    },
    "KZ": {
        "startsIn": "{m} мин соң басталады",
        "endsIn": "Сабақ {m} мин соң бітеді",
        "startingNow": "Қазір басталады",
        "endingNow": "Қазір бітеді",
        "alertStart": "{m} мин соң басталады · {room}",
        "alertEnd": "Сабақ аяқталды",
    },
    "RU": {
        "startsIn": "Начнётся через {m} мин",
        "endsIn": "Занятие закончится через {m} мин",
        "startingNow": "Начинается сейчас",
        "endingNow": "Заканчивается сейчас",
        "alertStart": "Через {m} мин · {room}",
        "alertEnd": "Занятие закончилось",
    },
}


def label(locale: str | None, key: str, **values: Any) -> str:
    """取某语言的文案；未知语言回退英文。"""
    table = _LABELS.get((locale or "EN").upper(), _LABELS["EN"])
    template = table.get(key) or _LABELS["EN"].get(key, key)
    return template.format(**values) if values else template


def status_label(locale: str | None, phase: str, remaining_seconds: float) -> str:
    """副标题：与 Swift ``KaznuCourseMetric.statusText`` 的语义一致。"""
    minutes = int(-(-max(0.0, remaining_seconds) // 60))  # 向上取整
    if phase == "inClass":
        return label(locale, "endingNow" if minutes <= 0 else "endsIn", m=minutes)
    return label(locale, "startingNow" if minutes <= 0 else "startsIn", m=minutes)


def build_content_state(
    *,
    phase: str,
    stage_start: datetime,
    stage_end: datetime,
    now: datetime,
    course_short: str,
    locale: str | None = None,
) -> dict[str, Any]:
    """构造 ``content-state``（= Swift ``ContentState`` 的 JSON 表示）。

    Args:
        phase: ``preClass`` 课前倒计时 / ``inClass`` 课中倒计时
        stage_start / stage_end: 当前阶段起止时刻（**阶段内固定**，供系统计时器自走）
        now: 本次推送的时刻
        course_short: 灵动岛紧凑区缩写
    """
    total = max(0.0, (stage_end - stage_start).total_seconds())
    remaining = max(0.0, (stage_end - now).total_seconds())
    progress = min(1.0, max(0.0, remaining / total)) if total > 0 else 0.0
    return {
        "remainingSeconds": round(remaining, 3),
        "totalSeconds": round(total, 3),
        "phase": phase,
        "progress": round(progress, 4),
        "stageStart": apple_reference_seconds(stage_start),
        "stageEnd": apple_reference_seconds(stage_end),
        "courseShort": course_short,
        "statusLabel": status_label(locale, phase, remaining),
        "navigationLabel": course_short,
        "navigationURL": NAVIGATION_URL,
        # push = 服务器推送产生（App 没运行时也算），便于在后台/卡片上一眼分辨
        "source": "push",
        "updatedAt": apple_reference_seconds(now),
    }


def build_attributes(*, course_key: str, course_name: str, room: str, teacher: str) -> dict[str, Any]:
    """``attributes``：与 Swift ``KaznuCourseAttributes`` 的静态属性同名同序。"""
    return {
        "courseId": course_key,
        "courseName": course_name,
        "roomNumber": room,
        "teacherName": teacher,
    }


def _aps(
    *,
    event: str,
    content_state: dict[str, Any],
    now: datetime,
    stale_date: datetime,
    dismissal_date: datetime | None = None,
    attributes: dict[str, Any] | None = None,
    alert: dict[str, str] | None = None,
) -> dict[str, Any]:
    aps: dict[str, Any] = {
        "timestamp": int(now.timestamp()),
        "event": event,
        "content-state": content_state,
        # 内容过期时刻：到点后 Widget 进入 isStale（变灰），但不影响系统计时器继续走
        "stale-date": int(stale_date.timestamp()),
        "relevance-score": 100,
    }
    if dismissal_date is not None:
        aps["dismissal-date"] = int(dismissal_date.timestamp())
    if attributes is not None:
        # start 事件**必须**带类型名与静态属性，否则 iOS 丢弃整条推送
        aps["attributes-type"] = ATTRIBUTES_TYPE
        aps["attributes"] = attributes
    if alert:
        aps["alert"] = alert
        aps["sound"] = "default"
    return {"aps": aps}


def build_start_payload(
    *,
    lesson: dict[str, Any],
    phase: str,
    stage_start: datetime,
    stage_end: datetime,
    now: datetime,
    locale: str | None = None,
    with_alert: bool = True,
) -> dict[str, Any]:
    """``event: start`` —— 用 push-to-start token 发送，App 未运行也能拉起卡片。"""
    content_state = build_content_state(
        phase=phase,
        stage_start=stage_start,
        stage_end=stage_end,
        now=now,
        course_short=lesson.get("short") or (lesson["name"][:2].upper()),
        locale=locale,
    )
    alert = None
    if with_alert:
        minutes = int(-(-max(0.0, (stage_end - now).total_seconds()) // 60))
        room = lesson.get("room") or ""
        body = label(locale, "alertStart", m=minutes, room=room)
        alert = {"title": lesson["name"], "body": body.replace(" ·", "").strip()}
    return _aps(
        event="start",
        content_state=content_state,
        now=now,
        stale_date=stage_end,
        dismissal_date=stage_end + timedelta(seconds=DISMISSAL_GRACE_SECONDS),
        attributes=build_attributes(
            course_key=lesson.get("course_key") or lesson.get("id") or "course",
            course_name=lesson["name"],
            room=lesson.get("room") or "",
            teacher=lesson.get("teacher") or "",
        ),
        alert=alert,
    )


def build_update_payload(
    *,
    phase: str,
    stage_start: datetime,
    stage_end: datetime,
    now: datetime,
    course_short: str,
    locale: str | None = None,
) -> dict[str, Any]:
    """``event: update`` —— 用某个 Activity 的 push token 更新那张卡片（如课前→课中）。"""
    return _aps(
        event="update",
        content_state=build_content_state(
            phase=phase,
            stage_start=stage_start,
            stage_end=stage_end,
            now=now,
            course_short=course_short,
            locale=locale,
        ),
        now=now,
        stale_date=stage_end,
        dismissal_date=stage_end + timedelta(seconds=DISMISSAL_GRACE_SECONDS),
    )


def build_end_payload(
    *,
    now: datetime,
    course_name: str,
    locale: str | None = None,
    with_alert: bool = False,
) -> dict[str, Any]:
    """``event: end`` —— 收起卡片（dismissal-date = 现在，立即移除）。"""
    aps: dict[str, Any] = {
        "timestamp": int(now.timestamp()),
        "event": "end",
        "dismissal-date": int(now.timestamp()),
    }
    if with_alert:
        aps["alert"] = {"title": course_name, "body": label(locale, "alertEnd")}
        aps["sound"] = "default"
    return {"aps": aps}
