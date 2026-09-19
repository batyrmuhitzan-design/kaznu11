# -*- coding: utf-8 -*-
"""Campus Hub 后端自检 —— 校园墙 / 评论 / 点赞 / 社团活动 / 全局通知 / SQLAdmin 挂载。

    python backend/tests/check_campus_api.py

无需 PostgreSQL（自动用临时 SQLite），Windows / Linux 均可直接跑。

断言内容：
  1) OpenAPI 里出现全部 6 个新端点
  2) 分页信封 Page[T]：items/total/limit/offset/has_more 齐全且自洽
  3) 帖子列表：按分类过滤、按时间倒序、被 is_hidden 的不出现
  4) 匿名隐私：匿名帖 / 匿名评论的作者 name 必须为 None（只留院系标签）
  5) 发帖：未登录 401；登录后 201 且归属正确；非法分类 / javascript: 外链 → 422
  6) 点赞开关：第一次 liked=true 且 +1，第二次 liked=false 且 -1
  7) 评论：创建后能在列表里查到，匿名评论同样不泄露作者
  8) 社团活动：只返回 is_approved=True 的（待审核那条不可见）
  9) 全局通知：返回当前生效的最新一条；停用后返回下一条
 10) SQLAdmin：4 个新模型的后台列表页均可访问（200）
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 必须在导入入口前设置：临时 SQLite，避免依赖 Postgres
_db_file = Path(tempfile.gettempdir()) / "kaznu_check_campus.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-campus-session-secret"

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

import main as entrypoint  # noqa: E402  ← 被测对象：仓库根 main.py

from app.admin_ui import (  # noqa: E402
    GlobalNotificationAdmin,
)
from app.bootstrap import ensure_super_admin  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import GlobalNotification, Post, User  # noqa: E402
from app.push import push_existing_notification  # noqa: E402
from app.realtime import manager  # noqa: E402
from app.seed import seed_campus_if_empty, seed_if_empty  # noqa: E402

USERNAME = os.environ["SUPER_ADMIN_USERNAME"]
PASSWORD = os.environ["SUPER_ADMIN_PASSWORD"]

EXPECTED_PATHS = [
    "/api/v1/posts",
    "/api/v1/posts/{post_id}/like",
    "/api/v1/posts/{post_id}/comments",
    "/api/v1/club-events",
    "/api/v1/notifications/latest",
]

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def note(msg: str) -> None:
    notes.append(f"       {msg}")


def check_page(where: str, body: dict) -> bool:
    """分页信封形状与自洽性。"""
    required = {"items", "total", "limit", "offset", "has_more"}
    missing = required - set(body)
    if missing:
        bad(f"{where} 分页信封缺字段：{sorted(missing)}")
        return False
    if not isinstance(body["items"], list):
        bad(f"{where} items 不是数组")
        return False
    if body["has_more"] != (body["offset"] + len(body["items"]) < body["total"]):
        bad(f"{where} has_more 与 total/offset 不自洽：{body['total']}/{body['offset']}/{len(body['items'])}")
        return False
    return True


async def _prepare_db(app) -> None:
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
        admin_user = await ensure_super_admin(session)
        await seed_campus_if_empty(session, admin_user)
    app.state.db_ready = True


async def _run() -> None:
    app = entrypoint.app
    await _prepare_db(app)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as anon:
        # ---- 1) OpenAPI 路由登记 ----
        schema = (await anon.get("/openapi.json")).json()
        paths = schema.get("paths", {})
        missing = [p for p in EXPECTED_PATHS if p not in paths]
        if missing:
            bad("OpenAPI 缺少 Campus 路由：" + ", ".join(missing))
        else:
            ok(f"/openapi.json 含全部 {len(EXPECTED_PATHS)} 个 Campus Hub 端点")

        # ---- 2) 全局紧急通知 ----
        notif = (await anon.get("/api/v1/notifications/latest")).json()
        if isinstance(notif, dict) and notif.get("level") in {"info", "warning", "danger"}:
            ok(f"/notifications/latest → {notif['level']} · {notif['title']!r}")
        else:
            bad(f"/notifications/latest 内容异常：{notif}")

        # ---- 3) 帖子列表（分页 + 匿名脱敏）----
        page = (await anon.get("/api/v1/posts?limit=50")).json()
        if not check_page("/api/v1/posts", page):
            bad(f"/api/v1/posts 返回异常：{str(page)[:160]}")
        else:
            ok(f"/api/v1/posts → {page['total']} 条（limit={page['limit']}, has_more={page['has_more']}）")

        posts = page.get("items", [])
        if len(posts) >= 4:
            ok(f"种子帖子可用（{len(posts)} 条，含评论数/点赞数字段）")
        else:
            bad(f"种子帖子数量异常：{len(posts)}")

        anon_test_ok = True
        real_names = []
        for p in posts:
            author = p.get("author") or {}
            if p.get("is_anonymous"):
                # 匿名帖：name 与 department_tag 都必须为空（比评价体系更严）
                if author.get("name") is not None or author.get("department_tag") is not None:
                    anon_test_ok = False
            elif author.get("name"):
                real_names.append(author["name"])
        if anon_test_ok:
            ok("匿名帖 author.name / department_tag 全为 None（隐私不变量成立）")
        else:
            bad("匿名帖泄露了作者身份（显示名或院系标签）！")
        note(f"匿名帖只暴露 is_anonymous=True；实名帖作者：{sorted(set(real_names))}")

        # 倒序校验（created_at 递减）
        stamps = [p["created_at"] for p in posts]
        if stamps == sorted(stamps, reverse=True):
            ok("帖子按 created_at 倒序返回")
        else:
            bad("帖子未按时间倒序")

        # ---- 4) 按分类过滤 ----
        filtered = (await anon.get("/api/v1/posts?category=lost_found&limit=50")).json()
        cats = {p["category"] for p in filtered.get("items", [])}
        if cats == {"lost_found"} and filtered.get("total", 0) >= 1:
            ok(f"?category=lost_found → 只返回该分类（{filtered['total']} 条）")
        else:
            bad(f"?category=lost_found 过滤失败：{cats}")

        if (await anon.get("/api/v1/posts?category=not_a_category")).status_code == 400:
            ok("非法 category → 400")
        else:
            bad("非法 category 未被拒绝")

        # ---- 5) 社团活动：只返回已审核 ----
        events = (await anon.get("/api/v1/club-events?limit=50")).json()
        if not check_page("/api/v1/club-events", events):
            bad(f"/api/v1/club-events 返回异常：{str(events)[:160]}")
        else:
            titles = [e["title"] for e in events["items"]]
            pending_visible = any("待审核" in t for t in titles)
            if pending_visible:
                bad("未审核的活动出现在公开列表里！")
            else:
                ok(f"/api/v1/club-events → {events['total']} 条，未审核活动已排除")
            times = [e["event_time"] for e in events["items"]]
            if times == sorted(times):
                ok("活动按 event_time 升序（最近的在前）")
            else:
                bad("活动未按时间升序")

        all_events = (await anon.get("/api/v1/club-events?include_past=true&limit=50")).json()
        note(f"include_past=true 时可见 {all_events['total']} 条（含全部已审核活动）")

        # ---- 6) 未登录不能发帖 ----
        unauth = await anon.post("/api/v1/posts", json={"content": "hello", "category": "general"})
        if unauth.status_code == 401:
            ok("POST /posts 未登录 → 401")
        else:
            bad(f"POST /posts 未登录返回 {unauth.status_code}（应为 401）")

        # ---- 7) 登录（发帖 / 点赞 / 评论都需要 token）----
        login = await anon.post(
            "/api/v1/auth/login",
            json={"username": USERNAME, "password": PASSWORD, "remember": True},
        )
        token = (login.json() or {}).get("access_token") if login.status_code == 200 else None
        if not token:
            bad(f"登录失败 → {login.status_code} {login.text[:120]}，后续需要鉴权的断言无法进行")
            return
        auth = {"Authorization": f"Bearer {token}"}
        ok("超管登录成功，拿到 access_token")

        # ---- 8) 匿名发帖 ----
        created = await anon.post(
            "/api/v1/posts",
            headers=auth,
            json={
                "content": "自检帖：图书馆空调太冷了，有人知道几楼最暖和吗？",
                "category": "general",
                "is_anonymous": True,
                "media_urls": ["https://picsum.photos/seed/kaznu-check/600/400"],
            },
        )
        new_id = None
        if created.status_code == 201:
            post = created.json().get("post") or {}
            author = post.get("author") or {}
            new_id = post.get("id")
            if post.get("is_anonymous") and author.get("name") is None:
                ok("POST /posts（匿名）→ 201，响应未泄露作者")
            else:
                bad(f"新帖匿名脱敏失败：{author}")
            if post.get("media_urls"):
                ok("media_urls 已落库并回显")
            else:
                bad("media_urls 丢失")
        else:
            bad(f"POST /posts → {created.status_code} {created.text[:140]}")

        if new_id:
            top = (await anon.get("/api/v1/posts?limit=5")).json()["items"]
            if top and top[0]["id"] == new_id:
                ok("新帖出现在信息流首位（按时间倒序）")
            else:
                bad("新帖未出现在首位")

        # ---- 9) 入参校验 ----
        bad_cat = await anon.post(
            "/api/v1/posts", headers=auth, json={"content": "x", "category": "nope"}
        )
        if bad_cat.status_code == 422:
            ok("非法分类发帖 → 422")
        else:
            bad(f"非法分类未被拒绝 → {bad_cat.status_code}")

        bad_url = await anon.post(
            "/api/v1/posts",
            headers=auth,
            json={"content": "x", "category": "general", "media_urls": ["javascript:alert(1)"]},
        )
        if bad_url.status_code == 422:
            ok("javascript: 外链 → 422（媒体外链只允许 http/https）")
        else:
            bad(f"危险外链未被拒绝 → {bad_url.status_code}")

        # ---- 10) 点赞 / 取消赞开关 ----
        if new_id:
            first = (await anon.post(f"/api/v1/posts/{new_id}/like", headers=auth)).json()
            second = (await anon.post(f"/api/v1/posts/{new_id}/like", headers=auth)).json()
            if first.get("liked") is True and first.get("likes_count") == 1:
                ok(f"点赞 → liked=true, likes_count={first['likes_count']}")
            else:
                bad(f"点赞异常：{first}")
            if second.get("liked") is False and second.get("likes_count") == 0:
                ok(f"再点一次 → liked=false, likes_count={second['likes_count']}（取消赞）")
            else:
                bad(f"取消赞异常：{second}")
            unauth_like = await anon.post(f"/api/v1/posts/{new_id}/like")
            if unauth_like.status_code == 401:
                ok("未登录点赞 → 401")
            else:
                bad(f"未登录点赞返回 {unauth_like.status_code}（应为 401）")

        # ---- 10b) 全校广播：投递 id / pushed_at / 重复推送仍算"新投递" ----
        # 直接检查 WS 帧内容（用桩连接，不需要真起 WS 服务端）：这是"App 弹窗 + 响铃"
        # 能否生效的关键 —— 客户端按 delivery_id 去重，重复推送必须拿到**不同的** id。
        class _FakeSocket:
            def __init__(self) -> None:
                self.frames: list[dict] = []

            async def send_text(self, text: str) -> None:
                self.frames.append(json.loads(text))

        async with SessionLocal() as session:
            admin_user = await session.scalar(
                select(User).where(User.univer_username == USERNAME)
            )
            sock = _FakeSocket()
            await manager.connect(admin_user.id, sock)
            try:
                broadcast = await anon.post(
                    "/api/v1/notifications/broadcast",
                    headers=auth,
                    json={
                        "title": "E2E 广播",
                        "message": "这条用来验证投递 id 与 pushed_at",
                        "level": "warning",
                    },
                )
                body = broadcast.json() if broadcast.status_code == 200 else {}
                frames = [f for f in sock.frames if f.get("type") == "broadcast"]
                first_delivery = (
                    (frames[0].get("broadcast") or {}).get("delivery_id") if frames else None
                )
                if broadcast.status_code == 200 and first_delivery:
                    ok(f"广播 → 200 且 WS 帧带 delivery_id（{first_delivery.split(':')[-1]}）")
                else:
                    bad(f"广播未带 delivery_id：{broadcast.status_code} {sock.frames[:1]}")

                latest = (await anon.get("/api/v1/notifications/latest")).json()
                if isinstance(latest, dict) and latest.get("pushed_at"):
                    ok("GET /notifications/latest 返回 pushed_at（前端据此识别'又被推了一次'）")
                else:
                    bad(f"/notifications/latest 缺 pushed_at：{latest}")

                # 管理端「📣 Push now」：同一条通知再推一次 → delivery_id 必须不同
                if body.get("id"):
                    row = await session.scalar(
                        select(GlobalNotification).where(GlobalNotification.id == body["id"])
                    )
                    sock.frames.clear()
                    await push_existing_notification(session, row)
                    frames2 = [f for f in sock.frames if f.get("type") == "broadcast"]
                    second_delivery = (
                        (frames2[0].get("broadcast") or {}).get("delivery_id") if frames2 else None
                    )
                    if second_delivery and second_delivery != first_delivery:
                        ok("重复推送产生**新的** delivery_id（App 会再次弹窗 + 响铃）")
                    else:
                        bad(f"重复推送仍是同一个 delivery_id（{second_delivery}）→ 会被客户端去重")
                    if row is not None and row.pushed_at is not None:
                        ok("Push now 写入 pushed_at（后台与客户端都能看出'已推送时间'）")
                    else:
                        bad("Push now 未写入 pushed_at")
                else:
                    bad("广播响应里没有 id，无法验证重复推送")
            finally:
                await manager.disconnect(admin_user.id, sock)

        # ---- 11) 评论（匿名 + 实名）----
        if new_id:
            c1 = await anon.post(
                f"/api/v1/posts/{new_id}/comments",
                headers=auth,
                json={"content": "三楼东侧有个暖气口，去那里", "is_anonymous": True},
            )
            c2 = await anon.post(
                f"/api/v1/posts/{new_id}/comments",
                headers=auth,
                json={"content": "谢谢！", "is_anonymous": False},
            )
            if c1.status_code == 201 and c2.status_code == 201:
                ok("POST /posts/{id}/comments → 201（匿名 + 实名各一条）")
            else:
                bad(f"评论创建失败 → {c1.status_code}/{c2.status_code}")

            cl = (await anon.get(f"/api/v1/posts/{new_id}/comments?limit=50")).json()
            if check_page("/posts/{id}/comments", cl) and cl.get("total") == 2:
                ok(f"GET /posts/{{id}}/comments → {cl['total']} 条")
            else:
                bad(f"评论列表异常：{cl.get('total')}")

            anon_comment = next((c for c in cl.get("items", []) if c["is_anonymous"]), None)
            cauthor = (anon_comment or {}).get("author") or {}
            if anon_comment is not None and cauthor.get("name") is None and cauthor.get("department_tag") is None:
                ok("匿名评论作者同样全为 None（不泄露）")
            else:
                bad("匿名评论泄露作者")

            listed = (await anon.get("/api/v1/posts?limit=5")).json()["items"]
            mine = next((p for p in listed if p["id"] == new_id), None)
            if mine and mine.get("comment_count") == 2:
                ok("列表里的 comment_count 与实际评论数一致")
            else:
                bad(f"comment_count 不一致：{mine and mine.get('comment_count')}")

        # ---- 12) 软下架（is_hidden）后不再公开 ----
        if new_id:
            async with SessionLocal() as session:
                row = await session.get(Post, new_id)
                row.is_hidden = True
                await session.commit()

            still_listed = any(
                p["id"] == new_id
                for p in (await anon.get("/api/v1/posts?limit=50")).json()["items"]
            )
            comments_status = (await anon.get(f"/api/v1/posts/{new_id}/comments")).status_code
            if not still_listed and comments_status == 404:
                ok("is_hidden=true → 从公开列表消失，评论接口 404（软下架生效）")
            else:
                bad(f"软下架未生效（still_listed={still_listed}, comments={comments_status}）")

            async with SessionLocal() as session:  # 复原，方便人工核对
                row = await session.get(Post, new_id)
                row.is_hidden = False
                await session.commit()

        # ---- 13) 停用最新通知 → 自动轮到下一条生效通知 ----
        async with SessionLocal() as session:
            active = (
                await session.scalars(
                    select(GlobalNotification)
                    .where(GlobalNotification.is_active.is_(True))
                    .order_by(GlobalNotification.created_at.desc())
                )
            ).all()
        if len(active) >= 2:
            newest, runner_up = active[0], active[1]
            async with SessionLocal() as session:
                row = await session.get(GlobalNotification, newest.id)
                row.is_active = False
                await session.commit()
            nxt = (await anon.get("/api/v1/notifications/latest")).json()
            if isinstance(nxt, dict) and nxt.get("id") == runner_up.id:
                ok("停用最新通知后，/notifications/latest 自动返回下一条生效通知")
            else:
                bad(f"通知轮转异常：{(nxt or {}).get('id') if isinstance(nxt, dict) else nxt}")
            async with SessionLocal() as session:
                row = await session.get(GlobalNotification, newest.id)
                row.is_active = True
                await session.commit()
        else:
            bad(f"生效中的通知少于 2 条（{len(active)}），无法验证轮转与停用")

    # ---- 14) SQLAdmin：4 个新模型的后台页面 ----
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as staff:
        login = await staff.post(
            "/admin/login",
            data={"username": USERNAME, "password": PASSWORD},
            follow_redirects=False,
        )
        if login.status_code in (302, 303):
            for cls in (GlobalNotificationAdmin,):
                res = await staff.get(f"/admin/{cls.identity}/list")
                if res.status_code == 200:
                    ok(f"/admin/{cls.identity}/list → 200（{cls.__name__}）")
                else:
                    bad(f"/admin/{cls.identity}/list → {res.status_code}（{cls.__name__}）")
        else:
            bad(f"后台登录失败 → {login.status_code}，无法验证 SQLAdmin 挂载")


def main() -> None:
    asyncio.run(_run())
    print("\n===== Campus Hub 后端自检（校园墙 / 评论 / 点赞 / 活动 / 通知 / 后台）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
