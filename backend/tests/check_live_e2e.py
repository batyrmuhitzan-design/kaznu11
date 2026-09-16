"""线上 E2E（默认打 https://1losion.me）：广播投递 id/pushed_at + 私信撤回 + 越权保护。

为什么不能只看本地自检：本地用桩 socket 检查帧内容能证明逻辑对，但证明不了
"经过 nginx + 真 WebSocket + 真 SQLite + 新列迁移" 之后 App 实际收到的东西是对的。
App 的弹窗/响铃只认 `delivery_id` / `pushed_at` 这两个字段 —— 少一个就退回"没反应"。

用法（本地跑，需要公网 + `websockets`）：

    backend/venv/Scripts/python.exe backend/tests/check_live_e2e.py
    # macOS/Linux: python backend/tests/check_live_e2e.py

⚠️ 它会**写生产数据**：2 条全校广播 + 1 条私信（私信发完立刻撤回）。
   所以广播在结束时**自动下线**（`is_active=0` → 真机不再显示），**断言失败也照样清理**；
   清理失败会判为失败（`[!!]`）并打印手动下线链接 —— 不留"测试横幅"给全校设备。

环境变量：`KAZNU_SITE`（默认 https://1losion.me）、`KAZNU_ADMIN_USER`、
`KAZNU_ADMIN_PASSWORD`（默认复用 demo 密码 `123456`，见 backend/README.md）。
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = os.environ.get("KAZNU_SITE", "https://1losion.me").rstrip("/")
BASE = f"{SITE}/api/v1"
WS = f"{SITE.replace('https://', 'wss://').replace('http://', 'ws://')}/api/v1/ws/chat"

#: 后台登录凭据（`SUPER_ADMIN_PASSWORD` 为空时复用 `DEMO_PASSWORD`，见 backend/README.md）
ADMIN_USER = os.environ.get("KAZNU_ADMIN_USER", "superadmin@student.kaznu.kz")
ADMIN_PASSWORD = os.environ.get("KAZNU_ADMIN_PASSWORD", os.environ.get("DEMO_PASSWORD", "123456"))

#: 本轮跑出来的广播 id，结束时统一下线（见 cleanup_test_broadcasts）
CREATED_BROADCAST_IDS: list[str] = []

#: 标题里带时间戳：万一清理失败也能一眼搜出孤儿数据（管理端搜索 "E2E 广播"）
STAMP = str(int(time.time()))

fails: list[str] = []


def ok(msg: str) -> None:
    print(f"  [ok] {msg}", flush=True)


def bad(msg: str) -> None:
    fails.append(msg)
    print(f"  [!!] {msg}", flush=True)


def call(path: str, method: str = "GET", body: dict | None = None, token: str | None = None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw or "null")
        except json.JSONDecodeError:
            return exc.code, raw


def login(username: str) -> tuple[str, dict]:
    status, res = call(
        "/auth/login",
        "POST",
        {"username": username, "password": os.environ.get("KAZNU_DEMO_PASSWORD", "123456")},
    )
    if status != 200:
        raise SystemExit(f"登录 {username} 失败：HTTP {status} {res}")
    return res["access_token"], res["user"]


async def drain(ws, seconds: float = 1.5) -> None:
    """丢掉握手阶段的 ready 帧等，避免后面误判。"""
    try:
        while True:
            await asyncio.wait_for(ws.recv(), timeout=seconds)
    except Exception:  # noqa: BLE001
        return


async def wait_for(ws, kind: str, timeout: float = 12.0) -> dict | None:
    """等一个指定 type 的帧（跳过其它的）。"""
    try:
        while True:
            frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
            if frame.get("type") == kind:
                return frame
    except Exception as exc:  # noqa: BLE001
        bad(f"等待 {kind} 帧超时/失败：{exc}")
        return None



async def part2(call, admin_token, dana_token, dana_id, admin_ws, dana_ws) -> None:
    """私信：发送 → 越权保护 → 本人撤回 → 对端实时帧 → 历史不带原文。"""
    stamp = int(__import__("time").time())
    status, conv = call("/chat/conversations", "POST", {"peer_id": dana_id}, token=admin_token)
    conv_id = None
    if isinstance(conv, dict):
        conv_id = conv.get("id") or (conv.get("conversation") or {}).get("id")
    if status not in (200, 201) or not conv_id:
        bad(f"开启会话失败：HTTP {status} {conv}")
        return
    ok(f"会话就绪：{conv_id}")

    status, created = call(
        f"/chat/conversations/{conv_id}/messages",
        "POST",
        {"body": "这条马上会被撤回（E2E）", "client_id": f"e2e-recall-{stamp}-1"},
        token=admin_token,
    )
    message_id = (created.get("sent") or {}).get("id") if isinstance(created, dict) else None
    if not message_id:
        bad(f"发消息失败：HTTP {status} {created}")
        return
    ok(f"发送成功：{message_id}")

    status, created2 = call(
        f"/chat/conversations/{conv_id}/messages",
        "POST",
        {"body": "这条不该被别人删掉", "client_id": f"e2e-recall-{stamp}-2"},
        token=admin_token,
    )
    other_id = (created2.get("sent") or {}).get("id") if isinstance(created2, dict) else None

    if other_id:
        status, res = call(f"/chat/messages/{other_id}", "DELETE", token=dana_token)
        if status == 403:
            ok("越权删除别人的消息 → 403（拒绝）")
        else:
            bad(f"越权删除未被拒绝：HTTP {status} {res}")

    status, res = call(f"/chat/messages/{message_id}", "DELETE", token=admin_token)
    if status == 200 and isinstance(res, dict) and res.get("deleted_by") == "user":
        ok("本人撤回 → 200（deleted_by=user）")
    else:
        bad(f"撤回失败：HTTP {status} {res}")

    frame = await wait_for(dana_ws, "message-deleted", timeout=10)
    if frame and frame.get("message_id") == message_id and frame.get("deleted_by") == "user":
        ok("对端**实时**收到 message-deleted 帧（气泡立刻变灰，不用刷新）")
    else:
        bad(f"对端没收到正确的 message-deleted 帧：{frame}")

    status, page = call(f"/chat/conversations/{conv_id}/messages?limit=20", token=dana_token)
    items = page.get("items", []) if isinstance(page, dict) else []
    target = next((m for m in items if m.get("id") == message_id), None)
    if target is None:
        bad("撤回的消息从历史里消失了（两端时间线不一致、往上翻会跳号）")
    elif target.get("is_deleted") and not target.get("body") and not target.get("media_urls"):
        ok("历史里撤回的消息：is_deleted=true 且 body/media 为空（读不到原文）")
    else:
        bad(f"撤回的消息仍带正文：{target}")

    status, res = call(f"/chat/messages/{message_id}", "DELETE", token=admin_token)
    if status == 404:
        ok("重复撤回 → 404（不静默成功）")
    else:
        bad(f"重复撤回返回 HTTP {status}（应为 404）")


def track_broadcast(res: object, payload: dict | None) -> None:
    """记下本轮新建的广播 id（结束时统一下线）。"""
    row_id = res.get("id") if isinstance(res, dict) else None
    if not row_id and isinstance(payload, dict):
        row_id = payload.get("id")
    if row_id:
        CREATED_BROADCAST_IDS.append(str(row_id))


def admin_login() -> object | None:
    """登录 SQLAdmin，返回带会话 cookie 的 opener（用于下线测试广播）。

    没有"删除广播"的 REST 接口（广播只在后台管理），所以走后台自己的动作路由：
    `GET /admin/<identity>/action/<slug>?pks=...` —— SQLAdmin 的自定义 action 就是 GET。
    """
    import http.cookiejar

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    body = urllib.parse.urlencode(
        {"username": ADMIN_USER, "password": ADMIN_PASSWORD}
    ).encode()
    req = urllib.request.Request(
        f"{SITE}/admin/login",
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with opener.open(req, timeout=30):
            pass
    except urllib.error.HTTPError as exc:
        bad(f"后台登录失败：HTTP {exc.code}（检查 KAZNU_ADMIN_USER / KAZNU_ADMIN_PASSWORD）")
        return None
    if not list(jar):
        bad("后台登录成功但没拿到会话 cookie")
        return None
    return opener


def cleanup_test_broadcasts(ids: list[str]) -> None:
    """把本轮 E2E 造的广播**下线**（`is_active=0`），全校设备顶部不再出现测试横幅。

    为什么用下线而不是删行：管理端本来就有「🔕 Deactivate」动作（删除留给人工，留审计痕迹）；
    而 App 的横幅（`/notifications/latest`）与通知列表**都只返回 `is_active=true`**，
    所以下线 == 用户看不到。

    为什么必须做：每次跑 E2E 都会给**全校每一台设备**推一条 "E2E 广播 A/B"，
    用户看到的"App 里有测试数据"就是这么来的（真机横幅 + 系统通知都到了）。
    """
    ids = [i for i in ids if i]
    if not ids:
        return
    opener = admin_login()
    if opener is None:
        bad(
            "无法登录后台清理测试广播，请手动下线（Global Notifications → 🔕 Deactivate）："
            f" pks={','.join(ids)}"
        )
        return

    url = (
        f"{SITE}/admin/global-notification/action/deactivate-notification"
        f"?pks={','.join(ids)}"
    )
    try:
        with opener.open(urllib.request.Request(url, method="GET"), timeout=30) as res:
            code = res.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    if code not in (200, 302):
        bad(f"下线测试广播失败：HTTP {code}（手动：{url}）")
        return

    status, latest = call("/notifications/latest")
    latest_id = latest.get("id") if isinstance(latest, dict) else None
    if latest_id in ids:
        bad(f"测试广播仍然生效（/notifications/latest = {latest_id}），请手动下线：{url}")
    else:
        ok(f"已下线 {len(ids)} 条 E2E 广播（真机顶部不再出现测试横幅）")


async def main() -> None:
    import websockets

    admin_token, admin_user = login("superadmin@student.kaznu.kz")
    dana_token, dana_user = login("demo.dana@student.kaznu.kz")
    print(f"1) 登录 OK：admin={admin_user.get('role')} / dana={dana_user.get('id')}", flush=True)

    async with (
        websockets.connect(f"{WS}?token={admin_token}", open_timeout=20) as admin_ws,
        websockets.connect(f"{WS}?token={dana_token}", open_timeout=20) as dana_ws,
    ):
        await drain(admin_ws)
        await drain(dana_ws)
        ok("真 WebSocket 建连成功（admin + 学生各一条）")

        frame_a, (status_a, res_a) = await asyncio.gather(
            wait_for(dana_ws, "broadcast", timeout=13),
            asyncio.to_thread(
                call,
                "/notifications/broadcast",
                "POST",
                {
                    "title": f"E2E 广播 A · {STAMP}",
                    "message": "验证 delivery_id（第一次）",
                    "level": "info",
                },
                admin_token,
            ),
        )
        if status_a != 200:
            bad(f"POST /notifications/broadcast → HTTP {status_a} {res_a}")

        payload_a = (frame_a or {}).get("broadcast") or {}
        track_broadcast(res_a, payload_a)
        delivery_a, pushed_a = payload_a.get("delivery_id"), payload_a.get("pushed_at")
        if delivery_a and pushed_a:
            ok(f"学生对端**实时**收到广播帧：delivery_id={delivery_a}")
        else:
            bad(f"广播帧内容不对：{frame_a}")

        status, latest = call("/notifications/latest")
        if status == 200 and latest.get("pushed_at"):
            ok("GET /notifications/latest 带 pushed_at（App 45s 轮询的去重依据）")
        else:
            bad(f"/notifications/latest 缺 pushed_at：HTTP {status} {latest}")

        frame_b, (status_b, res_b) = await asyncio.gather(
            wait_for(dana_ws, "broadcast", timeout=13),
            asyncio.to_thread(
                call,
                "/notifications/broadcast",
                "POST",
                {"title": f"E2E 广播 B · {STAMP}", "message": "第二条", "level": "info"},
                admin_token,
            ),
        )
        payload_b = (frame_b or {}).get("broadcast") or {}
        track_broadcast(res_b, payload_b)
        delivery_b = payload_b.get("delivery_id")
        if status_b != 200:
            bad(f"第二条广播失败：HTTP {status_b} {res_b}")
        elif delivery_a and delivery_b and delivery_a != delivery_b:
            ok("第二条广播拿到**新的** delivery_id（App 会再次弹窗 + 响铃）")
        else:
            bad(f"两条广播 delivery_id 相同：{delivery_a} / {delivery_b}")

        await part2(call, admin_token, dana_token, dana_user["id"], admin_ws, dana_ws)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # noqa: BLE001
        bad(f"E2E 中断：{type(exc).__name__}: {exc}")
    finally:
        # 放在 finally：断言失败 / 中途抛错也要清理，否则真机上会留下 E2E 测试横幅
        cleanup_test_broadcasts(CREATED_BROADCAST_IDS)

    print("\n===== 线上 E2E 结论 =====", flush=True)
    if fails:
        print("\n".join(f"  [!!] {f}" for f in fails), flush=True)
        raise SystemExit(1)
    print("  全部通过", flush=True)
