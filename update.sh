#!/usr/bin/env bash
# =====================================================================
# KazNU Helper — 一键更新 & 启动（统一域名 https://1losion.me）
#
# 用法（在服务器上执行）：
#   cd /opt/kaznu11 && bash update.sh            # 首次部署 / 直接启动
#   cd /opt/kaznu11 && bash update.sh update     # git pull 后再构建启动
# =====================================================================
set -euo pipefail

cd "$(dirname "$0")"
echo "==> 工作目录: $(pwd)"

# 1) 可选：从远端拉取最新代码
if [ "${1:-}" = "update" ]; then
  echo "==> git pull --ff-only"
  git pull --ff-only
fi

# 2) 确保 .env 存在（首次自动从模板生成）
if [ ! -f .env ]; then
  echo "==> 未发现 .env，从 deploy/env.example 生成"
  cp deploy/env.example .env
  echo "    ⚠️  请检查并修改 .env 中的密码/密钥后重新执行本脚本"
else
  echo "==> 使用已有 .env"
fi

# 3) 确保前端静态目录存在（deploy/www 有默认占位页）
mkdir -p deploy/www

# 4) 可选：如果服务器装有 Node，则用仓库前端源码构建静态站到 deploy/www
if command -v npm >/dev/null 2>&1 && [ -d node_modules ]; then
  echo "==> 检测到 Node 环境，构建前端静态文件（VITE_API_URL=$(grep '^VITE_API_URL=' .env | cut -d= -f2)）"
  npm run build >/dev/null
  rm -rf deploy/www/*
  cp -r dist/* deploy/www/
fi

# 5) 校验 docker 与 compose
command -v docker >/dev/null 2>&1 || { echo "❌ 未安装 docker"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ 请安装 docker compose v2"; exit 1; }

# 6) 构建并启动（Postgres + API + Caddy）
echo "==> docker compose up -d --build --remove-orphans"
docker compose up -d --build --remove-orphans

# 7) 等待 API 健康
echo "==> 等待 API 健康检查 ..."
for i in $(seq 1 30); do
  if docker compose exec -T api python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)" >/dev/null 2>&1; then
    echo "    API 健康 ✓ (第 ${i} 次探测)"
    break
  fi
  sleep 2
  [ "$i" = 30 ] && echo "    ⚠️ 等待超时，请看日志: docker compose logs api"
done

echo
echo "=============================================================="
echo "  站点      : https://1losion.me"
echo "  API 状态  : https://1losion.me/healthz"
echo "  API 文档  : https://1losion.me/docs"
echo "  管理后台  : https://1losion.me/admin"
echo "  超管账号  : admin@1losion.me"
echo "  超管密码  : admin123456  (临时，请尽快修改!)"
echo "=============================================================="
echo
echo "查看实时日志: docker compose logs -f api   (或 caddy / db)"
echo "停止服务    : docker compose down          (保留数据)"
echo "清库重启    : docker compose down -v       (删除数据库数据)"
