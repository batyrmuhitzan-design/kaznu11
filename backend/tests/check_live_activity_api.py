# -*- coding: utf-8 -*-
"""Live Activity 远程推送自检 —— 注册 / 课表同步 / 调度判定 / payload 契约。

    python backend/tests/check_live_activity_api.py

无需 Postgres、无需 APNs 凭据（未配凭据时推送会优雅跳过，这正是要断言的行为之一）。

断言内容：
  1) OpenAPI 出现全部新端点
  2) 课表整表同步 + 回读
  3) 推送注册（device token / push-to-start token）写入与状态回显
  4) Activity push token 登记 / 注销
  5) test-push / run-scheduler：**未配 APNs 凭据时优雅降级**（ok=false + 明确原因，不 500）
  6) 调度器纯函数：课前 15 分钟窗口命中、窗口外不推、重复不推（幂等）、
     进课中 update、下课 end、时区换算
  7) payload：start 必带 attributes-type/attributes；Date 用 2001 参考基准（不是 Unix）
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_db_file = Path(tempfile.gettempdir()) / "kaznu_check_live_activity.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-live-activity-secret"
# 不配置 APNs 凭据 → 走"优雅降级"分支（真实推送需要付费账号 + .p8，见 README）
os.environ.pop("APNS_KEY_ID", None)
os.environ.pop("APNS_KEY_PATH", None)
os.environ["LIVE_ACTIVITY_LEAD_SECONDS"] = "900"

import httpx  # noqa: E402

import main as entrypoint  # noqa: E402

from app.bootstrap import ensure_super_admin  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.live_activity_payload import (  # noqa: E402
    APPLE_REFERENCE_EPOCH,
    apple_reference_seconds,
    build_start_payload,
    build_update_payload,
)
from app.live_activity_scheduler import (  # noqa: E402
    LessonView,
    RegistrationView,
    SessionView,
    next_occurrence,
    plan_pushes,
)
from app.seed import seed_campus_if_empty, seed_if_empty  # noqa: E402

USERNAME = os.environ["SUPER_ADMIN_USERNAME"]
PASSWORD = os.environ["SUPER_ADMIN_PASSWORD"]

EXPECTED_PATHS = [
    "/api/v1/live-activity/registration",
    "/api/v1/live-activity/session",
    "/api/v1/live-activity/session/{activity_id}",
    "/api/v1/live-activity/status",
    "/api/v1/live-activity/test-push",
    "/api/v1/live-activity/apns-status",
    "/api/v1/live-activity/run-scheduler",
    "/api/v1/lessons/sync",
]

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def note(msg: str) -> None:
    notes.append(f"       {msg}")


async def _prepare_db(app) -> None:
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
        admin_user = await ensure_super_admin(session)
        await seed_campus_if_empty(session, admin_user)
    app.state.db_ready = True


LESSONS = [
    {
        "course_key": "cs201-mon-9",
        "name": "Data Structures",
        "short": "DS",
        "room": "305",
        "teacher": "Seitkali",
        "weekday": 0,
        "start_h": 9,
        "start_m": 0,
        "end_h": 10,
        "end_m": 30,
    }
]


async def _run() -> None:
    app = entrypoint.app
    await _prepare_db(app)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # ---- 1) 路由登记 ----
        schema = (await client.get("/openapi.json")).json()
        paths = schema.get("paths", {})
        missing = [p for p in EXPECTED_PATHS if p not in paths]
        if missing:
            bad("OpenAPI 缺少：" + ", ".join(missing))
        else:
            ok(f"/openapi.json 含全部 {len(EXPECTED_PATHS)} 个 Live Activity 端点")

        # ---- 2) 鉴权门槛 ----
        if (
            await client.post("/api/v1/live-activity/registration", json={"device_id": "dev-0001"})
        ).status_code == 401:
            ok("未登录上报推送注册 → 401")
        else:
            bad("未登录上报推送注册未被拒绝")

        login = await client.post(
            "/api/v1/auth/login",
            json={"username": USERNAME, "password": PASSWORD, "remember": True},
        )
        token = (login.json() or {}).get("access_token") if login.status_code == 200 else None
        if not token:
            bad(f"登录失败 → {login.status_code}，后续断言无法进行")
            return
        auth = {"Authorization": f"Bearer {token}"}
        ok("超管登录成功，拿到 access_token")

        # ---- 3) 课表整表同步 ----
        res = await client.post(
            "/api/v1/lessons/sync", headers=auth, json={"lessons": LESSONS, "alerts_enabled": True}
        )
        if res.status_code == 200 and res.json().get("count") == 1:
            ok("POST /lessons/sync → 已同步 1 条课表（服务器侧课表是调度的前提）")
        else:
            bad(f"课表同步异常 → {res.status_code} {res.text[:140]}")

        broken = dict(LESSONS[0])
        broken["weekday"] = 9
        if (
            await client.post("/api/v1/lessons/sync", headers=auth, json={"lessons": [broken]})
        ).status_code == 422:
            ok("非法 weekday(9) → 422（校验在建表之前，不会脏写）")
        else:
            bad("非法 weekday 未被拒绝")

        # ---- 4) 推送注册（两类 token）----
        reg = await client.post(
            "/api/v1/live-activity/registration",
            headers=auth,
            json={
                "device_id": "ip15-test-device",
                "device_token": "aa" * 32,
                "push_to_start_token": "bb" * 32,
                "environment": "sandbox",
                "timezone": "Asia/Almaty",
                "locale": "RU",
                "alerts_enabled": True,
            },
        )
        reg_body = reg.json() if reg.status_code == 200 else {}
        if (
            reg_body.get("has_push_to_start_token")
            and reg_body.get("has_device_token")
            and reg_body.get("locale") == "RU"
        ):
            ok("POST /live-activity/registration → push-to-start token 已登记（locale=RU）")
        else:
            bad(f"注册异常 → {reg.status_code} {reg.text[:160]}")

        if (
            await client.post(
                "/api/v1/live-activity/registration",
                headers=auth,
                json={"device_id": "dev-0002", "environment": "prod"},
            )
        ).status_code == 422:
            ok("非法 environment → 422")
        else:
            bad("非法 environment 未被拒绝")

        # ---- 5) 状态回显 ----
        status = (await client.get("/api/v1/live-activity/status", headers=auth)).json()
        apns_info = status.get("apns") or {}
        if (
            status.get("lesson_count") == 1
            and status.get("lead_seconds") == 900
            and apns_info.get("configured") is False
        ):
            ok("GET /live-activity/status → 课表 1 条 / 提前量 900s / APNs 未配置（优雅降级）")
        else:
            bad(f"状态回显异常 → {str(status)[:200]}")
        note(f"Live Activity topic = {apns_info.get('topic')}")

        # ---- 6) Activity session 登记 / 注销 ----
        created = await client.post(
            "/api/v1/live-activity/session",
            headers=auth,
            json={
                "activity_id": "act-1234",
                "push_token": "cc" * 32,
                "course_key": "cs201-mon-9",
                "phase": "preClass",
                "stage_end": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
                "environment": "sandbox",
                "started_by": "local",
            },
        )
        if created.status_code == 200 and created.json().get("activity_id") == "act-1234":
            ok("POST /live-activity/session → 已登记 Activity push token")
        else:
            bad(f"session 登记异常 → {created.status_code} {created.text[:140]}")

        if (
            await client.delete("/api/v1/live-activity/session/act-1234", headers=auth)
        ).status_code == 200:
            ok("DELETE /live-activity/session/{id} → 已注销")
        else:
            bad("session 注销失败")

        # ---- 7) 未配 APNs 凭据 → 优雅降级而不是 500 ----
        test_push = await client.post("/api/v1/live-activity/test-push", headers=auth)
        tp_body = test_push.json() if test_push.status_code == 200 else {}
        if (
            test_push.status_code == 200
            and tp_body.get("ok") is False
            and tp_body.get("reason") == "apns-not-configured"
            and tp_body.get("payload", {}).get("aps", {}).get("event") == "start"
        ):
            ok("POST /live-activity/test-push → ok=false / apns-not-configured（仍返回将要发送的 payload）")
        else:
            bad(f"test-push 行为异常 → {test_push.status_code} {test_push.text[:160]}")

        run = await client.post("/api/v1/live-activity/run-scheduler", headers=auth)
        run_body = run.json() if run.status_code == 200 else {}
        if run.status_code == 200 and run_body.get("skipped"):
            ok(f"POST /live-activity/run-scheduler → skipped（{run_body['skipped'][:22]}…）")
        else:
            bad(f"run-scheduler 行为异常 → {run.status_code} {run.text[:160]}")

        apns_status = await client.get("/api/v1/live-activity/apns-status", headers=auth)
        if apns_status.status_code == 200 and (
            apns_status.json().get("scheduler") or {}
        ).get("running") is False:
            ok("GET /live-activity/apns-status → 200（staff 可见调度器与凭据状态）")
        else:
            bad(f"apns-status 异常 → {apns_status.status_code}")

        if (await client.get("/api/v1/live-activity/apns-status")).status_code == 401:
            ok("未登录访问 apns-status → 401")
        else:
            bad("apns-status 未做鉴权")

    # =================================================================
    # 纯函数：调度判定（喂假时钟，精确验证"课前 15 分钟"）
    # =================================================================
    tz = ZoneInfo("Asia/Almaty")
    # 对齐到某个周一 08:50（本地）→ 距 09:00 上课 10 分钟，落在 15 分钟窗口内
    anchor = datetime(2026, 9, 14, 8, 50, tzinfo=tz)
    monday_0850 = anchor + timedelta(days=(0 - anchor.weekday()) % 7)
    monday_0820 = monday_0850 - timedelta(minutes=30)
    lesson_view = LessonView(
        course_key="cs201-mon-9",
        name="Data Structures",
        weekday=0,
        start_h=9,
        start_m=0,
        end_h=10,
        end_m=30,
        short="DS",
        room="305",
        teacher="Seitkali",
    )
    reg = RegistrationView(
        user_id="u1",
        device_id="d1",
        push_to_start_token="tok-1",
        timezone="Asia/Almaty",
        locale="EN",
    )

    def plan(now_local: datetime, **kwargs):
        return plan_pushes(
            now=now_local.astimezone(timezone.utc),
            registrations=kwargs.get("registrations", [reg]),
            lessons_by_user=kwargs.get("lessons_by_user", {"u1": [lesson_view]}),
            sessions_by_user=kwargs.get("sessions_by_user", {}),
            pushed_keys=kwargs.get("pushed_keys", set()),
            lead_seconds=900,
        )

    hit = plan(monday_0850)
    if len(hit) == 1 and hit[0].kind == "start" and hit[0].phase == "preClass":
        window = int((hit[0].stage_end - hit[0].stage_start).total_seconds())
        ok(f"课前 10 分钟 → 计划 1 条 start（倒计时窗口 {window}s）")
    else:
        bad(f"课前窗口判定错误 → {hit}")

    if not plan(monday_0820):
        ok("距上课 40 分钟（窗口外）→ 不推送（不会提前打扰）")
    else:
        bad("窗口外仍然规划了推送")

    already = {("u1", hit[0].occurrence_key, "start")} if hit else set()
    if not plan(monday_0850, pushed_keys=already):
        ok("同一节课已推过 → 不重复（幂等：每分钟一轮也不会刷屏）")
    else:
        bad("重复推送未被去重")

    class_start = monday_0850.replace(hour=9, minute=0)
    session_pre = SessionView(
        activity_id="act-1",
        user_id="u1",
        push_token="pt-1",
        course_key="cs201-mon-9",
        phase="preClass",
        stage_end=class_start,
    )
    updated = plan(class_start + timedelta(minutes=1), sessions_by_user={"u1": session_pre})
    if len(updated) == 1 and updated[0].kind == "update" and updated[0].phase == "inClass":
        ok(
            "上课时刻到 → 计划 1 条 update（切到课中倒计时，到 "
            f"{updated[0].stage_end.strftime('%H:%M')} 下课）"
        )
    else:
        bad(f"进课中判定错误 → {updated}")

    if not plan(class_start - timedelta(minutes=5), sessions_by_user={"u1": session_pre}):
        ok("会话阶段未结束 → 不推送（系统计时器在自走，无需打扰）")
    else:
        bad("会话未结束却推送了")

    session_in = SessionView(
        activity_id="act-1",
        user_id="u1",
        push_token="pt-1",
        course_key="cs201-mon-9",
        phase="inClass",
        stage_end=monday_0850.replace(hour=10, minute=30),
    )
    finished = plan(monday_0850.replace(hour=10, minute=31), sessions_by_user={"u1": session_in})
    if len(finished) == 1 and finished[0].kind == "end":
        ok("课程结束 → 计划 1 条 end（自动收起卡片）")
    else:
        bad(f"下课收起判定错误 → {finished}")

    reg_utc = RegistrationView(
        user_id="u1", device_id="d1", push_to_start_token="tok-1", timezone="UTC", locale="EN"
    )
    if not plan(monday_0850, registrations=[reg_utc]):
        ok("同一课表按不同时区注册 → 判定结果不同（时区换算确实生效）")
    else:
        bad("时区未参与判定")

    if not plan(
        monday_0850,
        registrations=[
            RegistrationView(
                user_id="u1", device_id="d1", push_to_start_token="tok-1", alerts_enabled=False
            )
        ],
    ):
        ok("用户关闭课程提醒 → 不推送")
    else:
        bad("关闭提醒后仍推送")

    # =================================================================
    # payload 契约（与 Swift ContentState 对齐的关键细节）
    # =================================================================
    if apple_reference_seconds(APPLE_REFERENCE_EPOCH) == 0:
        ok("Date 基准 = 2001-01-01（Swift Date 的 JSON 表示，不是 Unix epoch）")
    else:
        bad(f"Date 基准错误 → {apple_reference_seconds(APPLE_REFERENCE_EPOCH)}")

    stage_start = monday_0850.astimezone(timezone.utc)
    stage_end = stage_start + timedelta(minutes=15)
    start_payload = build_start_payload(
        lesson={
            "course_key": "cs201-mon-9",
            "name": "Data Structures",
            "short": "DS",
            "room": "305",
            "teacher": "Seitkali",
        },
        phase="preClass",
        stage_start=stage_start,
        stage_end=stage_end,
        now=stage_start,
        locale="RU",
    )
    aps = start_payload["aps"]
    content_state = aps["content-state"]

    if aps.get("event") == "start" and aps.get("attributes-type") == "KaznuCourseAttributes":
        ok("start payload 带 attributes-type（缺了 iOS 会丢弃整条推送）")
    else:
        bad(f"start payload 结构错误 → {list(aps)}")
    if (aps.get("attributes") or {}).get("courseName") == "Data Structures":
        ok("start payload 带 attributes（静态属性服务器侧也给全）")
    else:
        bad(f"attributes 缺失 → {aps.get('attributes')}")
    if abs(content_state["stageEnd"] - (stage_end.timestamp() - 978307200)) < 2:
        ok("content-state.stageEnd 用 Apple 参考基准（否则锁屏计时器会跑到 1970 年）")
    else:
        bad(f"stageEnd 基准错误 → {content_state['stageEnd']}")
    if content_state.get("source") == "push" and "updatedAt" in content_state:
        ok("content-state 带 source=push / updatedAt（可分辨推送 vs 本地）")
    else:
        bad("缺少 source / updatedAt")
    if "мин" in content_state["statusLabel"]:
        ok(f"RU 文案由服务器生成 → statusLabel={content_state['statusLabel']!r}")
    else:
        bad(f"文案语言未按 locale 生成 → {content_state['statusLabel']!r}")

    update_payload = build_update_payload(
        phase="inClass",
        stage_start=stage_start,
        stage_end=stage_end,
        now=stage_start,
        course_short="DS",
        locale="EN",
    )
    if (
        update_payload["aps"].get("event") == "update"
        and "attributes-type" not in update_payload["aps"]
    ):
        ok("update payload 不带 attributes-type（只有 start 需要）")
    else:
        bad("update payload 结构错误")


async def _check_scheduler_stop_is_clean() -> None:
    """回归：调度器 start→stop 必须干净退出。

    坑：``scheduler.stop()`` 里会 ``task.cancel()` + ``await task``，而 ``await`` 一个被取消的
    task 会抛 ``asyncio.CancelledError`` —— 它继承 **BaseException** 而不是 Exception，
    所以 ``except Exception`` 拦不住，会在 lifespan 关闭时冒成
    ``ERROR: Application shutdown failed. Exiting.``（线上已踩过，见 103b6bb 那次重启）。
    """
    from app.live_activity_scheduler import LiveActivityScheduler

    sched = LiveActivityScheduler()
    if not sched.start():
        bad("调度器 start() 未启动（LIVE_ACTIVITY_PUSH_ENABLED 应为 true）")
        return
    if not sched.running:
        bad("start() 之后 running 应为 True")
    await asyncio.sleep(0.1)
    try:
        await sched.stop()
    except BaseException as exc:  # noqa: BLE001 - 这里就是要抓住 BaseException
        bad(
            "scheduler.stop() 抛异常（关停时 uvicorn 会报 shutdown failed）："
            f"{type(exc).__name__}: {exc}"
        )
        return
    if sched.running:
        bad("stop() 之后 running 应为 False")
        return
    # 再 stop 一次应当是无副作用的空操作
    await sched.stop()
    ok("调度器 start→stop 干净退出（不冒 CancelledError），重复 stop 安全")


def main() -> None:
    asyncio.run(_run())
    asyncio.run(_check_scheduler_stop_is_clean())
    print("\n===== Live Activity 远程推送自检（注册 / 课表 / 调度 / payload）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
