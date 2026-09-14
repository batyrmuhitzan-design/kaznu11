"""Live Activity 推送注册 + 服务器侧课表 + 调度自检。

端点一览（全部在 ``/api/v1`` 前缀下）：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | ``/live-activity/registration`` | App 上报 device token / **push-to-start token** |
| POST | ``/live-activity/session`` | App 上报某个 Activity 的 push token（用于 update / end） |
| DELETE | ``/live-activity/session/{activity_id}`` | Activity 已结束，注销该 token |
| POST | ``/lessons/sync`` | 整表同步课表（调度器据此算"课前 15 分钟"） |
| GET | ``/live-activity/status`` | App 自检：我的注册 / 在跑的卡片 / APNs 服务端状态 |
| POST | ``/live-activity/test-push`` | **立刻**给自己发一条演示 start 推送（验证全链路，不用等上课） |
| GET | ``/live-activity/apns-status`` | 运维自检（staff） |
| POST | ``/live-activity/run-scheduler`` | 手动跑一轮调度（staff） |
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..apns import apns
from ..config import settings
from ..database import get_session
from ..deps import get_current_user, limiter, require_staff
from ..live_activity_payload import (
    DISMISSAL_GRACE_SECONDS,
    build_start_payload,
)
from ..live_activity_scheduler import run_once, scheduler
from ..models import (
    LiveActivityRegistration,
    LiveActivitySession,
    User,
    UserLesson,
)
from ..schemas import (
    LessonsSyncIn,
    LessonsSyncOut,
    LiveActivityRegistrationIn,
    LiveActivityRegistrationOut,
    LiveActivitySessionIn,
    LiveActivitySessionOut,
    LiveActivityStatusOut,
    SchedulerRunOut,
)

router = APIRouter(tags=["live-activity"])


def _registration_out(row: LiveActivityRegistration) -> LiveActivityRegistrationOut:
    return LiveActivityRegistrationOut(
        device_id=row.device_id,
        has_device_token=bool(row.device_token),
        has_push_to_start_token=bool(row.push_to_start_token),
        environment=row.apns_environment,
        timezone=row.timezone,
        locale=row.locale,
        alerts_enabled=row.alerts_enabled,
        updated_at=row.last_seen_at,
    )


def _session_out(row: LiveActivitySession) -> LiveActivitySessionOut:
    return LiveActivitySessionOut(
        activity_id=row.activity_id,
        course_key=row.course_key,
        phase=row.phase,
        stage_end=row.stage_end,
        environment=row.apns_environment,
        started_by=row.started_by,
        started_at=row.started_at,
        ended_at=row.ended_at,
    )


@router.post("/live-activity/registration", response_model=LiveActivityRegistrationOut)
async def register_live_activity_push(
    payload: LiveActivityRegistrationIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LiveActivityRegistrationOut:
    """登记 / 更新本机的推送 token。

    token 会变（重装、恢复备份、系统刷新），所以 App 每次拿到新 token
    都应该调一次；这里按 ``(user_id, device_id)`` 覆盖写。
    """
    row = await session.scalar(
        select(LiveActivityRegistration).where(
            LiveActivityRegistration.user_id == current.id,
            LiveActivityRegistration.device_id == payload.device_id,
        )
    )
    now = datetime.now(timezone.utc)
    if row is None:
        row = LiveActivityRegistration(user_id=current.id, device_id=payload.device_id)
        session.add(row)

    # 只覆盖"这次带了值"的字段：App 可能先上报 device token，稍后才拿到 push-to-start token
    if payload.device_token is not None:
        row.device_token = payload.device_token.strip() or None
    if payload.push_to_start_token is not None:
        row.push_to_start_token = payload.push_to_start_token.strip() or None
    row.apns_environment = payload.environment
    row.timezone = payload.timezone
    row.locale = payload.locale
    row.alerts_enabled = payload.alerts_enabled
    row.last_seen_at = now

    await session.commit()
    await session.refresh(row)
    return _registration_out(row)


@router.post("/live-activity/session", response_model=LiveActivitySessionOut)
async def register_live_activity_session(
    payload: LiveActivitySessionIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LiveActivitySessionOut:
    """登记一条正在运行的 Live Activity（拿到它的 push token 才能远程 update/end）。"""
    now = datetime.now(timezone.utc)
    row = await session.scalar(
        select(LiveActivitySession).where(
            LiveActivitySession.activity_id == payload.activity_id
        )
    )
    if row is None:
        row = LiveActivitySession(
            activity_id=payload.activity_id,
            user_id=current.id,
            push_token=payload.push_token,
        )
        session.add(row)
    elif row.user_id != current.id:
        # 别人的 activity_id 不该被覆盖
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Activity belongs to another user")

    row.push_token = payload.push_token
    row.course_key = payload.course_key
    row.phase = payload.phase
    row.stage_end = payload.stage_end
    row.apns_environment = payload.environment
    row.started_by = payload.started_by
    row.updated_at = now
    row.ended_at = None

    await session.commit()
    await session.refresh(row)
    return _session_out(row)


@router.delete("/live-activity/session/{activity_id}", response_model=dict)
async def unregister_live_activity_session(
    activity_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Activity 结束 → 注销，避免调度器继续往失效 token 发推送。"""
    row = await session.scalar(
        select(LiveActivitySession).where(
            LiveActivitySession.activity_id == activity_id,
            LiveActivitySession.user_id == current.id,
        )
    )
    if row is None:
        return {"message": "session not found", "activity_id": activity_id}
    row.ended_at = datetime.now(timezone.utc)
    await session.commit()
    return {"message": "session closed", "activity_id": activity_id}


@router.post("/lessons/sync", response_model=LessonsSyncOut)
async def sync_lessons(
    payload: LessonsSyncIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LessonsSyncOut:
    """整表同步课表（先删后插）。

    服务器必须有自己的课表副本，才能在 App 完全不运行时算准"课前 15 分钟"。
    """
    await session.execute(delete(UserLesson).where(UserLesson.user_id == current.id))
    for item in payload.lessons:
        session.add(
            UserLesson(
                user_id=current.id,
                course_key=item.course_key,
                name=item.name,
                short=item.short,
                room=item.room,
                teacher=item.teacher,
                weekday=item.weekday,
                start_h=item.start_h,
                start_m=item.start_m,
                end_h=item.end_h,
                end_m=item.end_m,
            )
        )
    # 课表同步的同一份开关也更新到推送注册上（用户关了提醒就不再推）
    rows = await session.scalars(
        select(LiveActivityRegistration).where(LiveActivityRegistration.user_id == current.id)
    )
    for row in rows:
        row.alerts_enabled = payload.alerts_enabled
    await session.commit()
    return LessonsSyncOut(
        message="Timetable synced",
        count=len(payload.lessons),
        alerts_enabled=payload.alerts_enabled,
    )


@router.get("/live-activity/status", response_model=LiveActivityStatusOut)
async def live_activity_status(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LiveActivityStatusOut:
    """App 自检：我的推送注册 / 在跑的卡片 / 服务器侧 APNs 是否就绪。"""
    regs = list(
        await session.scalars(
            select(LiveActivityRegistration).where(LiveActivityRegistration.user_id == current.id)
        )
    )
    sessions = list(
        await session.scalars(
            select(LiveActivitySession)
            .where(LiveActivitySession.user_id == current.id, LiveActivitySession.ended_at.is_(None))
            .order_by(LiveActivitySession.started_at.desc())
        )
    )
    lesson_count = len(
        list(await session.scalars(select(UserLesson).where(UserLesson.user_id == current.id)))
    )
    return LiveActivityStatusOut(
        registrations=[_registration_out(r) for r in regs],
        sessions=[_session_out(s) for s in sessions],
        lesson_count=lesson_count,
        lead_seconds=settings.live_activity_lead_seconds,
        apns=apns.status(),
    )


@router.post("/live-activity/test-push", response_model=dict)
@limiter.limit("6/minute")
async def send_test_push(
    request: Request,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """**立刻**给自己发一条演示用 start 推送。

    用途：不用等到上课、也不用等 15 分钟窗口，就能验证
    「服务器 → APNs → 锁屏/灵动岛」整条链路是否打通。
    推送内容是一个 15 分钟的假课程（Test Push）。
    """
    row = await session.scalar(
        select(LiveActivityRegistration)
        .where(
            LiveActivityRegistration.user_id == current.id,
            LiveActivityRegistration.push_to_start_token.is_not(None),
        )
        .order_by(LiveActivityRegistration.last_seen_at.desc())
    )
    if row is None or not row.push_to_start_token:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="尚未收到 push-to-start token：请先在真机打开 App（iOS 17.2+ 并开启推送权限）",
        )

    now = datetime.now(timezone.utc)
    lead = timedelta(seconds=settings.live_activity_lead_seconds)
    payload = build_start_payload(
        lesson={
            "course_key": "test-push",
            "name": "Test Push",
            "short": "TEST",
            "room": "FIT 401",
            "teacher": "KazNU Helper",
        },
        phase="preClass",
        stage_start=now,
        stage_end=now + lead,
        now=now,
        locale=row.locale,
        with_alert=settings.live_activity_alert_on_start,
    )
    result = await apns.send_live_activity(
        token=row.push_to_start_token,
        payload=payload,
        event="start",
        environment=row.apns_environment,
        collapse_id="kaznu-test-push",
    )
    return {
        "ok": result.ok,
        "status": result.status,
        "reason": result.reason,
        "detail": result.detail,
        "environment": row.apns_environment,
        "dismissal_after_seconds": int(lead.total_seconds()) + DISMISSAL_GRACE_SECONDS,
        "payload": payload,
    }


@router.get("/live-activity/apns-status", response_model=dict)
async def apns_status(_staff: User = Depends(require_staff)) -> dict:
    """APNs 服务端自检（staff）：凭据是否配置、topic、环境、提前量、调度器状态。"""
    return {
        "apns": apns.status(),
        "scheduler": {
            "running": scheduler.running,
            "rounds": scheduler.rounds,
            "last_result": scheduler.last_result,
        },
        "note": (
            "configured=false 时推送会被跳过（后端不会崩），"
            "App 端本地触发逻辑仍然有效。"
        ),
    }


@router.post("/live-activity/run-scheduler", response_model=SchedulerRunOut)
async def run_scheduler_now(_staff: User = Depends(require_staff)) -> SchedulerRunOut:
    """手动跑一轮调度（staff）。调试"课前 15 分钟"逻辑时不必真的等时间。"""
    summary = await run_once()
    return SchedulerRunOut(**summary)
