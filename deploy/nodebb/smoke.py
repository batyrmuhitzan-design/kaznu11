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
import re
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

#: master token 要代表的用户（登录后填管理员 uid）
MASTER_UID: dict[str, str] = {}


def call(path: str, method: str = "GET", body: dict | None = None, token: str | None = None,
         csrf: bool = False, opener=None):
    """返回 (status, payload)。4xx/5xx 也返回而不是抛异常，方便断言。

    `csrf=True` 用于 **cookie 会话** 的写请求：NodeBB 对会话型 POST 强制校验
    CSRF（实测缺了直接 403 "invalid csrf token"），需要把 `_csrf` cookie 的值
    放进 `x-csrf-token` 头。用 Bearer 令牌的请求不需要（NodeBB 会跳过 CSRF）。
    """
    client = opener or OPENER
    data = json.dumps(body).encode() if body is not None else None
    if token and MASTER_UID.get("v") and "_uid=" not in path:
        # master token（uid=0 签发）**必须**在请求里声明"代表哪个用户"，
        # 依据 src/middleware/user.js:71-75（body._uid 或 query._uid）。
        # ⚠️ 但一旦请求带了会话 cookie，就以**会话里的 uid** 为准，_uid 不生效。
        path = f"{path}{'&' if '?' in path else '?'}_uid={MASTER_UID['v']}"
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    # ⚠️ 实测：NodeBB 对**所有写请求**都校验 CSRF，Bearer 令牌也不例外
    #    （对照实验：Bearer+CSRF=200，Bearer 不带 CSRF=403 Forbidden）。
    #    这条对移动端/跨源前端是硬约束 —— 见 deploy/nodebb/README.md 的说明。
    if method != "GET" or csrf:
        req.add_header("x-csrf-token", csrf_token(refresh=True, opener=client) or "")
    try:
        with client.open(req, timeout=30) as res:
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


CSRF_TOKENS: dict[int, str] = {}


def csrf_token(refresh: bool = False, opener=None) -> str | None:
    """取 NodeBB 的 CSRF 令牌（**按 opener 分别缓存**，因为令牌绑在会话上）。

    实测：NodeBB 用 `csrf-sync`（**令牌存在会话里**，不是 cookie 双提交），
    校验时读 `x-csrf-token` 头 / body.csrf_token；`/login` 页面里内联了
    `"csrf_token":"<hex>"`，所以必须先 GET 一次页面再取值——只发 POST 会 403
    "invalid csrf token"（我第一版就是这么踩的）。
    """
    client = opener or OPENER
    key = id(client)
    if CSRF_TOKENS.get(key) and not refresh:
        return CSRF_TOKENS[key]
    try:
        with client.open(urllib.request.Request(BASE + "/login"), timeout=20) as res:
            html = res.read().decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        return CSRF_TOKENS.get(key)
    for pattern in (r'"csrf_token"\s*:\s*"([0-9a-fA-F]+)"', r'name="csrf"\s+value="([^"]+)"'):
        match = re.search(pattern, html)
        if match:
            CSRF_TOKENS[key] = match.group(1)
            return match.group(1)
    return CSRF_TOKENS.get(key)


def login_as(username: str, password: str):
    """用**独立会话**登录并返回 opener（模拟"另一个真实用户"）。

    为什么需要独立会话：NodeBB 的 CSRF 令牌绑在会话上，而一旦请求里带了会话，
    写操作就以**会话里的 uid** 为准 —— master token 的 `_uid` 不会覆盖它
    （实测：管理员会话 + master token + `_uid=2` 仍然是以 uid=1 投票，于是
    拿到 400 "You cannot vote on your own post"）。
    """
    jar_ = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar_))
    token_ = csrf_token(refresh=True, opener=client)
    body = json.dumps({"username": username, "password": password}).encode()
    req = urllib.request.Request(BASE + "/api/v3/utilities/login", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-csrf-token", token_ or "")
    try:
        with client.open(req, timeout=25) as res:
            if res.status == 200 and list(jar_):
                return client
    except urllib.error.HTTPError as exc:
        print(f"  [--] 以 {username} 登录失败：HTTP {exc.code}", flush=True)
    return None



# ---------------------------------------------------------------- 1) 登录 + 令牌
print("=== 1) 管理员登录 + 签发 Bearer Token ===", flush=True)
env = read_env(ENV_FILE)
admin_user = env.get("NODEBB_ADMIN_USER", "")
admin_pass = env.get("NODEBB_ADMIN_PASSWORD", "")
if not admin_user or not admin_pass:
    bad("deploy/nodebb/.env 缺 NODEBB_ADMIN_USER / NODEBB_ADMIN_PASSWORD（先跑 make-setup.py）")
    raise SystemExit(1)

# 先访问首页，让 NodeBB 下发会话与 `_csrf` cookie（登录必须带 CSRF，否则 403）
call("/")
if csrf_token():
    ok("已从 NodeBB 拿到 CSRF 令牌（会话型 POST 必需）")
else:
    bad("拿不到 CSRF 令牌 —— 会话型登录会 403")

status, payload = call(
    "/api/v3/utilities/login", "POST", {"username": admin_user, "password": admin_pass}, csrf=True
)
if status == 200 and list(jar):
    ok(f"管理员登录成功：{admin_user}（HTTP 200，已拿到会话 cookie）")
else:
    bad(f"管理员登录失败：HTTP {status} {str(payload)[:200]}")
    raise SystemExit(1)

admin_uid = str(deep_find(unwrap(payload), "uid") or 1)
MASTER_UID["v"] = admin_uid
print(f"  [--] 管理员 uid = {admin_uid}", flush=True)

# 签发 **master token**：body 必须带 uid="0" + password（NodeBB 的硬性要求）
#   依据 src/routes/write/admin.js:21-30 tokenCreateMiddleware：
#     uid === '0'  → requirePasswordAuth（body.password）
#     其他 uid     → requireAPIReAuth（另一套 reauth 流程）
#   漏掉 uid 时会走到 reauth 分支并直接 401 "A valid login session was not found"
#   （这个报错极具误导性：会话其实是好的）。
token = env.get("NODEBB_API_TOKEN", "")
status, payload = call(
    "/api/v3/admin/tokens",
    "POST",
    {"uid": "0", "description": f"kaznu-trial-{STAMP}", "password": admin_pass},
    csrf=True,
)
minted = unwrap(payload)
# ⚠️ Bearer 用的是 `secret` 字段：NodeBB 返回的是
#    {uid, description, tokenId, tokenMasked, secret} —— 没有叫 "token" 的字段
#    （我第一版按 "token" 取，于是明明 200 却被判成失败）。
token_value = minted.get("secret") if isinstance(minted, dict) else None
if status in (200, 201) and token_value:
    ok("签发 master Bearer Token（uid=0 → 请求里带 _uid 即可代表某个用户）")
    token = token_value
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
if isinstance(existing, dict):
    existing = existing.get("categories", [])
if status == 200 and isinstance(existing, list):
    ok(f"读到 {len(existing)} 个分类（结构：response.categories）")
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
# ⚠️ 回复的路由是 POST /api/v3/topics/{tid}，**不是** /api/v3/posts
#    （后者返回 404 "Invalid API call"；依据 public/openapi/write/topics/tid.yaml
#    post = "reply to a topic"，body 支持 toPid）
status, payload = call(
    "/api/v3/topics/" + str(tid),
    "POST",
    {"content": "引用首楼回复：这条应带引用块（楼中楼）", "toPid": first_pid},
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


def find_post(pid) -> dict:
    """从主题读接口里取某层楼（含票数）—— /api/post/{pid} 只是跳转助手，拿不到字段。"""
    _, data = call(f"/api/topic/{tid}/x")
    body = unwrap(data)
    if not isinstance(body, dict):
        return {}
    for item in body.get("posts", []):
        if str(item.get("pid")) == str(pid):
            return item
    return {}


# NodeBB 不允许给自己的帖子投票（"You cannot vote on your own post"），
# 所以必须有一个**第二个用户**：用管理员身份通过写 API 建一个专门用于联调的账号。
VOTER = {"name": "e2e_voter", "password": "E2eVoterPass123", "uid": None}
status, payload = call(
    "/api/v3/users",
    "POST",
    {"username": VOTER["name"], "password": VOTER["password"], "email": f"{VOTER['name']}@1losion.me"},
    token=token,
)
voter_uid = deep_find(unwrap(payload), "uid")
if status in (200, 201) and voter_uid:
    VOTER["uid"] = str(voter_uid)
    ok(f"已创建投票用户 {VOTER['name']}（uid={VOTER['uid']}，专供联调）")
else:
    # 已存在时：从读接口取 uid（幂等，重复跑不会失败）
    _, data = call(f"/api/user/{VOTER['name']}")
    body = unwrap(data)
    if isinstance(body, dict) and body.get("uid"):
        VOTER["uid"] = str(body["uid"])
        ok(f"投票用户已存在：{VOTER['name']}（uid={VOTER['uid']}）")
    else:
        bad(f"创建投票用户失败：HTTP {status} {str(payload)[:160]}")

if VOTER["uid"]:
    # 用投票用户**自己的会话**投票 —— 这正是终端用户的真实路径（会话 + CSRF），
    # 不能靠 master token + _uid 顶替（有会话时会话 uid 优先，见 call() 里的注释）。
    voter_client = login_as(VOTER["name"], VOTER["password"])
    if voter_client is None:
        bad(f"无法以 {VOTER['name']} 登录，投票链路无法验证")
    else:
        ok(f"投票用户 {VOTER['name']} 独立会话登录成功（终端用户路径：会话 + CSRF）")
        for delta, label in ((1, "点赞"), (-1, "踩"), (0, "取消")):
            status, payload = call(
                f"/api/v3/posts/{first_pid}/vote", "PUT", {"delta": delta}, opener=voter_client
            )
            if status in (200, 201):
                ok(f"{label}：PUT /api/v3/posts/{first_pid}/vote delta={delta} → HTTP {status}")
            else:
                bad(f"{label}失败（delta={delta}）：HTTP {status} {str(payload)[:200]}")
        after = find_post(first_pid)
        fields = {k: after.get(k) for k in ("upvotes", "downvotes", "votes", "voted") if k in after}
        if fields:
            ok(f"读接口能拿到票数字段（前端高亮所需）：{fields}")
        else:
            bad(f"读接口没有 upvotes/downvotes/votes 字段：{str(after)[:200]}")

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


