#!/usr/bin/env python3
"""NodeBB 试跑自检：分类 / 发帖 / 引用式楼中楼 / 点赞踩 / 举报 / 搜索，并顺带签发 Bearer Token。

    python3 deploy/nodebb/smoke.py                    # 默认打 http://127.0.0.1:4567
    NODEBB_BASE=https://forum.1losion.me python3 deploy/nodebb/smoke.py

为什么要有它：Step 1 的目的是**用证据确认"NodeBB 的这 6 个特性真能用 API 驱动"**，
而不是"容器起来了就算成功"。这些断言直接对应前端要接的 6 个 UI 能力：
  1) 分类筛选    -> GET  /api/v3/categories
  2) 发帖        -> POST /api/v3/topics
  3) 楼中楼/引用 -> POST /api/v3/posts 带 toPid
  4) 点赞/踩     -> PUT  /api/v3/posts/{pid}/vote {delta:1|-1|0}，再用读接口核对计数
  5) 举报        -> POST /api/v3/flags/ {type:'post', id, reason}
  6) 搜索        -> GET  /api/search?term=...

副作用（都可控）：
  · 建 3 个分类（选课交流 / 二手交易 / 吐槽区）+ 1 个主题 + 1 条引用回复；
  · 调 POST /api/v3/admin/tokens 签发 admin Bearer Token，写回 deploy/nodebb/.env
    的 NODEBB_API_TOKEN（该文件已 gitignore）。
  ⚠️ 这是 **admin 令牌**，只用于 Step 1/2 联调；终端用户必须用"每人自己的令牌"
     （官方限制：/users/{uid}/tokens 只能给自己签发）。
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
BASE = os.environ.get("NODEBB_BASE", "http://127.0.0.1:4567").rstrip("/")

CATEGORIES = ("选课交流", "二手交易", "吐槽区")
STAMP = str(int(time.time()))

fails: list[str] = []


def ok(msg: str) -> None:
    print(f"  [ok] {msg}", flush=True)


def bad(msg: str) -> None:
    fails.append(msg)
    print(f"  [!!] {msg}", flush=True)


# ---------------------------------------------------------------- 基础工具
def read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def unwrap(data):
    """NodeBB 统一包一层 {status, response}；这里剥掉它。"""
    if isinstance(data, dict) and "response" in data:
        return data["response"]
    return data


def deep_find(obj, key: str):
    """在嵌套 JSON 里找第一个同名 key —— NodeBB 各版本返回结构略有差异。"""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for value in obj.values():
            found = deep_find(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = deep_find(item, key)
            if found is not None:
                return found
    return None


jar = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(path: str, method: str = "GET", body: dict | None = None, token: str | None = None):
    """返回 (status, payload)。4xx/5xx 也返回而不是抛异常，方便断言。"""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with OPENER.open(req, timeout=30) as res:
            raw = res.read().decode() or "null"
            try:
                return res.status, json.loads(raw)
            except json.JSONDecodeError:
                return res.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw or "null")
        except json.JSONDecodeError:
            return exc.code, raw


def save_token(token: str) -> None:
    """把令牌写回 .env（幂等替换），供 Step 2/3 复用。"""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    out = [ln for ln in lines if not ln.strip().startswith("NODEBB_API_TOKEN=")]
    out.append(f"NODEBB_API_TOKEN={token}")
    ENV_FILE.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"  [ok] 令牌已写入 {ENV_FILE.name}（NODEBB_API_TOKEN，已 gitignore）")


# ---------------------------------------------------------------- 1) 登录 + 令牌
print("=== 1) 管理员登录 + 签发 Bearer Token ===", flush=True)
env = read_env(ENV_FILE)
admin_user = env.get("NODEBB_ADMIN_USER", "")
admin_pass = env.get("NODEBB_ADMIN_PASSWORD", "")
if not admin_user or not admin_pass:
    bad("deploy/nodebb/.env 缺 NODEBB_ADMIN_USER / NODEBB_ADMIN_PASSWORD（先跑 make-setup.py）")
    raise SystemExit(1)

status, payload = call(
    "/api/v3/utilities/login", "POST", {"username": admin_user, "password": admin_pass}
)
if status == 200 and list(jar):
    ok(f"管理员登录成功：{admin_user}（HTTP 200，已拿到会话 cookie）")
else:
    bad(f"管理员登录失败：HTTP {status} {str(payload)[:200]}")
    raise SystemExit(1)

token = env.get("NODEBB_API_TOKEN", "")
status, payload = call("/api/v3/admin/tokens", "POST", {"description": f"kaznu-trial-{STAMP}"})
minted = deep_find(unwrap(payload), "token")
if status in (200, 201) and minted:
    ok("签发 admin Bearer Token（仅用于联调，终端用户需各自的令牌）")
    token = minted
    save_token(token)
else:
    bad(f"签发令牌失败：HTTP {status} {str(payload)[:200]}")
    if not token:
        raise SystemExit(1)
    print("  [--] 回退使用 .env 里已有的 NODEBB_API_TOKEN", flush=True)

# ---------------------------------------------------------------- 2) 分类
print("=== 2) 分类（前端「分类筛选栏」的数据源）===", flush=True)
status, payload = call("/api/v3/categories", token=token)
existing = unwrap(payload)
if status == 200 and isinstance(existing, list):
    ok(f"读到 {len(existing)} 个分类")
else:
    bad(f"读取分类失败：HTTP {status} {str(payload)[:200]}")
    existing = []

by_name = {c.get("name"): c.get("cid") for c in existing if isinstance(c, dict)}
for name in CATEGORIES:
    if name in by_name:
        ok(f"分类已存在：{name}（cid={by_name[name]}）")
        continue
    status, payload = call(
        "/api/v3/categories",
        "POST",
        {"name": name, "description": f"{name}（KazNU Helper 试跑分类）"},
        token=token,
    )
    cid = deep_find(unwrap(payload), "cid")
    if status in (200, 201) and cid:
        by_name[name] = cid
        ok(f"新建分类：{name}（cid={cid}）")
    else:
        bad(f"新建分类 {name} 失败：HTTP {status} {str(payload)[:200]}")

cid_ask = by_name.get("选课交流")
if not cid_ask:
    bad("拿不到「选课交流」的 cid，后续发帖无法继续")
    raise SystemExit(1)

# ---------------------------------------------------------------- 3) 发帖
print("=== 3) 发帖（写入侧 POST /api/v3/topics）===", flush=True)
status, payload = call(
    "/api/v3/topics",
    "POST",
    {
        "cid": cid_ask,
        "title": f"试跑：选课交流首帖 {STAMP}",
        "content": "这是 NodeBB 试跑帖。下面会验证**引用回复**、**点赞/踩**与**举报**链路。",
    },
    token=token,
)
tid = deep_find(unwrap(payload), "tid")
if status in (200, 201) and tid:
    ok(f"发帖成功：tid={tid}（topic 归入 cid={cid_ask}）")
else:
    bad(f"发帖失败：HTTP {status} {str(payload)[:200]}")
    raise SystemExit(1)

first_pid = deep_find(unwrap(payload), "pid")
if not first_pid:
    # 写入接口没回 pid 时，用读接口取该主题的楼层
    status, payload = call(f"/api/topic/{tid}/x")
    first_pid = deep_find(unwrap(payload), "pid")
if first_pid:
    ok(f"拿到首楼 pid={first_pid}")
else:
    bad("拿不到首楼 pid，引用/投票/举报无法继续")
    raise SystemExit(1)

# ---------------------------------------------------------------- 4) 楼中楼（引用）
print("=== 4) 引用式楼中楼（toPid）===", flush=True)
status, payload = call(
    "/api/v3/posts",
    "POST",
    {"tid": tid, "toPid": first_pid, "content": "引用首楼回复：这条应带引用块（楼中楼）"},
    token=token,
)
reply_pid = deep_find(unwrap(payload), "pid")
if status in (200, 201) and reply_pid:
    ok(f"引用回复成功：pid={reply_pid} → 引用 {first_pid}")
else:
    bad(f"引用回复失败：HTTP {status} {str(payload)[:200]}")

_, topic_data = call(f"/api/topic/{tid}/x")
topic_body = unwrap(topic_data)
posts = topic_body.get("posts", []) if isinstance(topic_body, dict) else []
quoted = [p for p in posts if str(p.get("toPid")) == str(first_pid)]
if quoted:
    ok(f"读接口确认引用关系：{len(quoted)} 条回复的 toPid={first_pid}（前端据此渲染引用块）")
else:
    bad(f"读接口看不到引用关系（toPid 未生效）：{str(posts)[:200]}")

# ---------------------------------------------------------------- 5) 点赞 / 踩
print("=== 5) 点赞 / 踩（vote delta）===", flush=True)


def vote_state(pid) -> dict:
    _, data = call(f"/api/post/{pid}/x")
    body = unwrap(data)
    if not isinstance(body, dict):
        return {}
    return {k: body.get(k) for k in ("upvotes", "downvotes", "votes")}


for delta, label in ((1, "点赞"), (-1, "踩"), (0, "取消")):
    status, payload = call(f"/api/v3/posts/{first_pid}/vote", "PUT", {"delta": delta}, token=token)
    if status in (200, 201):
        ok(f"{label}：PUT /api/v3/posts/{first_pid}/vote delta={delta} → HTTP {status}")
    else:
        bad(f"{label}失败（delta={delta}）：HTTP {status} {str(payload)[:200]}")

state = vote_state(first_pid)
if any(v is not None for v in state.values()):
    ok(f"读接口能拿到计数（前端高亮所需字段）：{state}")
else:
    bad(f"读接口没有 upvotes/downvotes 字段：{state}")

# ---------------------------------------------------------------- 6) 举报
print("=== 6) 举报（flag）===", flush=True)
flag_payload = {"type": "post", "id": int(first_pid), "reason": f"试跑举报链路 {STAMP}"}
status, payload = call("/api/v3/flags/", "POST", flag_payload, token=token)
if status == 404:
    status, payload = call("/api/v3/flags", "POST", flag_payload, token=token)
if status in (200, 201):
    ok("举报已提交（进入 NodeBB ACP 审核队列）")
else:
    bad(f"举报失败：HTTP {status} {str(payload)[:200]}")

# ---------------------------------------------------------------- 7) 搜索
print("=== 7) 搜索 ===", flush=True)
term = urllib.parse.quote(f"试跑：选课交流首帖 {STAMP}")
status, payload = call(f"/api/search?term={term}&in=titlesposts")
if status == 404:
    status, payload = call(f"/api/v3/search?term={term}")
body = unwrap(payload)
count = body.get("matchCount") if isinstance(body, dict) else None
if status == 200 and count:
    ok(f"搜索命中 {count} 条（term 精确到本轮时间戳，索引即时可用）")
elif status == 200:
    bad(f"搜索 200 但 matchCount={count}（可能尚未进索引，稍后重试）")
else:
    bad(f"搜索失败：HTTP {status} {str(payload)[:200]}")

# ---------------------------------------------------------------- 结论
print("\n===== 试跑结论 =====", flush=True)
if fails:
    print("\n".join(f"  [!!] {f}" for f in fails), flush=True)
    raise SystemExit(1)
print("  全部通过：6 个特性都能用 REST API 驱动，可进入 Step 2（身份打通）", flush=True)


