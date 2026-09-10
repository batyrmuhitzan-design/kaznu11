# KazNU Helper 2.0 beta — Backend (RateMyProf + Identity)

Test-build backend for **Professor & Course Ratings** plus the Univer account / display-name system.

## Stack
- Python 3.11+, FastAPI, **Async SQLAlchemy + PostgreSQL (asyncpg)**
- `python-dotenv` reads `.env` (see `.env.example`)
- `slowapi` rate limiting: login `5/minute`, review submission `2/minute`

## Quick start (Docker / local)
```bash
# 1) Local
python -m venv venv
venv/Scripts/activate            # Windows   |  source venv/bin/activate (macOS/Linux)
pip install -r requirements.txt
copy .env.example .env           # 或 cp
uvicorn main:app --reload --port 8000

# 2) Docker stack (PostgreSQL 16 + API) — Azure-style deploy
copy .env.example .env
docker compose up --build
```

> Deploying to Azure: put the app image on Azure Container Apps / Azure App Service with
> a Postgres `DATABASE_URL` env var — code needs no other change. Alembic can be added later.

## Smoke test (no Postgres needed)
```bash
python tests/smoke_test.py
```
Covers: seed catalog, search, anonimity invariants (no display name / hash in reviews),
Univer-shape login gate, auto display name, one-review-per-account enforcement, legacy endpoints.

## API surface (`/api/v1`)
| Method & path | Purpose | Privacy / safety |
|---|---|---|
| `POST /auth/login` | Univer-only login (student id / `@…kaznu.kz`), auto `user+7digits` name | `slowapi` 5/min |
| `GET/PATCH /me`, `/me/display-name`, `/me/department-tag` | read/change global display name & department label | bearer token |
| `GET /professors?q=` | search professors (with roll-up ratings) | public |
| `GET /professors/{id}` | detail + per-course stats | public |
| `GET /courses?q=` | search courses | public |
| `GET /reviews?professor_id=` | anonymized review feed | only `user_department_tag` shown |
| `GET /reviews/eligibility` | "already rated?" check for the account | private |
| `POST /reviews` | submit a rating | `slowapi` 2/min + one per account |
| `POST /reviews/{id}/like` | like a review | — |

## Anonymity design
- Reviews carry **only** a coarse `user_department_tag` (e.g. "Data Science Student").
  `global_display_name` is *never* returned by review endpoints.
- Duplicate/spam protection uses a server-side `anonymous_hash` (HMAC-SHA256 of the Univer
  account + a secret pepper). The raw hash is never sent to the client.
- `UniqueConstraint(professor_id, anonymous_hash)` makes one-rating-per-professor a DB guarantee.

## Demo Univer login
Default: any **Univer-shaped** student id / `@student.kaznu.kz` account logs in with any password
(`DEMO_ALL_PASSWORD=true`). Production: plug `backend/scraper.py` (Univer.kz) and set
`DEMO_ALL_PASSWORD=false` + `DEMO_PASSWORD`.

## Demo Univer login
Default: any **Univer-shaped** student id / `@student.kaznu.kz` account logs in with any password
(`DEMO_ALL_PASSWORD=true`). Production: plug `backend/scraper.py` (Univer.kz) and set
`DEMO_ALL_PASSWORD=false` + `DEMO_PASSWORD`.

## Admin panel & roles (SQLAdmin)
- Web 后台：**`/admin`**（浏览器打开）。首次启动会自动创建内置超管账号：
  `SUPER_ADMIN_USERNAME`（默认 `superadmin@student.kaznu.kz`，密码 = `DEMO_PASSWORD` 或 `SUPER_ADMIN_PASSWORD`）。
- 角色：`user`（学生）→ 可 `POST /api/v1/admin/apply` 提交管理员申请；
  `admin`（内容管理员）→ 管理 Reviews/Professors/Courses/Reports；
  `super_admin`（超管）→ `/api/v1/super-admin/*`（申请审批 + 用户封禁）以及 User / AdminApplication 面板。
- 封禁用户（`is_banned=true`）：历史 token 立即失效，所有受保护接口返回 403。

### 新增 API
| 方法 & 路径 | 权限 | 用途 |
|---|---|---|
| `POST /admin/apply` | 登录用户（role=user） | 提交管理员申请 |
| `GET /super-admin/applications?status=pending` | super_admin | 查看申请 |
| `POST /super-admin/applications/{id}/handle` | super_admin | approve/reject（approve 自动升 role=admin） |
| `POST /super-admin/users/{id}/ban` | super_admin | 封禁/解封 `{is_banned:true/false}` |
| `POST /reports` | 登录用户 | 匿名举报评价（后台 Reports 面板处理） |

> 环境变量：`SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`（见 `.env.example`）。
> 数据库兼容：启动时 `init_db` 会自动给旧 `users` 表补 `role` / `is_banned` 列。

---

## 统一入口挂载（线上 `uvicorn main:app` 用的就是这个）

仓库根目录的 **`main.py`** 是生产入口，它把这些能力挂到同一个 FastAPI 应用上：

| 路径 | 内容 |
|---|---|
| `/api/v1/*` | 评价系统 API：`auth` / `me` / `professors` / `courses` / `reviews` / `admin` / `super-admin` / `reports` |
| `/admin` | **SQLAdmin Web 管理后台**：Reviews 查看·编辑·删除、Reports 处理、Professors/Courses 维护；超管另有 Users 封禁、Admin Applications 审批 |
| `/docs` | Swagger UI（包含上面全部路由） |
| `/healthz` | 健康检查：`db_ready` + `admin` 路径（部署后先看它自证） |
| `/api/news`、`/api/schedule`、`/api/gpa` | 旧版兼容接口（1.3 App 仍在用） |
| `/api/v1/schedule`、`/api/v1/grades` | 1.0 原型接口（兼容保留，避免老客户端 404） |
| `/app` | 可选：`npm run build` 产物（存在 `dist/index.html` 时自动挂载，同源预览静态站） |

```bash
uvicorn main:app --host 0.0.0.0 --port 8000      # 入口
```

数据库策略：
- 生产建议 `DATABASE_URL=postgresql+asyncpg://…`（docker 栈已自动注入）；
- **未配置时自动退回本地 SQLite 文件 `kaznu_helper.db`**（零依赖即可跑通评价 + 管理后台）；
- 数据库连不上**不会阻塞启动**：`/docs`、`/admin` 登录页仍可访问，`/healthz` 会显示 `db_ready: false`，
  并在日志里打印当前 `DATABASE_URL` 便于排查。

### 部署 / 重启（服务器）
```bash
cd /opt/kaznu11                      # 仓库目录
git pull --ff-only
pip install -r requirements.txt      # 首次或依赖更新时（sqladmin / itsdangerous / aiosqlite 必需）
pkill -f 'uvicorn main:app' || true
nohup uvicorn main:app --host 127.0.0.1 --port 8000 >/var/log/kaznu-api.log 2>&1 &
```
- 用 systemd / aaPanel「Python 项目」托管时，把最后两行换成对应的 restart。
- 用仓库自带 docker 栈（Postgres + API + Caddy）：`bash update.sh update`。
  ⚠️ Caddy 会占用 80/443 —— 若服务器上已有 openresty/nginx，**不要同时启动 Caddy**，
  改用下面的反代片段把请求转发到 `127.0.0.1:8000`。

### openresty / nginx 反代片段（服务器已在用 openresty 时）
```nginx
location /api/           { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location /admin          { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location /docs           { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; }
location = /openapi.json { proxy_pass http://127.0.0.1:8000; }
location = /healthz      { proxy_pass http://127.0.0.1:8000; }
```
`location /admin` 是前缀匹配，已覆盖 `/admin/login`、`/admin/review/list` 等子路径与静态资源。

### 自检（本地也能跑，无需 Postgres）
```bash
python backend/tests/check_admin_mount.py     # 断言：/docs、全部评价/管理端路由、/admin、/healthz、旧接口、种子数据、/app
python backend/tests/smoke_test.py            # 原有业务冒烟（匿名性/一人一评/登录门禁）
```

### 线上验证
```bash
curl -s https://1losion.me/healthz            # 期望 {"status":"ok","db_ready":true,…,"admin":"/admin"}
curl -s https://1losion.me/openapi.json | grep -c '/api/v1/reviews'
```
浏览器打开 `https://1losion.me/docs`（应能看到 professors / courses / reviews / admin / super-admin / reports 分组）
与 `https://1losion.me/admin`（账号 `SUPER_ADMIN_USERNAME`、密码 `SUPER_ADMIN_PASSWORD`，默认 `admin@1losion.me` / `admin123456`）。

