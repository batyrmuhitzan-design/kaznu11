"""课前自动拉起 Live Activity 的定时任务。

一轮流程（默认每 60 秒跑一次）：

1. 取出所有"开启提醒 + 有 push-to-start token"的设备注册；
2. 按**该用户所在时区**算出他下一节课的开课时刻；
3. 距开课 ≤ ``LIVE_ACTIVITY_LEAD_SECONDS``（默认 15 分钟）且没推过 → 发 ``event: start``
   （这一步由服务器完成，App 被划掉也照样弹卡片）；
4. 卡片已在跑且已到上课时刻 → 发 ``event: update``（preClass → inClass，倒计时改到下课）；
5. 课程结束 → 发 ``event: end`` 收起卡片；
6. 每步都写 ``LiveActivityPushLog`` 去重，拿到 410/Unregistered 就清掉失效 token。

**纯函数 ``plan_pushes`` 承担全部判定逻辑**，``run_once`` 只做读写与发送 ——
所以单元测试可以喂一个假 ``now`` 精确验证"课前 15 分钟那一刻会推什么"，不用等真实时钟。
"""
from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .apns import apns
from .config import settings
from .database import SessionLocal
from .live_activity_payload import build_end_payload, build_start_payload, build_update_payload
from .models import LiveActivityPushLog, LiveActivityRegistration, LiveActivitySession, UserLesson

#: 一节课最短时长（与 Swift KaznuLesson.duration 的下限一致）
MIN_LESSON_MINUTES = 5


@dataclass(frozen=True)
class RegistrationView:
    """调度所需的注册视图（与 ORM 解耦，便于单测构造）。"""

    user_id: str
    device_id: str
    push_to_start_token: str | None
    timezone: str = "Asia/Almaty"
    locale: str = "EN"
    environment: str = "sandbox"
    alerts_enabled: bool = True


@dataclass(frozen=True)
class SessionView:
    """正在运行的 Activity 视图。"""

    activity_id: str
    user_id: str
    push_token: str
    course_key: str | None
    phase: str
    stage_end: datetime | None
    environment: str = "sandbox"


@dataclass(frozen=True)
class LessonView:
    """课表条目视图。``weekday`` 0 = 周一。"""

    course_key: str
    name: str
    weekday: int
    start_h: int
    start_m: int
    end_h: int
    end_m: int
    short: str | None = None
    room: str | None = None
    teacher: str | None = None

    @property
    def duration_minutes(self) -> int:
        return max(MIN_LESSON_MINUTES, (self.end_h * 60 + self.end_m) - (self.start_h * 60 + self.start_m))


@dataclass(frozen=True)
class PlannedPush:
    """一条待发送的推送（纯数据，无副作用）。"""

    kind: str  # start | update | end
    user_id: str
    device_id: str
    token: str
    environment: str
    locale: str
    #: 去重键（含日期）：`<course_key>@2026-09-14`，避免"下周同一节课"被当成重复
    occurrence_key: str
    course_key: str
    lesson: dict[str, Any] = field(default_factory=dict)
    phase: str = "preClass"
    stage_start: datetime | None = None
    stage_end: datetime | None = None
    activity_id: str | None = None
    reason: str = ""


def zone_of(name: str | None) -> ZoneInfo:
    """时区解析；非法值回退 UTC（绝不因为脏数据让调度器崩掉）。"""
    try:
        return ZoneInfo((name or "").strip() or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def local_now(now: datetime, tz: ZoneInfo) -> datetime:
    return now.astimezone(tz)


def next_occurrence(lesson: LessonView, now: datetime, tz: ZoneInfo) -> datetime:
    """该课程在 ``now`` 之后（含正在进行的）最近一次开课时刻（用户本地时区）。"""
    current = local_now(now, tz)
    days_ahead = (lesson.weekday - current.weekday()) % 7
    candidate = (current + timedelta(days=days_ahead)).replace(
        hour=lesson.start_h, minute=lesson.start_m, second=0, microsecond=0
    )
    if candidate + timedelta(minutes=lesson.duration_minutes) <= current:
        # 今天这一节已经上完了 → 下周同一天
        candidate += timedelta(days=7)
    return candidate


def _lesson_by_key(lessons: list[LessonView], key: str | None) -> LessonView | None:
    if not key:
        return None
    for lesson in lessons:
        if lesson.course_key == key:
            return lesson
    return None


def plan_pushes(
    *,
    now: datetime,
    registrations: list[RegistrationView],
    lessons_by_user: dict[str, list[LessonView]],
    sessions_by_user: dict[str, SessionView],
    pushed_keys: set[tuple[str, str, str]],
    lead_seconds: int | None = None,
) -> list[PlannedPush]:
    """纯函数：算出这一轮该发哪些推送（不碰数据库、不发网络请求）。

    ``pushed_keys`` 是 ``(user_id, occurrence_key, event)`` 集合，来自 PushLog；
    已存在的组合不再重复规划 —— 这就是调度器幂等的核心。
    """
    lead = lead_seconds if lead_seconds is not None else settings.live_activity_lead_seconds
    plans: list[PlannedPush] = []

    for reg in registrations:
        if not reg.alerts_enabled:
            continue
        tz = zone_of(reg.timezone)
        lessons = lessons_by_user.get(reg.user_id) or []
        session = sessions_by_user.get(reg.user_id)

        # ---------- 1) 已有卡片在跑：只可能 update（进课中）或 end ----------
        if session is not None:
            if session.stage_end is None or now < session.stage_end:
                continue  # 阶段还没结束，系统计时器自己走，不用打扰
            occurrence = f"{session.course_key or 'course'}@{session.stage_end.isoformat()}"
            lesson = _lesson_by_key(lessons, session.course_key)
            if session.phase == "preClass":
                class_start = session.stage_end
                duration = lesson.duration_minutes if lesson else 45
                key = (reg.user_id, occurrence, "update")
                if key in pushed_keys:
                    continue
                plans.append(
                    PlannedPush(
                        kind="update",
                        user_id=reg.user_id,
                        device_id=reg.device_id,
                        token=session.push_token,
                        environment=session.environment,
                        locale=reg.locale,
                        occurrence_key=occurrence,
                        course_key=session.course_key or "course",
                        lesson={"name": lesson.name if lesson else "Class", "short": lesson.short if lesson else None},
                        phase="inClass",
                        stage_start=class_start,
                        stage_end=class_start + timedelta(minutes=duration),
                        activity_id=session.activity_id,
                        reason="class started",
                    )
                )
            else:
                key = (reg.user_id, occurrence, "end")
                if key in pushed_keys:
                    continue
                plans.append(
                    PlannedPush(
                        kind="end",
                        user_id=reg.user_id,
                        device_id=reg.device_id,
                        token=session.push_token,
                        environment=session.environment,
                        locale=reg.locale,
                        occurrence_key=occurrence,
                        course_key=session.course_key or "course",
                        lesson={"name": lesson.name if lesson else "Class"},
                        phase=session.phase,
                        stage_end=session.stage_end,
                        activity_id=session.activity_id,
                        reason="class finished",
                    )
                )
            continue

        # ---------- 2) 没有卡片：进入"课前 lead 窗口"就发 start ----------
        if not reg.push_to_start_token or not lessons:
            continue
        best = min(lessons, key=lambda item: next_occurrence(item, now, tz))
        start = next_occurrence(best, now, tz)
        seconds_to_start = (start - local_now(now, tz)).total_seconds()
        if not (0 <= seconds_to_start <= lead):
            continue

        occurrence = f"{best.course_key}@{start.isoformat()}"
        key = (reg.user_id, occurrence, "start")
        if key in pushed_keys:
            continue
        plans.append(
            PlannedPush(
                kind="start",
                user_id=reg.user_id,
                device_id=reg.device_id,
                token=reg.push_to_start_token,
                environment=reg.environment,
                locale=reg.locale,
                occurrence_key=occurrence,
                course_key=best.course_key,
                lesson={
                    "course_key": best.course_key,
                    "name": best.name,
                    "short": best.short,
                    "room": best.room,
                    "teacher": best.teacher,
                },
                phase="preClass",
                stage_start=start - timedelta(seconds=lead),
                stage_end=start,
                reason=f"T-{lead // 60}min",
            )
        )
    return plans


# =====================================================================
# 执行层（读库 → 规划 → 发送 → 记账）
# =====================================================================


def _payload_for(plan: PlannedPush, now: datetime) -> dict[str, Any]:
    """按事件类型构造 APNs payload。"""
    if plan.kind == "start":
        return build_start_payload(
            lesson=plan.lesson,
            phase=plan.phase,
            stage_start=plan.stage_start or now,
            stage_end=plan.stage_end or now,
            now=now,
            locale=plan.locale,
            with_alert=settings.live_activity_alert_on_start,
        )
    if plan.kind == "update":
        short = plan.lesson.get("short") or (plan.lesson.get("name") or "Class")[:2].upper()
        return build_update_payload(
            phase=plan.phase,
            stage_start=plan.stage_start or now,
            stage_end=plan.stage_end or now,
            now=now,
            course_short=short,
            locale=plan.locale,
        )
    return build_end_payload(
        now=now, course_name=plan.lesson.get("name") or "Class", locale=plan.locale
    )


async def run_once(now: datetime | None = None) -> dict[str, Any]:
    """跑一轮调度（定时循环与 ``POST /live-activity/run-scheduler`` 手动触发共用）。"""
    moment = now or datetime.now(timezone.utc)
    summary: dict[str, Any] = {
        "at": moment.isoformat(),
        "planned": 0,
        "sent": 0,
        "failed": 0,
        "skipped": None,
        "details": [],
    }
    if not settings.live_activity_push_enabled:
        summary["skipped"] = "LIVE_ACTIVITY_PUSH_ENABLED=false"
        return summary
    if not apns.configured:
        summary["skipped"] = "APNs 凭据未配置（见 GET /api/v1/live-activity/apns-status）"
        return summary

    async with SessionLocal() as session:
        regs = list(await session.scalars(select(LiveActivityRegistration)))
        lessons = list(await session.scalars(select(UserLesson)))
        open_sessions = list(
            await session.scalars(
                select(LiveActivitySession).where(LiveActivitySession.ended_at.is_(None))
            )
        )
        logs = list(await session.scalars(select(LiveActivityPushLog)))

    lessons_by_user: dict[str, list[LessonView]] = {}
    for row in lessons:
        lessons_by_user.setdefault(row.user_id, []).append(
            LessonView(
                course_key=row.course_key,
                name=row.name,
                weekday=row.weekday,
                start_h=row.start_h,
                start_m=row.start_m,
                end_h=row.end_h,
                end_m=row.end_m,
                short=row.short,
                room=row.room,
                teacher=row.teacher,
            )
        )

    plans = plan_pushes(
        now=moment,
        registrations=[
            RegistrationView(
                user_id=r.user_id,
                device_id=r.device_id,
                push_to_start_token=r.push_to_start_token,
                timezone=r.timezone,
                locale=r.locale,
                environment=r.apns_environment,
                alerts_enabled=r.alerts_enabled,
            )
            for r in regs
        ],
        lessons_by_user=lessons_by_user,
        sessions_by_user={
            s.user_id: SessionView(
                activity_id=s.activity_id,
                user_id=s.user_id,
                push_token=s.push_token,
                course_key=s.course_key,
                phase=s.phase,
                stage_end=s.stage_end,
                environment=s.apns_environment,
            )
            for s in open_sessions
        },
        pushed_keys={(row.user_id, row.course_key, row.event) for row in logs},
    )
    summary["planned"] = len(plans)

    for plan in plans:
        result = await apns.send_live_activity(
            token=plan.token,
            payload=_payload_for(plan, moment),
            event=plan.kind,
            environment=plan.environment,
            collapse_id=f"kaznu-{plan.course_key}",
        )
        if result.ok:
            summary["sent"] += 1
        else:
            summary["failed"] += 1
        summary["details"].append(
            {
                "kind": plan.kind,
                "course": plan.lesson.get("name"),
                "reason": plan.reason,
                "ok": result.ok,
                "status": result.status,
                "error": result.reason,
            }
        )
        await _record_plan(plan, result, moment)
    return summary


async def _record_plan(plan: PlannedPush, result: Any, moment: datetime) -> None:
    """写去重日志，并按结果推进会话状态 / 清理失效 token（单事务）。"""
    async with SessionLocal() as session:
        session.add(
            LiveActivityPushLog(
                user_id=plan.user_id,
                course_key=plan.occurrence_key,
                event=plan.kind,
                apns_status=result.status,
                detail=(result.reason or result.detail or "")[:300] or None,
            )
        )

        if result.token_invalid:
            # start 的 push-to-start token 失效 → 清掉，等 App 下次启动重新上报
            if plan.kind == "start":
                rows = await session.scalars(
                    select(LiveActivityRegistration).where(
                        LiveActivityRegistration.user_id == plan.user_id,
                        LiveActivityRegistration.device_id == plan.device_id,
                    )
                )
                for row in rows:
                    row.push_to_start_token = None
            elif plan.activity_id:
                row = await session.scalar(
                    select(LiveActivitySession).where(
                        LiveActivitySession.activity_id == plan.activity_id
                    )
                )
                if row is not None:
                    row.ended_at = moment
        elif result.ok and plan.activity_id:
            row = await session.scalar(
                select(LiveActivitySession).where(
                    LiveActivitySession.activity_id == plan.activity_id
                )
            )
            if row is not None:
                if plan.kind == "update":
                    row.phase = plan.phase
                    row.stage_end = plan.stage_end
                elif plan.kind == "end":
                    row.ended_at = moment

        try:
            await session.commit()
        except Exception:
            # 唯一约束冲突（并发/重试）不算错：说明这一条已经推过了
            await session.rollback()


class LiveActivityScheduler:
    """进程内定时循环。

    单 uvicorn worker 部署下完全够用；如果以后横向扩到多 worker，
    应改成外部 cron 调用 ``run_once()``（否则每个 worker 都会跑一遍）。
    """

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self.last_result: dict[str, Any] | None = None
        self.rounds = 0

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> bool:
        """启动循环；返回是否真的启动（已运行 / 功能关闭时返回 False）。"""
        if self.running:
            return False
        if not settings.live_activity_push_enabled:
            return False
        self._task = asyncio.create_task(self._loop(), name="kaznu-live-activity-scheduler")
        return True

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        # ⚠️ 必须把 CancelledError 一起吞掉：Python 3.8 起它继承 **BaseException**
        #    而不是 Exception，`except Exception` 拦不住 → 会在 lifespan 关闭时冒出
        #    "ERROR: Application shutdown failed. Exiting."（线上踩过）。
        #    这类异常只在关停时出现，不影响业务，但会让日志变脏、systemd 看到非干净退出。
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

    async def _loop(self) -> None:
        tick = max(15, settings.live_activity_tick_seconds)
        while True:
            try:
                self.last_result = await run_once()
                self.rounds += 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - 循环必须活着
                print(f"[kaznu] ⚠️ Live Activity 调度轮次失败: {type(exc).__name__}: {exc}")
            await asyncio.sleep(tick)


#: 进程内单例（main.py 的 lifespan 里 start / stop）
scheduler = LiveActivityScheduler()
