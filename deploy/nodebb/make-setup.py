#!/usr/bin/env python3
"""由 `deploy/nodebb/.env` 生成 NodeBB 的 `setup.json`（首次安装用的答案文件）。

    python3 deploy/nodebb/make-setup.py

为什么要有这层：NodeBB 的 `setup.json` 里有**管理员密码和 secret**，
绝不能进仓库；而 compose 需要它被挂载进容器。所以：
  · 真实文件 .env / setup.json 都写在服务器上并被 .gitignore 挡住；
  · 本脚本可重复执行（幂等）：secret 只在缺失时生成一次，之后保持不变
    （secret 变了会让已登录会话全部失效）。

NodeBB 官方 setup.json 结构（database=redis 时只需 redis 段）：
  {"url":..., "secret":..., "database":"redis", "redis":{...}, "admin":{...}}
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
        # 服务名来自 docker-compose.yml（同一 compose 网络内解析）
        "redis": {"host": "redis", "port": 6379, "database": 0},
        "admin": {
            "username": env["NODEBB_ADMIN_USER"],
            "password": env["NODEBB_ADMIN_PASSWORD"],
            "email": env["NODEBB_ADMIN_EMAIL"],
        },
    }

    SETUP_FILE.write_text(json.dumps(setup, indent=2) + "\n", encoding="utf-8")
    os.chmod(SETUP_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600：里面有明文密码

    print(f"  [ok] 已写出 {SETUP_FILE.name}（0600，已 gitignore）")
    print(f"       url={setup['url']}  database=redis  admin={setup['admin']['username']}")
    print("  下一步：docker compose -f deploy/nodebb/docker-compose.yml up -d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
