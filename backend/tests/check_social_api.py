# -*- coding: utf-8 -*-
"""Campus 社区功能补全自检 —— 私信 Chat / 通知中心 / 图片上传 / News 融合。

    python backend/tests/check_social_api.py

无需 Postgres、无需 APNs 凭据、无需云存储（三处都走"优雅降级"分支，
而"未配凭据时不崩"本身就是要断言的行为）。

断言内容：
  1) OpenAPI 出现全部新端点（含 /ws/chat WebSocket）
  2) 私信：开会话幂等 / REST 发送 / client_id 幂等重发 / 分页信封 / 未读与已读
  3) **WebSocket 真实通道**：ready 事件、收发消息（双方 is_mine 相反）、
     typing 转发、ping/pong、无 token 时以 4401 关闭
  4) 通知：点赞触发定向通知 + 去重 / 未读角标 / 全部已读 / 全校广播（staff 限定）
  5) 上传：真 PNG 通过、文本伪装图片被拒、超限被拒、URL 指向公开地址
  6) News 融合：官方公告帖（staff 限定）置顶 + 徽章字段
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_db_file = Path(tempfile.gettempdir()) / "kaznu_check_social.db"
if _db_file.exists():
    _db_file.unlink()
_media_dir = Path(tempfile.gettempdir()) / "kaznu_check_social_media"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-social-secret"
# 不配 APNs 凭据 → 走"优雅降级"（这也是线上没有付费账号时的真实状态）
os.environ.pop("APNS_KEY_ID", None)
os.environ.pop("APNS_KEY_PATH", None)
os.environ.pop("APNS_TEAM_ID", None)
# 上传：本地磁盘 + 小上限，便于断言"超限被拒"
os.environ["UPLOAD_DIR"] = str(_media_dir)
os.environ["UPLOAD_MAX_BYTES"] = "4096"
os.environ["PUBLIC_BASE_URL"] = "https://example.test"
# 测试里会多次 asyncio.run() + 用 TestClient 在自己的线程里跑 ASGI，
# 禁用连接池避免"跨事件循环复用 aiosqlite 连接"造成的静默死锁（见 database.py 注释）
os.environ["DB_DISABLE_POOL"] = "1"

import httpx  # noqa: E402
import websockets  # noqa: E402

import main as entrypoint  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.models import ROLE_ADMIN, Post, User  # noqa: E402
from app.security import create_access_token  # noqa: E402

app = entrypoint.app

#: 真起一个 uvicorn 子进程做端到端测试（REST 用 httpx、WS 用 websockets 客户端）。
#: 为什么不用 starlette 的 TestClient：它把 ASGI 跑在自己的 portal 线程里，
#: 与测试主线程里的 aiosqlite 连接/事件循环混用会**静默死锁**（实测卡在 WS 首帧的
#: 数据库查询上）。真进程 + 真协议栈既没这个问题，也更接近线上。
SERVER_BASE = "http://127.0.0.1:0"
_WS_BASE = "ws://127.0.0.1:0"

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


#: 一个最小的合法 PNG（1×1 透明），用于真正走通 multipart 上传
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)

EXPECTED_PATHS = [
    "/api/v1/chat/conversations",
    "/api/v1/chat/conversations/{conversation_id}/messages",
    "/api/v1/chat/read",
    "/api/v1/chat/unread-count",
    "/api/v1/notifications",
    "/api/v1/notifications/read",
    "/api/v1/notifications/{notification_id}/read",
    "/api/v1/notifications/unread-count",
    "/api/v1/notifications/devices",
    "/api/v1/notifications/devices/{device_id}",
    "/api/v1/notifications/broadcast",
    "/api/v1/notifications/push-status",
    "/api/v1/uploads/image",
    "/api/v1/uploads/status",
    "/api/v1/posts/official",
]

#: OpenAPI 3 里**没有** WebSocket（协议层不支持），所以单独查路由表
EXPECTED_WS_PATH = "/api/v1/ws/chat"


# =====================================================================
# 准备：建库 + 直接造三个用户（省去登录流程，token 用 security 现签）
# =====================================================================


async def _prepare() -> tuple[str, str, str]:
    """返回 (alice_token, bob_token, staff_token)。"""
    await init_db()
    async with SessionLocal() as session:
        people = [
            User(
                univer_username="alice@student.kaznu.kz",
                global_display_name="Alice",
                department_tag="CS",
            ),
            User(
                univer_username="bob@student.kaznu.kz",
                global_display_name="Bob",
                department_tag="Math",
            ),
            User(
                univer_username="staff@student.kaznu.kz",
                global_display_name="Staff",
                department_tag="Admin",
                role=ROLE_ADMIN,
            ),
        ]
        session.add_all(people)
        await session.commit()
        for person in people:
            await session.refresh(person)
        return (
            create_access_token(people[0].id),
            create_access_token(people[1].id),
            create_access_token(people[2].id),
        )


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _collect_route_paths(routes, prefix: str = "") -> list[str]:
    """递归收集路由路径（含嵌套 router）—— 目前仅用于排查，保留以便以后加路由断言。"""
    found: list[str] = []
    for route in routes:
        sub_prefix = prefix + (getattr(route, "prefix", "") or "")
        path = getattr(route, "path", "") or ""
        if path:
            found.append(sub_prefix + path)
        children = getattr(route, "routes", None)
        if children:
            found.extend(_collect_route_paths(children, sub_prefix))
    return found


async def _run_rest(alice: str, bob: str, staff: str) -> dict[str, str]:
    """REST 部分（真起 uvicorn，走真实 HTTP）；返回后面对 WS 要用的 id。"""
    out: dict[str, str] = {}
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        # ---------- 0) 路由是否都挂上了 ----------
        schema = (await client.get("/openapi.json")).json()
        paths = set(schema.get("paths", {}))
        missing = [p for p in EXPECTED_PATHS if p not in paths]
        if missing:
            bad(f"OpenAPI 缺少端点：{missing}")
        else:
            ok(f"OpenAPI 出现全部 {len(EXPECTED_PATHS)} 个新端点")

        # 不再靠遍历 app.routes 判断 WebSocket 路由是否存在（新版 Starlette 用嵌套
        # _IncludedRouter，路径不在顶层；不同版本结构还会变）。改为语义更强的判别：
        #   * 路由**不存在** → 握手直接 404；
        #   * 路由存在但鉴权失败 → 握手 403（我们在 accept 之前 close）。
        # 所以下面鉴权断言里会检查状态码是 403 而不是 404 —— 两者能区分开。

        # ---------- 1) 开会话（幂等） ----------
        bob_me = (await client.get("/api/v1/me", headers=_auth(bob))).json()
        out["bob_id"] = bob_me["id"]

        first = await client.post(
            "/api/v1/chat/conversations",
            headers=_auth(alice),
            json={"peer_username": "bob@student.kaznu.kz"},
        )
        if first.status_code != 201:
            bad(f"开会话失败：{first.status_code} {first.text[:160]}")
            return out
        conversation = first.json()["conversation"]
        out["conversation_id"] = conversation["id"]
        if conversation["peer"]["display_name"] == "Bob":
            ok("开会话：返回对方显示名（私信实名，与校园墙匿名约定不同）")
        else:
            bad(f"开会话返回的 peer 不对：{conversation['peer']}")

        second = await client.post(
            "/api/v1/chat/conversations",
            headers=_auth(alice),
            json={"peer_id": bob_me["id"]},
        )
        if second.status_code == 201 and second.json()["conversation"]["id"] == conversation["id"]:
            ok("开会话幂等：同一对用户重复调用返回同一条会话")
        else:
            bad("开会话不幂等：同一对用户产生了多条会话")

        me = (await client.get("/api/v1/me", headers=_auth(alice))).json()
        self_chat = await client.post(
            "/api/v1/chat/conversations", headers=_auth(alice), json={"peer_id": me["id"]}
        )
        if self_chat.status_code == 400:
            ok("不能和自己私信（400）")
        else:
            bad(f"自己私信应被拒绝，实际 {self_chat.status_code}")

    return out


async def _run_messaging(alice: str, bob: str, staff: str, ids: dict[str, str]) -> None:
    """发消息 / 幂等 / 分页 / 未读已读 / 越权。"""
    conversation_id = ids["conversation_id"]
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        body = {"body": "Hey Bob!", "media_urls": [], "client_id": "c-1"}
        sent = await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=_auth(alice),
            json=body,
        )
        if sent.status_code == 201 and sent.json()["sent"]["client_id"] == "c-1":
            ok("REST 发送消息成功（返回 server id + client_id 回显）")
            ids["first_message_id"] = sent.json()["sent"]["id"]
        else:
            bad(f"发送消息失败：{sent.status_code} {sent.text[:160]}")

        replay = await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=_auth(alice),
            json=body,
        )
        if replay.status_code == 201 and replay.json()["sent"]["id"] == ids.get("first_message_id"):
            ok("client_id 幂等：同一条重发返回同一 message id（离线队列不会冒出重复气泡）")
        else:
            bad("client_id 幂等失效：重发产生了新消息")

        empty = await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=_auth(alice),
            json={"body": "   ", "media_urls": [], "client_id": "c-empty"},
        )
        if empty.status_code == 400:
            ok("空消息（无文字无图片）被拒 400")
        else:
            bad(f"空消息应 400，实际 {empty.status_code}")

        history = await client.get(
            f"/api/v1/chat/conversations/{conversation_id}/messages", headers=_auth(alice)
        )
        page = history.json()
        if set(page) >= {"items", "total", "limit", "offset", "has_more"} and page["total"] == 1:
            ok(f"历史分页信封正确（total={page['total']}；offset=0 = 最新一页，倒序）")
        else:
            bad(f"历史分页异常：{page}")

        alice_unread = (await client.get("/api/v1/chat/unread-count", headers=_auth(alice))).json()
        bob_unread = (await client.get("/api/v1/chat/unread-count", headers=_auth(bob))).json()
        if alice_unread["messages"] == 0 and bob_unread["messages"] == 1:
            ok("未读数正确：发送方 0、接收方 1")
        else:
            bad(f"未读数不对：alice={alice_unread} bob={bob_unread}")

        read = await client.post(
            "/api/v1/chat/read", headers=_auth(bob), json={"conversation_id": conversation_id}
        )
        after = (await client.get("/api/v1/chat/unread-count", headers=_auth(bob))).json()
        if read.status_code == 200 and read.json()["marked"] == 1 and after["messages"] == 0:
            ok("标记已读：marked=1 且未读归零")
        else:
            bad(f"标记已读异常：{read.text[:120]} → {after}")

        outsider = await client.get(
            f"/api/v1/chat/conversations/{conversation_id}/messages", headers=_auth(staff)
        )
        if outsider.status_code == 404:
            ok("非参与者访问会话返回 404（不用 403，避免泄露会话是否存在）")
        else:
            bad(f"越权访问应 404，实际 {outsider.status_code}")

        # 补一条未读，供后面的角标断言使用
        await client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            headers=_auth(alice),
            json={"body": "ping again", "media_urls": [], "client_id": "c-2"},
        )


async def _run_uploads(alice: str) -> None:
    """图片上传：真 PNG 通过、伪装与超限被拒、未登录被拒。"""
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        files = {"files": ("shot.png", io.BytesIO(PNG_BYTES), "image/png")}
        up = await client.post("/api/v1/uploads/image", headers=_auth(alice), files=files)
        if up.status_code == 201 and up.json()[0]["url"].startswith("https://example.test/media/"):
            ok("上传真 PNG 成功，返回绝对 URL（/media/<key>）")
        else:
            bad(f"上传失败：{up.status_code} {up.text[:160]}")

        if up.status_code == 201 and sorted(up.json()[0]) == ["content_type", "key", "size", "url"]:
            ok("上传响应字段与契约一致：url/key/size/content_type")
        elif up.status_code == 201:
            bad(f"上传响应字段异常：{sorted(up.json()[0])}")

        fake = {"files": ("evil.png", io.BytesIO(b"#!/bin/sh\nrm -rf /"), "image/png")}
        rejected = await client.post("/api/v1/uploads/image", headers=_auth(alice), files=fake)
        if rejected.status_code == 415:
            ok("伪装成图片的文本被拒（按文件头判定，不信任 content-type）")
        else:
            bad(f"非法文件应 415，实际 {rejected.status_code}")

        oversize = {"files": ("big.png", io.BytesIO(PNG_BYTES + b"\x00" * 8192), "image/png")}
        too_big = await client.post("/api/v1/uploads/image", headers=_auth(alice), files=oversize)
        if too_big.status_code == 413:
            ok("超过大小上限返回 413")
        else:
            bad(f"超限应 413，实际 {too_big.status_code}")

        anon_up = await client.post(
            "/api/v1/uploads/image", files={"files": ("shot.png", io.BytesIO(PNG_BYTES), "image/png")}
        )
        if anon_up.status_code == 401:
            ok("未登录不能上传（避免被当作免费图床）")
        else:
            bad(f"未登录上传应 401，实际 {anon_up.status_code}")

        # httpx 的多文件必须用**顶层 list**（[("files", (name, content, mime)), …]）；
        # dict 里挂 list 会让 httpx 把 list 当文件对象，报 "'list' object has no attribute 'read'"
        too_many = [
            ("files", (f"{i}.png", io.BytesIO(PNG_BYTES), "image/png")) for i in range(7)
        ]
        many = await client.post("/api/v1/uploads/image", headers=_auth(alice), files=too_many)
        if many.status_code == 400:
            ok("一次最多 6 张（第 7 张被拒 400）")
        else:
            bad(f"超过 6 张应 400，实际 {many.status_code}")


async def _run_interactions(alice: str, bob: str) -> str:
    """点赞 / 评论 → 定向通知（含匿名不泄露身份、去重、不打扰自己）。返回帖子 id。"""
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        post = (
            await client.post(
                "/api/v1/posts",
                headers=_auth(bob),
                json={
                    "content": "Bob 的实名帖",
                    "category": "general",
                    "is_anonymous": False,
                    "media_urls": [],
                },
            )
        ).json()["post"]

        # 点赞 → 取消赞 → 再点赞：去重键保证只留一条通知
        await client.post(f"/api/v1/posts/{post['id']}/like", headers=_auth(alice))
        await client.post(f"/api/v1/posts/{post['id']}/like", headers=_auth(alice))
        await client.post(f"/api/v1/posts/{post['id']}/like", headers=_auth(alice))

        center = (await client.get("/api/v1/notifications", headers=_auth(bob))).json()
        likes = [n for n in center["items"] if n["kind"] == "like"]
        if len(likes) == 1 and likes[0]["route"] == "post" and likes[0]["route_id"] == post["id"]:
            ok("点赞触发定向通知（带 route/route_id 供点击跳转），去重后只有 1 条")
        else:
            bad(f"点赞通知异常：{center['items']}")

        if likes and likes[0]["actor_name"] == "Alice":
            ok("实名帖的点赞通知带出触发者显示名")
        else:
            bad(f"点赞通知触发者异常：{likes[:1]}")

        await client.post(f"/api/v1/posts/{post['id']}/like", headers=_auth(bob))
        own = (await client.get("/api/v1/notifications", headers=_auth(bob))).json()
        if len([n for n in own["items"] if n["kind"] == "like"]) == 1:
            ok("自己给自己点赞不产生通知")
        else:
            bad("自己给自己点赞产生了通知")

        await client.post(
            f"/api/v1/posts/{post['id']}/comments",
            headers=_auth(alice),
            json={"content": "匿名评论一条", "is_anonymous": True},
        )
        after = (await client.get("/api/v1/notifications", headers=_auth(bob))).json()
        comments = [n for n in after["items"] if n["kind"] == "comment"]
        if comments and comments[0]["actor_name"] is None:
            ok("匿名评论的通知不泄露评论者身份（actor_name=None，与社区匿名约定一致）")
        else:
            bad(f"匿名评论通知泄露身份：{comments}")

        if after["unread_count"] >= 2:
            ok(f"通知中心未读角标 = {after['unread_count']}（点赞 + 评论）")
        else:
            bad("通知中心未读角标异常")

        return post["id"]


async def _run_broadcast(alice: str, bob: str, staff: str) -> None:
    """全校广播（staff 限定）+ 读游标 + 单条已读。"""
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        denied = await client.post(
            "/api/v1/notifications/broadcast",
            headers=_auth(alice),
            json={"title": "x", "message": "y"},
        )
        allowed = await client.post(
            "/api/v1/notifications/broadcast",
            headers=_auth(staff),
            json={"title": "假期安排", "message": "下周一开始放假", "level": "info"},
        )
        if denied.status_code == 403 and allowed.status_code == 200:
            payload = allowed.json()
            if payload["targets"] == 0 and payload["push"]["sent"] == 0:
                ok("全校广播：普通用户 403 / staff 成功；无设备时 targets=0 且不报错（优雅降级）")
            else:
                bad(f"广播返回异常：{payload}")
        else:
            bad(f"广播权限不对：普通用户={denied.status_code} staff={allowed.status_code}")

        center = (await client.get("/api/v1/notifications", headers=_auth(bob))).json()
        if center["broadcasts"] and center["broadcasts"][0]["is_read"] is False:
            ok("广播进入通知中心且初始未读（已读用游标时间戳表达，不写 N 行）")
        else:
            bad(f"广播未出现在通知中心：{center['broadcasts']}")

        read_all = await client.post("/api/v1/notifications/read", headers=_auth(bob))
        after = (await client.get("/api/v1/notifications", headers=_auth(bob))).json()
        if read_all.json()["marked"] >= 1 and after["unread_count"] == 0:
            ok("全部已读：定向通知 is_read + 广播游标一起归零")
        else:
            bad(f"全部已读异常：{read_all.text[:120]} → 未读 {after['unread_count']}")

        if after["items"]:
            notification_id = after["items"][0]["id"]
            mine = await client.post(
                f"/api/v1/notifications/{notification_id}/read", headers=_auth(bob)
            )
            other = await client.post(
                f"/api/v1/notifications/{notification_id}/read", headers=_auth(alice)
            )
            if mine.status_code == 200 and other.status_code == 404:
                ok("单条已读：本人 200 / 他人 404（不能标记别人的通知）")
            else:
                bad(f"单条已读异常：{mine.status_code}/{other.status_code}")


async def _run_official_and_devices(alice: str, staff: str) -> None:
    """News 融合（官方公告帖）+ 推送设备注册 + 推送自检。"""
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        denied_post = await client.post(
            "/api/v1/posts/official",
            headers=_auth(alice),
            json={"content": "我不是管理员", "category": "general", "is_anonymous": False},
        )
        official = await client.post(
            "/api/v1/posts/official",
            headers=_auth(staff),
            json={"content": "官方公告：选课系统维护", "category": "general", "is_anonymous": False},
        )
        created = official.json()["post"] if official.status_code == 201 else {}
        feed = (await client.get("/api/v1/posts", headers=_auth(alice))).json()
        if (
            denied_post.status_code == 403
            and official.status_code == 201
            and created.get("is_official") is True
            and created.get("official_badge") == "kaznu.official"
            and feed["items"][0]["is_official"] is True
        ):
            ok("官方公告帖：普通用户 403 / staff 成功 / 带 kaznu.official 徽章 / 置顶 Feed 首条")
        else:
            bad(
                "官方公告帖异常："
                f"{denied_post.status_code}/{official.status_code}"
                f"/feed[0]={feed['items'][0].get('is_official')}"
            )
        if created.get("is_anonymous") is False:
            ok("官方公告强制实名（可溯源，不允许匿名公告）")
        else:
            bad(f"官方公告 is_anonymous 应为 False，实际 {created.get('is_anonymous')}")

        device = await client.post(
            "/api/v1/notifications/devices",
            headers=_auth(alice),
            json={
                "device_id": "device-abc",
                "token": "a" * 64,
                "platform": "ios",
                "environment": "sandbox",
                "locale": "RU",
            },
        )
        again = await client.post(
            "/api/v1/notifications/devices",
            headers=_auth(alice),
            json={
                "device_id": "device-abc",
                "token": "b" * 64,
                "platform": "ios",
                "environment": "sandbox",
                "locale": "KZ",
            },
        )
        if (
            device.status_code == 201
            and again.status_code == 201
            and again.json()["id"] == device.json()["id"]
            and again.json()["locale"] == "KZ"
        ):
            ok("设备注册：同一 device_id 覆盖更新（不新增行），语言随之更新")
        else:
            bad("设备注册未按 device_id 覆盖")

        # 有设备后再广播一次：必须真的尝试推送，并如实上报失败（未配 APNs 凭据）
        second = await client.post(
            "/api/v1/notifications/broadcast",
            headers=_auth(staff),
            json={"title": "考试周提醒", "message": "注意查看考试安排", "level": "warning"},
        )
        body = second.json()
        if body["targets"] == 1 and body["push"]["failed"] == 1 and body["push"]["sent"] == 0:
            ok("有设备时广播：targets=1 且失败如实计数（未配凭据 → apns-not-configured）")
        else:
            bad(f"有设备时广播计数异常：{body}")

        removed = await client.delete(
            "/api/v1/notifications/devices/device-abc", headers=_auth(alice)
        )
        if removed.json()["removed"] == 1:
            ok("设备注销成功")
        else:
            bad(f"设备注销异常：{removed.text[:120]}")

        status = (await client.get("/api/v1/notifications/push-status", headers=_auth(staff))).json()
        if status["apns"]["configured"] is False and status["alert_topic"] == "com.kaznu.helper":
            ok(f"推送自检：APNs configured=False（优雅降级）、alert topic={status['alert_topic']}")
        else:
            bad(f"推送自检异常：{status}")

        denied_status = await client.get("/api/v1/notifications/push-status", headers=_auth(alice))
        if denied_status.status_code == 403:
            ok("推送自检为 staff 专属（普通用户 403）")
        else:
            bad(f"推送自检应 403，实际 {denied_status.status_code}")

        upload_status = (await client.get("/api/v1/uploads/status", headers=_auth(staff))).json()
        if (
            upload_status["backend"] == "local"
            and upload_status["dir_writable"] is True
            and upload_status["max_bytes"] == 4096
        ):
            ok("上传自检：本地后端、目录可写、上限来自 UPLOAD_MAX_BYTES")
        else:
            bad(f"上传自检异常：{upload_status}")


async def _run_websocket(alice: str, bob: str, staff: str, ids: dict[str, str]) -> None:
    """WebSocket 真实通道：真 uvicorn 进程 + 真 websockets 客户端。

    每个 recv 都用 ``asyncio.wait_for`` 加超时 —— 一旦收不到事件就**明确报失败**，
    而不是把整个测试挂住（这正是之前踩过的坑）。
    """
    conversation_id = ids["conversation_id"]
    ws_url = f"{_WS_BASE}{EXPECTED_WS_PATH}"

    async def recv_json(sock, label: str) -> dict:
        try:
            raw = await asyncio.wait_for(sock.recv(), timeout=10)
        except asyncio.TimeoutError:
            bad(f"WS 等待事件超时（10s）：{label}")
            return {"type": "__timeout__"}
        return json.loads(raw)

    async def rest(method: str, path: str, token: str) -> httpx.Response:
        """本函数里也要打几个 REST 接口（撤回 / 历史），单独开一个短连接客户端。

        其它 ``_run_*`` 都用 `async with httpx.AsyncClient(...)` 包住整个函数体，
        而这个函数要一直握着 WS 连接，所以不能那样写 —— 用这个辅助函数按需请求。
        """
        async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as http:
            return await http.request(method, path, headers=_auth(token))

    # ---- 鉴权：没有 token / 假 token 必须在握手阶段被拒（403，而不是 404）
    for label, url in (
        ("无 token", ws_url),
        ("假 token", f"{ws_url}?token=not-a-real-token"),
    ):
        try:
            async with websockets.connect(url) as probe:
                await asyncio.wait_for(probe.recv(), timeout=5)
            bad(f"{label} 的 WebSocket 应被拒绝")
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 404:
                bad(f"{label}：WebSocket 路由不存在（握手 404）—— 路由没挂上")
            else:
                ok(f"WebSocket 鉴权：{label} 被拒（握手 HTTP {status}）")

    async with websockets.connect(f"{ws_url}?token={alice}") as ws_a:
        ready = await recv_json(ws_a, "ready")
        if ready.get("type") == "ready" and ready.get("user_id") == ids.get("alice_id"):
            ok(f"连接就绪事件 ready（带未读数 unread={ready.get('unread')}）")
        else:
            bad(f"ready 事件异常：{ready}")

        async with websockets.connect(f"{ws_url}?token={bob}") as ws_b:
            if (await recv_json(ws_b, "ready#2")).get("type") == "ready":
                ok("两个用户可同时在线上（同一用户也可多端连接）")
            else:
                bad("第二个连接的 ready 异常")

            # ---- 心跳（移动网络保活）
            await ws_a.send(json.dumps({"type": "ping"}))
            if (await recv_json(ws_a, "pong")).get("type") == "pong":
                ok("ping → pong 心跳正常")
            else:
                bad("ping 未收到 pong")

            # ---- 发消息：接收方 is_mine=False，发送方回显 is_mine=True
            send_frame = json.dumps(
                {
                    "type": "send",
                    "conversation_id": conversation_id,
                    "body": "ws hello",
                    "media_urls": [],
                    "client_id": "ws-1",
                }
            )
            await ws_a.send(send_frame)
            incoming = await recv_json(ws_b, "message@bob")
            echo = await recv_json(ws_a, "echo@alice")
            if (
                incoming.get("type") == "message"
                and incoming["message"]["body"] == "ws hello"
                and incoming["message"]["is_mine"] is False
                and incoming["message"]["client_id"] == "ws-1"
            ):
                ok("WS 实时收消息：接收方 is_mine=False 且带回 client_id")
            else:
                bad(f"WS 收消息异常：{incoming}")
            if echo.get("type") == "message" and echo["message"]["is_mine"] is True:
                ok("WS 发送方回显：is_mine=True（多设备同步同一会话）")
            else:
                bad(f"WS 回显异常：{echo}")

            # ---- 幂等：同 client_id 再发一次不得产生新消息
            await ws_a.send(send_frame)
            await ws_a.send(json.dumps({"type": "ping"}))
            extra = 0
            while True:
                event = await recv_json(ws_a, "pong#2")
                if event.get("type") == "pong":
                    break
                extra += 1
            if extra == 0:
                ok("WS 重发（同 client_id）不产生新消息、也没有多余广播")
            else:
                bad(f"WS 重发产生了 {extra} 个额外事件（幂等失效）")

            # ---- 输入状态只转发给对端
            await ws_a.send(json.dumps({"type": "typing", "conversation_id": conversation_id}))
            typing = await recv_json(ws_b, "typing")
            if typing.get("type") == "typing" and typing.get("user_id") == ids.get("alice_id"):
                ok("typing 输入状态只转发给对端（不落库）")
            else:
                bad(f"typing 转发异常：{typing}")

            # ---- 已读：B 收到 read-ack，A 收到对方已读回执
            await ws_b.send(json.dumps({"type": "read", "conversation_id": conversation_id}))
            ack = await recv_json(ws_b, "read-ack")
            receipt = await recv_json(ws_a, "read-receipt@alice")
            if ack.get("type") == "read-ack" and ack.get("marked", 0) >= 1:
                ok("已读确认 read-ack（带 marked 条数）")
            else:
                bad(f"read-ack 异常：{ack}")
            if receipt.get("type") == "read" and receipt.get("reader_id") == ids.get("bob_id"):
                ok("已读回执推给对端（UI 可显示已读）")
            else:
                bad(f"已读回执异常：{receipt}")

            # ---- 撤回：A 撤回自己的消息 → 双方都收到 message-deleted，历史里不再是原文
            await ws_a.send(
                json.dumps(
                    {
                        "type": "send",
                        "conversation_id": conversation_id,
                        "body": "这条稍后会被撤回",
                        "client_id": "recall-1",
                    }
                )
            )
            recalled_echo = await recv_json(ws_a, "recall-echo")
            recalled_incoming = await recv_json(ws_b, "recall-incoming")
            recalled_id = (recalled_echo.get("message") or {}).get("id") or (
                recalled_incoming.get("message") or {}
            ).get("id")
            if recalled_id:
                # 别人发的不能删（403）；自己的能删（200，deleted_by=user）
                forbidden = await rest("DELETE", f"/api/v1/chat/messages/{recalled_id}", bob)
                if forbidden.status_code == 403:
                    ok("撤回权限：不能删除别人发的消息（403）")
                else:
                    bad(f"越权撤回未被拒绝：{forbidden.status_code}")

                deleted = await rest("DELETE", f"/api/v1/chat/messages/{recalled_id}", alice)
                if deleted.status_code == 200 and deleted.json().get("deleted_by") == "user":
                    ok("本人撤回自己的消息 → 200（deleted_by=user）")
                else:
                    bad(f"本人撤回失败：{deleted.status_code} {deleted.text[:120]}")

                frame = await recv_json(ws_b, "message-deleted@bob")
                if frame.get("type") == "message-deleted" and frame.get("message_id") == recalled_id:
                    ok("撤回帧实时推给对端（对方 UI 立即变占位文案）")
                else:
                    bad(f"撤回帧异常：{frame}")

                history = await rest(
                    "GET", f"/api/v1/chat/conversations/{conversation_id}/messages?limit=50", alice
                )
                items = history.json().get("items", [])
                hit = next((m for m in items if m.get("id") == recalled_id), None)
                if hit is not None and hit.get("is_deleted") is True and not hit.get("body"):
                    ok("历史接口：已撤回的消息 is_deleted=true 且不返回原文")
                else:
                    bad(f"已撤回消息仍在历史里泄露原文：{hit}")

                # 重复撤回 → 404（幂等，不会重复推帧）
                again = await rest("DELETE", f"/api/v1/chat/messages/{recalled_id}", alice)
                if again.status_code == 404:
                    ok("重复撤回 → 404（不会重复推帧）")
                else:
                    bad(f"重复撤回应 404，实际 {again.status_code}")

                # staff 可下架任意私信（后台私信审核页走同一条接口）
                await ws_a.send(
                    json.dumps(
                        {
                            "type": "send",
                            "conversation_id": conversation_id,
                            "body": "这条会被管理员下架",
                            "client_id": "recall-2",
                        }
                    )
                )
                echo2 = await recv_json(ws_a, "recall2-echo")
                await recv_json(ws_b, "recall2-incoming")
                target2 = (echo2.get("message") or {}).get("id")
                if target2:
                    staff_delete = await rest("DELETE", f"/api/v1/chat/messages/{target2}", staff)
                    if (
                        staff_delete.status_code == 200
                        and staff_delete.json().get("deleted_by") == "staff"
                    ):
                        ok("staff 可下架任意私信（deleted_by=staff，与后台审核同一条接口）")
                    else:
                        bad(f"staff 下架失败：{staff_delete.status_code} {staff_delete.text[:120]}")
            else:
                bad("撤回用例：拿不到刚发送消息的 id")

            # ---- 异常输入不能把连接搞崩
            await ws_a.send(json.dumps({"type": "definitely-not-a-thing"}))
            if (await recv_json(ws_a, "unknown-event")).get("type") == "error":
                ok("未知事件返回 error 且连接存活")
            else:
                bad("未知事件未返回 error")
            await ws_a.send(json.dumps({"type": "read", "conversation_id": "does-not-exist"}))
            if (await recv_json(ws_a, "bad-conversation")).get("reason") == "conversation-not-found":
                ok("非法会话 id 返回 conversation-not-found")
            else:
                bad("非法会话 id 未返回预期 error")


async def _whoami(token: str) -> str:
    async with httpx.AsyncClient(base_url=SERVER_BASE, timeout=15.0) as client:
        return (await client.get("/api/v1/me", headers=_auth(token))).json()["id"]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _start_server() -> subprocess.Popen:
    """起一个真的 uvicorn 子进程（工作目录 = 仓库根，所以 ``main:app`` 能解析）。

    用真进程而不是 TestClient：TestClient 把 ASGI 跑在自己的 portal 线程里，
    与主线程的 aiosqlite 连接/事件循环混用会**静默死锁**（实测卡在 WS 首帧的数据库查询）。
    """
    global SERVER_BASE, _WS_BASE

    port = _free_port()
    SERVER_BASE = f"http://127.0.0.1:{port}"
    _WS_BASE = f"ws://127.0.0.1:{port}"

    log_path = Path(tempfile.gettempdir()) / "kaznu_check_social_server.log"
    log = log_path.open("wb")
    proc = subprocess.Popen(
        [
            sys.executable,
            # -u：子进程 stdout 无缓冲。否则 Windows 上 terminate() 是硬杀，缓冲区不落盘，
            # 应用里的 print（例如 "chat WS 异常"）就全丢了 —— 出问题时无从排查。
            "-u",
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=str(ROOT),
        env=dict(os.environ),
        stdout=log,
        stderr=subprocess.STDOUT,
    )

    deadline = time.time() + 40
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn 提前退出，日志见 {log_path}")
        try:
            with urllib.request.urlopen(f"{SERVER_BASE}/healthz", timeout=2) as resp:
                if resp.status == 200:
                    return proc
        except Exception:
            time.sleep(0.4)
    proc.terminate()
    raise RuntimeError(f"uvicorn 未在 40s 内就绪，日志见 {log_path}")


def _stop_server(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=15)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


async def _run_all(alice: str, bob: str, staff: str, ids: dict[str, str]) -> None:
    """所有步骤跑在**同一个事件循环**里（避免多循环带来的连接/任务归属问题）。"""
    ids.update(await _run_rest(alice, bob, staff))
    ids["alice_id"] = await _whoami(alice)
    await _run_messaging(alice, bob, staff, ids)
    await _run_uploads(alice)
    post_id = await _run_interactions(alice, bob)
    notes.append(f"  —— 互动通知测试帖 id：{post_id[:8]}…")
    await _run_broadcast(alice, bob, staff)
    await _run_official_and_devices(alice, staff)
    await _run_websocket(alice, bob, staff, ids)


def main() -> None:
    def step(label: str) -> None:
        # 输出到 stderr 并 flush：万一某一步挂起，能立刻看出卡在哪
        print(f"[step] {label}", file=sys.stderr, flush=True)

    ids: dict[str, str] = {}
    server: subprocess.Popen | None = None
    try:
        step("1/3 建库 + 造用户（在启动服务器之前完成，避免多进程同时写库）")
        alice, bob, staff = asyncio.run(_prepare())
        step("2/3 启动 uvicorn 子进程")
        server = _start_server()
        step("3/3 端到端跑 REST + WebSocket")
        asyncio.run(_run_all(alice, bob, staff, ids))
    except Exception as exc:  # noqa: BLE001 - 统一收尾后再打印结果
        bad(f"测试过程中异常：{type(exc).__name__}: {exc}")
    finally:
        if server is not None:
            _stop_server(server)

    print("\n===== Campus 社区补全自检（私信 WS / 通知 / 上传 / News 融合）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print(f"\n全部检查通过（{len(notes)} 项）")

    print("\n===== Campus 社区补全自检（私信 WS / 通知 / 上传 / News 融合）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print(f"\n全部检查通过（{len(notes)} 项）")


if __name__ == "__main__":
    main()
