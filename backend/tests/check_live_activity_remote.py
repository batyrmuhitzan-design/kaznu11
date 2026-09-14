"""线上 Live Activity 部署自检（**服务器专用**，只读）。

本文件与 `check_live_activity_api.py` / `check_live_activity_contract.py` 不同：
那两个是本地单元测试（无需 Postgres、不碰线上），本文件用于**部署后**验证线上：

  1. 4 张新表是否随启动时的 create_all 建好；
  2. APNs 凭据状态（未配置时应 configured=false 且给出原因）；
  3. 调度一轮是否**优雅跳过**（无凭据时不能抛异常 / 500）。

用法（在服务器上，需先拉到含本文件的提交）：

    scp backend/tests/check_live_activity_remote.py kaznu:/tmp/check_remote.py
    ssh kaznu "cd /opt/kaznu11-main && python3 /tmp/check_remote.py"

可用 `KAZNU_APP_DIR` 覆盖应用目录（默认 `/opt/kaznu11-main`）。
"""
import asyncio
import os
import sqlite3
import sys

APP_DIR = os.environ.get("KAZNU_APP_DIR", "/opt/kaznu11-main")
if not os.path.isdir(APP_DIR):
    sys.exit(f"!! 找不到应用目录 {APP_DIR}（本脚本仅用于服务器部署自检）")

os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

WANT = [
    "user_lessons",
    "live_activity_registrations",
    "live_activity_sessions",
    "live_activity_push_log",
]

# ---------- 1) 新表是否随 create_all 建好 ----------
db = os.path.join(APP_DIR, "kaznu_helper.db")
print(f"=== 1) 数据库 {db} ===")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
names = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
for t in WANT:
    print(f"  {'[ok]' if t in names else '[!!]'} {t}")
missing = [t for t in WANT if t not in names]
if missing:
    print("  !! 缺失，实际含 lesson/live 的表：",
          [n for n in names if "lesson" in n or "live" in n])

# ---------- 2) 注入 backend/ 到 sys.path（与生产入口 main.py 完全一致） ----------
BACKEND_DIR = os.path.join(APP_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.apns import apns  # noqa: E402
from app.live_activity_scheduler import run_once, scheduler  # noqa: E402

print("=== 2) APNs 凭据状态 ===")
st = apns.status()
for k in sorted(st):
    print(f"  {k} = {st[k]}")

# ---------- 3) 调度一轮：无凭据要优雅跳过，不能 500 ----------

print("=== 3) 调度一轮（无凭据应优雅跳过）===")
try:
    res = asyncio.run(run_once())
except Exception as exc:  # noqa: BLE001
    print(f"  [!!] run_once 抛异常（不应该）：{type(exc).__name__}: {exc}")
else:
    for k in ("ok", "skipped", "reason", "configured", "planned", "sent"):
        if k in res:
            print(f"  {k} = {res[k]}")

print("=== 4) 调度器对象 ===")
print(f"  running = {scheduler.running}")

print("REMOTE_CHECK_DONE")
