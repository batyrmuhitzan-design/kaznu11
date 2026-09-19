#!/usr/bin/env python3
"""由 `deploy/nodebb/.env` 生成 NodeBB 的 `setup.json`（首次安装用的答案文件）。

    python3 deploy/nodebb/make-setup.py

为什么要有这层：NodeBB 的 `setup.json` 里有**管理员密码和 secret**，
绝不能进仓库；而 compose 需要它被挂载进容器。所以：
  · 真实文件 .env / setup.json 都写在服务器上并被 .gitignore 挡住；
  · 本脚本可重复执行（幂等）：secret 只在缺失时生成一次，之后保持不变
    （secret 变了会让已登录会话全部失效）。

NodeBB 的 setup.json 有**两种**格式，别混（实测踩过）：
  · CLI 非交互安装（我们用这条）→ **nconf 扁平键**：`admin:username` / `redis:host` …
    依据：src/install.js:57 `NODEBB_ADMIN_USERNAME: 'admin:username'`、
          install/databases.js:24 `config['redis:host']`
  · 网页安装器的预填值 → `{"defaults": {"redis": {...}, "mongo": {...}}}`
    （镜像自带 install/docker/setup.json 就是这个形状）
本脚本按**扁平键**生成——因为我们是 headless CLI 安装；网页安装器读不到 defaults
只会"以空默认值继续"，不影响功能。
"""
from __future__ import annotations

import json
import os
import secrets
import stat
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
SETUP_FILE = HERE / "setup.json"

REQUIRED = ("NODEBB_ADMIN_USER", "NODEBB_ADMIN_PASSWORD", "NODEBB_ADMIN_EMAIL")


def read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def main() -> int:
    if not ENV_FILE.exists():
        print(f"❌ 缺少 {ENV_FILE.name}：先 cp -n env.example .env 并填管理员密码", file=sys.stderr)
        return 1

    env = read_env(ENV_FILE)

    missing = [k for k in REQUIRED if not env.get(k)]
    if missing:
        print(f"❌ .env 里这些必填项为空：{', '.join(missing)}", file=sys.stderr)
        print("   管理员密码请用 `openssl rand -base64 18` 生成，别用弱口令。", file=sys.stderr)
        return 1
    if len(env["NODEBB_ADMIN_PASSWORD"]) < 8:
        print("❌ NODEBB_ADMIN_PASSWORD 太短（<8），请换一个更长的", file=sys.stderr)
        return 1

    # secret 持久化：只生成一次，写回 .env，避免每次重装都让会话失效
    if not env.get("NODEBB_SECRET"):
        env["NODEBB_SECRET"] = secrets.token_hex(32)
        with ENV_FILE.open("a", encoding="utf-8") as handle:
            handle.write(f"\n# 由 make-setup.py 生成（改动它会让所有登录会话失效）\nNODEBB_SECRET={env['NODEBB_SECRET']}\n")
        print("  [ok] 已生成 NODEBB_SECRET 并写回 .env")
    else:
        print("  [ok] 复用 .env 里已有的 NODEBB_SECRET")

    setup = {
        "url": env.get("NODEBB_URL", "http://127.0.0.1:4567"),
        "secret": env["NODEBB_SECRET"],
        "database": "redis",
        # 服务名来自 docker-compose.yml（同一 compose 网络内解析）。
        # ⚠️ 必须用扁平键：install/databases.js 读的是 config['redis:host']
        "redis:host": "redis",
        "redis:port": 6379,
        "redis:database": 0,
        # ⚠️ 同理：src/install.js 读的是 'admin:username' 这类键，
        #    而且校验里要求 admin:password:confirm 存在
        "admin:username": env["NODEBB_ADMIN_USER"],
        "admin:password": env["NODEBB_ADMIN_PASSWORD"],
        "admin:password:confirm": env["NODEBB_ADMIN_PASSWORD"],
        "admin:email": env["NODEBB_ADMIN_EMAIL"],
    }

    SETUP_FILE.write_text(json.dumps(setup, indent=2) + "\n", encoding="utf-8")
    # 容器以 uid 1001(nodebb) 运行，必须能读到 setup.json —— 否则 NodeBB 会报
    # "EACCES: permission denied, access '/usr/src/app/setup.json'" 然后启动失败。
    # 所以：chown 给容器用户 + 0640（宿主上没有别的用户可以读）；非 root 时退回 0644。
    try:
        os.chown(SETUP_FILE, 1001, 1001)
        os.chmod(SETUP_FILE, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
        perms = "0640, owner=1001:1001（容器内 nodebb 用户可读）"
    except (PermissionError, OSError):
        os.chmod(SETUP_FILE, 0o644)
        perms = "0644（非 root，无法 chown 给容器用户）"

    print(f"  [ok] 已写出 {SETUP_FILE.name}（{perms}，已 gitignore）")
    print(f"       url={setup['url']}  database=redis  admin={setup['admin']['username']}")
    print("  下一步：docker compose -f deploy/nodebb/docker-compose.yml up -d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
