#!/usr/bin/env bash
# =====================================================================
# Phase A-2：启用 NodeBB 的 session-sharing（SSO）并写入共享密钥
#
#   bash deploy/nodebb/enable-sso.sh                  # 只装插件侧（不等 DNS）
#   bash deploy/nodebb/enable-sso.sh --enable-entry   # 同时打开 App 社区入口
#                                                    #（需 forum 子域已解析+证书）
#
# 为什么这么绕（都是实测踩出来的）：
#   · `./nodebb activate <plugin>` 在 v4.16 会误判"未安装"去起 Web 安装向导，
#     与运行中的论坛抢 4567 → EADDRINUSE。改用**官方写 API** 激活：
#     PUT /api/v3/admin/plugins/{id}/active（需 master token + _uid + CSRF）
#   · 插件设置存在 Redis 的 `settings:session-sharing` 哈希里；写完**要重启**
#     才生效（NodeBB 启动时把设置读进内存）。
# =====================================================================
set -uo pipefail
cd /opt/kaznu11-main/deploy/nodebb || exit 1
ENABLE_ENTRY="${1:-}"

echo "== 0) 生成/复用共享密钥 =="
if grep -qE '^COMMUNITY_SSO_SECRET=.+' .env 2>/dev/null; then
  SECRET=$(grep -E '^COMMUNITY_SSO_SECRET=' .env | head -1 | cut -d= -f2-)
  echo "  复用已有 COMMUNITY_SSO_SECRET（${#SECRET} 字符）"
else
  SECRET=$(openssl rand -hex 32)
  echo "COMMUNITY_SSO_SECRET=${SECRET}" >> .env
  echo "  已生成新密钥（写入 deploy/nodebb/.env，已 gitignore）"
fi

echo
echo "== 1) 激活插件（写 API）=="
python3 - <<'PY'
import http.cookiejar, json, re, urllib.error, urllib.request
from pathlib import Path

HERE = Path("/opt/kaznu11-main/deploy/nodebb")
env = {}
for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

BASE = "http://127.0.0.1:4567"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
CSRF = {"v": ""}


def csrf() -> str:
    with opener.open(urllib.request.Request(BASE + "/login"), timeout=20) as res:
        html = res.read().decode("utf-8", "ignore")
    m = re.search(r'"csrf_token"\s*:\s*"([0-9a-fA-F]+)"', html)
    CSRF["v"] = m.group(1) if m else ""
    return CSRF["v"]


body = json.dumps({"username": env["NODEBB_ADMIN_USER"], "password": env["NODEBB_ADMIN_PASSWORD"]}).encode()
req = urllib.request.Request(BASE + "/api/v3/utilities/login", data=body, method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("x-csrf-token", csrf())
with opener.open(req, timeout=25) as res:
    print("  登录：", res.status)

req = urllib.request.Request(
    BASE + "/api/v3/admin/plugins/nodebb-plugin-session-sharing/active?_uid=1",
    data=json.dumps({"active": True}).encode(),
    method="PUT",
)
req.add_header("Content-Type", "application/json")
req.add_header("x-csrf-token", csrf())
req.add_header("Authorization", "Bearer " + env.get("NODEBB_API_TOKEN", ""))
with opener.open(req, timeout=60) as res:
    print("  激活：", res.status, res.read().decode()[:100])
PY
ACTIVATED=$?

echo
echo "== 2) 关键顺序：先让插件的 2017 升级脚本在「无 secret」下跳过并记账 =="
echo "   插件 upgrades/session_sharing_hash_to_zset.js 的逻辑是："
echo "     settings.secret 为空 → 直接 return（视为升级完成）"
echo "     否则 getObject('<name>:uid') → 全新库里返回 null → Object.keys(null) 崩 → 容器重启循环"
echo "   （实测踩到：先写 secret 后重启，正好落进唯一没防护的分支）"
docker compose -f docker-compose.yml exec -T redis redis-cli DEL settings:session-sharing >/dev/null 2>&1
docker compose -f docker-compose.yml restart nodebb >/dev/null 2>&1
for i in $(seq 1 25); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4567/api/ 2>/dev/null)
  [ "$code" = "200" ] && { echo "   论坛已起来（第 $i 次探测）→ 升级脚本已跳过并记账"; break; }
  sleep 6
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4567/api/ 2>/dev/null)" != "200" ]; then
  echo "   [!!] 论坛仍未起来，请看：docker compose -f docker-compose.yml logs --tail=40 nodebb"
  exit 1
fi

echo
echo "== 2b) 停机构建（必须在容器停止状态跑 build，否则和运行中的实例抢 4567）=="
docker compose -f docker-compose.yml stop nodebb 2>&1 | tail -1
docker compose -f docker-compose.yml run --rm --no-deps --entrypoint sh nodebb \
  -c 'cd /usr/src/app && CONFIG=/opt/config/config.json ./nodebb build 2>&1 | tail -6'
docker compose -f docker-compose.yml start nodebb >/dev/null 2>&1
for i in $(seq 1 25); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4567/api/ 2>/dev/null)
  [ "$code" = "200" ] && { echo "  构建后论坛已恢复（第 $i 次探测）"; break; }
  sleep 6
done

echo
echo "== 3) 写入插件设置（secret / cookieName / behaviour）=="
docker compose -f docker-compose.yml exec -T redis redis-cli \
  HSET settings:session-sharing \
    secret "$SECRET" cookieName "token" behaviour "trust" \
    adminRevalidate "off" allowBannedUsers "off" >/dev/null
docker compose -f docker-compose.yml exec -T redis redis-cli HGETALL settings:session-sharing | paste - - | sed 's/^/  /'

echo
echo "== 4) 再重启一次 → 插件真正生效 =="
docker compose -f docker-compose.yml restart nodebb >/dev/null 2>&1
for i in $(seq 1 25); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:4567/api/ 2>/dev/null)
  [ "$code" = "200" ] && { echo "  论坛已恢复（第 $i 次探测）"; break; }
  sleep 6
done
docker compose -f docker-compose.yml ps --format '  {{.Name}} | {{.Status}}' 2>/dev/null


ROOT_ENV=/opt/kaznu11-main/.env
echo
if [ "$ENABLE_ENTRY" = "--enable-entry" ]; then
  echo "== 5) 打开社区入口（写 FastAPI 的 .env 并重启）=="
  touch "$ROOT_ENV"
  if grep -q '^COMMUNITY_FORUM_URL=' "$ROOT_ENV"; then
    sed -i 's|^COMMUNITY_FORUM_URL=.*|COMMUNITY_FORUM_URL=https://forum.1losion.me|' "$ROOT_ENV"
  else
    echo 'COMMUNITY_FORUM_URL=https://forum.1losion.me' >> "$ROOT_ENV"
  fi
  if grep -q '^COMMUNITY_SSO_SECRET=' "$ROOT_ENV"; then
    sed -i "s|^COMMUNITY_SSO_SECRET=.*|COMMUNITY_SSO_SECRET=${SECRET}|" "$ROOT_ENV"
  else
    echo "COMMUNITY_SSO_SECRET=${SECRET}" >> "$ROOT_ENV"
  fi
  systemctl restart kaznu-api
  sleep 4
  echo "  FastAPI 重启后 healthz：$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/healthz)"
else
  echo "== 4) 社区入口保持关闭 =="
  echo "  forum.1losion.me 尚无 DNS/证书；等解析好再执行：bash $0 --enable-entry"
fi

echo
echo "== 5) 自检：共享 JWT 能否自动登录（两步：先建会话，再验身份）+ 篡改反证 =="
python3 - "$SECRET" <<'PY'
import base64, hashlib, hmac, http.cookiejar, json, sys, time, urllib.error, urllib.request

SECRET = sys.argv[1]
BASE = "http://127.0.0.1:4567"
UID = f"verify-{int(time.time())}"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def jwt(payload: dict) -> str:
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + 600}
    seg = (
        f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())}."
        f"{b64(json.dumps(body, separators=(',', ':')).encode())}"
    )
    sig = hmac.new(SECRET.encode(), seg.encode(), hashlib.sha256).digest()
    return f"{seg}.{b64(sig)}"


def probe(token: str):
    """模拟真实浏览器：先请求页面（插件在此校验 JWT 并下发 NodeBB 会话），再带会话查 /api/self。

    只带 JWT 直接打 /api/self 会 401 —— 那不是故障，而是流程不对（实测踩到）。
    """
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.open(urllib.request.Request(BASE + "/", headers={"Cookie": f"token={token}"}), timeout=25).read()
    with opener.open(urllib.request.Request(BASE + "/api/self"), timeout=25) as res:
        return json.loads(res.read().decode())


token = jwt({"id": UID, "username": "kaznu_verify", "email": "verify@student.kaznu.kz"})
try:
    data = probe(token)
    if data.get("uid"):
        print("  [ok] 共享 JWT 被接受：uid=%s username=%s" % (data.get("uid"), data.get("username")))
    else:
        print("  [!!] 页面请求后仍未登录（/api/self 返回游客）")
        raise SystemExit(1)
except urllib.error.HTTPError as exc:
    print("  [!!] 共享 JWT 未被接受：HTTP", exc.code, exc.read().decode()[:200])
    raise SystemExit(1)

try:
    bad = probe((jwt({"id": UID, "username": "kaznu_verify"}))[:-4] + "0000")
    if not bad.get("uid"):
        print("  [ok] 签名被篡改的 JWT 不会登录（仍是游客）")
    else:
        print("  [!!] 篡改签名竟然也登录了 uid=%s" % bad.get("uid"))
        raise SystemExit(1)
except urllib.error.HTTPError as exc:
    print("  [ok] 签名被篡改的 JWT 被拒（HTTP %s）" % exc.code)
PY
echo "ENABLE_SSO_DONE"

