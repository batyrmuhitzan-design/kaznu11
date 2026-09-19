"""线上部署自检（**服务器专用**）：新列迁移 / 管理端私信审核视图 / `/app` 静态站是否换新。

为什么必须在服务器上跑：`pushed_at` 与 `deleted_by` 是**迁移补列**（`_ensure_*_columns`），
本地测试用临时库永远是新 schema，证明不了线上老库被正确 ALTER 过 ——
而这两个列缺失时，广播推送与撤回都会 500（这就是"真机点推送没反应"的一类根因）。

用法（在服务器上，需先拉到含本文件的提交）：

    scp backend/tests/check_live_server.py kaznu:/tmp/check_deploy.py
    ssh kaznu "python3 /tmp/check_deploy.py"

可用 `KAZNU_APP_DIR` 覆盖应用目录（默认 `/opt/kaznu11-main`）。
除一次后台登录（POST `/admin/login`）外全程只读；不写任何数据。

配套：本地侧的 `check_live_e2e.py` 负责"真 WebSocket + 真推送"的端到端验证。
"""
import json
import os
import sqlite3
import subprocess
import sys
import urllib.request

APP_DIR = os.environ.get("KAZNU_APP_DIR", "/opt/kaznu11-main")
os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)
sys.path.insert(0, os.path.join(APP_DIR, "backend"))

fails: list[str] = []


def ok(msg: str) -> None:
    print(f"  [ok] {msg}", flush=True)


def bad(msg: str) -> None:
    fails.append(msg)
    print(f"  [!!] {msg}", flush=True)


print("=== 1) 代码版本 ===", flush=True)
head = subprocess.run(
    ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
).stdout.strip()
print(f"  HEAD = {head}", flush=True)

print("=== 2) 迁移补列（老库 ALTER 是否真的执行过）===", flush=True)
con = sqlite3.connect(f"file:{os.path.join(APP_DIR, 'kaznu_helper.db')}?mode=ro", uri=True)
for table, column in (("global_notifications", "pushed_at"), ("messages", "deleted_by")):
    cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
    if column in cols:
        ok(f"{table}.{column} 存在")
    else:
        bad(f"{table}.{column} **不存在** —— 推送/撤回会直接 500")

pushed = con.execute(
    "select count(*) from global_notifications where pushed_at is not null"
).fetchone()[0]
recalled = con.execute("select count(*) from messages where is_deleted = 1").fetchone()[0]
print(f"  已推送过的广播 = {pushed} 条；已撤回私信 = {recalled} 条", flush=True)

print("=== 2b) 顶部横幅卫生（真机顶部显示的就是下面这条）===", flush=True)
import re  # noqa: E402
SITE = os.environ.get("KAZNU_SITE", "https://1losion.me").rstrip("/")
# 一键下线链接：与 check_live_e2e.py 清理走同一条后台动作路由（已实测可用）
DEACTIVATE = f"{SITE}/admin/global-notification/action/deactivate-notification?pks={{}}"

# 为什么查这个：广播是**所有人可见**的，联调时留下的 '1111' / '测试' / 'E2E 广播'
# 会像"App 里写死的数据"一样挂在每台设备最上面 —— 用户就是这么投诉的。
# 判据写得保守（只匹配"整条就是测试字样"或标题以 test/demo/E2E 开头），避免误报真实公告。
JUNK_PATTERNS = (
    re.compile(r"^\s*\d{1,6}\s*$"),  # '11' / '1111'
    re.compile(r"^\s*(测试|test|demo|e2e|asdf|qwerty)\b", re.IGNORECASE),
    re.compile(r"(广播测试|测试广播|勿删|不要删)", re.IGNORECASE),
    re.compile(r"\be2e\b", re.IGNORECASE),
)
active_rows = con.execute(
    "select id, title, message, created_at, pushed_at from global_notifications"
    " where is_active = 1 order by created_at desc"
).fetchall()
if not active_rows:
    ok("当前没有任何生效的全校通知（真机不显示横幅）")
else:
    top = active_rows[0]
    print(f"  最新生效通知：{top[1]!r}（{top[3]}）", flush=True)
for row in active_rows:
    blob = f"{row[1] or ''} {row[2] or ''}"
    hit = next((p.pattern for p in JUNK_PATTERNS if p.search(blob)), None)
    if hit:
        bad(
            f"真机横幅上是**测试数据**：{row[1]!r}（id={row[0]}）"
            f" —— 一键下线：{DEACTIVATE.format(row[0])}（或后台勾选 → 🔕 Deactivate）"
        )
residue = con.execute(
    "select count(*) from global_notifications where is_active = 0"
).fetchone()[0]
if residue:
    print(f"  已停用的历史记录 = {residue} 条（不影响真机，可在后台清理）", flush=True)

print("=== 3) 管理端视图（打真实 HTTP：登录后看 list 页是否 200）===", flush=True)
import http.cookiejar  # noqa: E402
import re  # noqa: E402
import urllib.error  # noqa: E402
import urllib.parse  # noqa: E402


def env_value(key: str, path: str = "/opt/kaznu11-main/.env") -> str | None:
    """从服务器 .env 取值。"""
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        return None
    return None


# 后台账号从**数据库**取（`.env` 里不一定有 SUPER_ADMIN_USERNAME —— 实测线上就没有），
# 密码按 admin_ui 的规则：settings.super_admin_password or settings.demo_password，
# 默认 123456。写死一组凭据会让"登录失败"悄悄退化成"所有 list 都是未登录 302"。
staff_rows = con.execute(
    "select univer_username, role from users where role in ('super_admin','admin')"
    " order by role desc, univer_username"
).fetchall()
print(f"  库里可登录后台的账号：{staff_rows}", flush=True)
candidates = [
    (row[0], pwd)
    for row in staff_rows
    for pwd in (
        env_value("SUPER_ADMIN_PASSWORD"),
        env_value("DEMO_PASSWORD"),
        "123456",
    )
    if pwd
]

# 关掉自动跟随重定向：未登录时 SQLAdmin 会 302 到登录页，
# 一旦跟随，任何路径都会变成 200，断言就失去意义。
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect())

logged_in = False
for username, password in candidates:
    try:
        body = urllib.parse.urlencode({"username": username, "password": password}).encode()
        with opener.open(
            urllib.request.Request(
                "http://127.0.0.1:8000/admin/login", data=body, method="POST"
            ),
            timeout=20,
        ) as res:
            if res.status in (200, 302, 303):
                ok(f"管理后台登录成功：{username}（HTTP {res.status}）")
                logged_in = True
                break
    except urllib.error.HTTPError as exc:
        # ⚠️ 禁用了自动重定向后，**登录成功**的 302 也会以 HTTPError 形式抛出来 ——
        #    一开始这里把 302 打印成"凭据不对"，于是明明登录成功了却报"拿不到会话"。
        if exc.code in (302, 303, 307, 308):
            ok(f"管理后台登录成功：{username}（HTTP {exc.code}，已拿到会话 cookie）")
            logged_in = True
            break
        print(f"  [--] {username} 登录返回 HTTP {exc.code}（400 = 凭据不对）", flush=True)
    except Exception as exc:  # noqa: BLE001
        bad(f"{username} 登录请求失败：{exc}")
        break

if not logged_in:
    bad("拿不到管理后台会话 —— 下面的 list 页断言会全部失效（302）")


def code(url: str) -> int:
    try:
        with opener.open(url, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as http_exc:
        return http_exc.code
    except Exception as exc:  # noqa: BLE001
        bad(f"{url} 请求失败：{exc}")
        return 0


for path, label in (
    ("/admin/message/list", "私信内容审核（Message）"),
    ("/admin/global-notification/list", "全校通知"),
    ("/admin/post-comment/list", "校园墙评论"),
):
    status = code(f"http://127.0.0.1:8000{path}")
    if status == 200:
        ok(f"{path} → 200（{label}）")
    else:
        bad(f"{path} → {status}（{label} **没挂上**）")

control = code("http://127.0.0.1:8000/admin/definitely-not-a-view/list")
if control == 404:
    ok("对照视图 → 404（断言有效）")
else:
    bad(f"对照视图返回 {control} —— 断言不可信（200 说明未登录被重定向了）")

print("=== 4) 线上 /app 静态站 ===", flush=True)
with urllib.request.urlopen("http://127.0.0.1:8000/app/", timeout=15) as res:
    html = res.read().decode()
# 按 HTML 里**真实引用**取资源（之前用 split('="') 切，切出了 HTML 片段，纯粹是脚本 bug）
assets = [a for a in re.findall(r'(?:src|href)="([^"]+)"', html) if not a.startswith(("http", "data:"))]
print(f"  index.html 引用：{assets}", flush=True)
relative = [a for a in assets if not a.startswith("/")]  # 子路径部署下应当是 ./xxx
if relative:
    ok(f"资源是相对路径（子路径部署必需）：{relative}")
else:
    bad("资源不是相对路径 —— 挂在 /app/ 下会 404")
for asset in relative:
    url = "http://127.0.0.1:8000/app/" + asset.removeprefix("./")
    status = code(url)
    if status == 200:
        ok(f"{asset} → 200")
    else:
        bad(f"{asset} → {status}")

print("=== 5) 站内版本信息 ===", flush=True)
try:
    with urllib.request.urlopen("http://127.0.0.1:8000/app/version.json", timeout=10) as res:
        print(f"  version.json = {json.loads(res.read().decode())}", flush=True)
except Exception as exc:  # noqa: BLE001
    bad(f"version.json 读取失败：{exc}")

print("=== 6) 服务状态 ===", flush=True)
active = subprocess.run(
    ["systemctl", "is-active", "kaznu-api"], capture_output=True, text=True, check=False
).stdout.strip()
print(f"  kaznu-api = {active}", flush=True)
if active != "active":
    bad("kaznu-api 不是 active")

print("\n===== 结论 =====", flush=True)
if fails:
    print("\n".join(f"  [!!] {f}" for f in fails), flush=True)
    raise SystemExit(1)
print("  全部通过", flush=True)
