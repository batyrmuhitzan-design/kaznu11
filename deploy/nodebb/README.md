# NodeBB 试跑栈（社区后端候选）

这个目录是 **Step 1（试跑）** 的全部产物：把 NodeBB + Redis 起在**与生产完全隔离**的
容器里，用证据确认「NodeBB 能不能支撑我们计划同步到前端的 6 个社区特性」。

## 为什么是这套隔离设计

这台 VPS 的事实（Step 0 实测）：**Ubuntu 24.04 / 2 vCPU / 内存 842MB / 可用仅 ~159MB / 无 swap**，
生产是 `systemd(kaznu-api, uvicorn) + SQLite`，80/443 由 **1Panel 的 openresty 容器**终结，
Docker 29.8.0 已装但**只有一个 openresty 容器在跑**。据此：

| 决定 | 原因 |
|---|---|
| 只绑 `127.0.0.1:4567` | 公网入口留给已有 openresty；**绝不启用 Caddy**（会抢 80/443，README 早已警告） |
| 独立 compose project `kaznu-nodebb` | 不与 1Panel 管理的容器/网络混用 |
| `mem_limit` 320m/160m | 内存超限死在**容器自己的 cgroup** 内，宿主 OOM killer 杀不到生产 |
| `OOMScoreAdjust=-500` 挂在 `kaznu-api.service` | 万不得已时，内核**最后**才考虑杀生产 API |
| Redis 当**主库**（不是 Mongo） | NodeBB 官方支持 Redis ≥7.2 作主库，常驻几十 MB；Mongo 要几百 MB，这台机器放不下 |
| Redis 不发布端口 | 数据只在 compose 内网可达；暂不设密码（如需再加 `requirepass`） |
| 数据全在具名 volume | `down -v` 即彻底回滚，**从不碰 `kaznu_helper.db`** |

内存账：生产自带约 93MB（uvicorn 83 + openresty 10），面板+Docker 守护进程约 280MB，
NodeBB+Redis 上限 480MB → 超出现有可用内存，所以先加 **2GB swap** 兜底（`server-prep.sh`），
**长期共存仍建议把 VPS 升到 2GB**。

## 使用（在服务器上，仓库根目录）

```bash
# 0) 一次性：加 swap + 生产 OOM 保护（幂等）
bash deploy/nodebb/server-prep.sh
cat /proc/$(systemctl show -p MainPID --value kaznu-api)/oom_score_adj   # 期望 -500

# 1) 配置（密码自己生成，别用弱口令）
#    模板叫 env.example（不带前导点）—— .gitignore 的 `.env*` 会吞掉 .env.example
cp -n deploy/nodebb/env.example deploy/nodebb/.env
openssl rand -base64 18        # 填进 NODEBB_ADMIN_PASSWORD
python3 deploy/nodebb/make-setup.py        # 生成 setup.json（含密码，0600，已 gitignore）

# 2) 起容器（首次会自动按 setup.json 安装）
docker compose -f deploy/nodebb/docker-compose.yml up -d
docker compose -f deploy/nodebb/docker-compose.yml logs -f nodebb

# 3) 试跑自检：分类 / 发帖 / 引用楼中楼 / 点赞踩 / 举报 / 搜索 + 签发 admin 令牌
python3 deploy/nodebb/smoke.py
```

试跑期只在回环地址上访问（本地看：`ssh -L 4567:127.0.0.1:4567 kaznu`，然后开 `http://127.0.0.1:4567`）。

## 回滚

```bash
docker compose -f deploy/nodebb/docker-compose.yml down -v   # 删容器 + 删 volume
bash -c 'swapoff /swapfile && sed -i "/swapfile/d" /etc/fstab && rm -f /swapfile'   # 若要连 swap 一起撤
```

## 将来挂子域名（Step 2 之后）

**推荐用 `forum.1losion.me` 子域名，不要挂 `/forum` 子路径** —— 我们上周在 `/app` 子路径
部署上踩过坑，NodeBB 对子路径同样敏感（URL 配置、上传链接、WebSocket 都要跟着改）。

```nginx
# 加进 1Panel 的 openresty 站点配置（不要动现有 1losion.me 的 server 块）
server {
    listen 443 ssl;
    server_name forum.1losion.me;
    # ... 证书由 1Panel 签发 ...
    location / {
        proxy_pass http://127.0.0.1:4567;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # NodeBB 实时通知必需
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
改完把 `NODEBB_URL` 改成 `https://forum.1losion.me`，然后
`docker compose -f deploy/nodebb/docker-compose.yml up -d nodebb`（URL 变了必须重建 config 才生效：
必要时 `docker compose ... exec nodebb ./nodebb config` 后重启）。

## 首次部署实际踩到的坑（都已在文件里修掉，留作前车之鉴）

| 现象 | 根因 | 修法 |
|---|---|---|
| 服务器上找不到模板文件 | 仓库 `.gitignore` 有 `.env*`，`.env.example` 被**静默忽略**（首次提交少了它） | 模板改名 `env.example`（与仓库既有 `deploy/env.example` 同约定） |
| 容器每 ~30s 重启一次（`restarts=29`，`exit=0`，但 `/opt/config/config.json` 始终不存在） | 官方镜像默认流程是「没有 config.json → 启动**浏览器安装向导**」，headless 无人可点 → 向导进程退出 → 重启循环 | 在 compose 里覆盖 `entrypoint`，显式走 CLI 非交互安装：`./nodebb setup --config=/opt/config/config.json "$(cat setup.json)"`（`src/cli/index.js:184` 支持位置参数 JSON） |
| 日志里 `EACCES: permission denied, access '/usr/src/app/setup.json'` | 容器以 `nodebb(uid 1001)` 运行，而 `setup.json` 是 root:root 0600 | `make-setup.py` 改为 `chown 1001:1001` + `0640`（非 root 时退回 0644） |
| `setup.js` 会把 config 写到 `/usr/src/app/config.json` | 不传 `--config` 时用的是 `paths.config`，不在任何卷上，**容器一重启就丢** | 安装与启动命令都显式带 `--config=/opt/config/config.json`（挂载在 `nodebb-config` 卷里） |
| healthcheck 永远不健康 | `node:lts-slim` 里**没有 wget/curl** | 换成 `node -e` 探活 |

## 已知边界（来自官方 OpenAPI 的实测核对）

| 能力 | 结论 |
|---|---|
| 点赞/踩/取消 | ✅ `PUT /api/v3/posts/{pid}/vote` `{delta: 1\|-1\|0}` |
| 举报 | ✅ `POST /api/v3/flags/` `{type:'post'\|'user', id, reason}` → ACP 审核队列 |
| 分类 / 标签 | ✅ `/api/v3/categories`、`/api/tags`、`/api/category/{cid}/{slug}` |
| 排序 / 搜索 | ✅ `/api/search`、`/api/popular`、`/api/top`、分类页 sort 参数 |
| 引用式楼中楼 | ✅ 回复带 `toPid`；**树状嵌套显示**不属核心，需主题/插件 |
| Markdown | ✅ 核心（composer 带预览） |
| **图片上传** | ⚠️ **不在 Write API**（`/api/v3/files/` 只有 DELETE）→ 计划**继续用 FastAPI 的 `/api/v1/uploads/image`** 拿 URL 再嵌进帖子 |
| 终端用户鉴权 | ⚠️ `/users/{uid}/tokens` **只能给自己签发**；因此 Step 2 必须做 SSO，不能由 FastAPI 用 admin 令牌替用户造令牌 |
| 匿名发帖 | ⚠️ NodeBB 帖子必须归属某个 uid（我们的 `is_anonymous` 隐私不变量需另行设计） |
