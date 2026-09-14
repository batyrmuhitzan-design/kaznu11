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
| `/api/v1/posts`、`/club-events`、`/notifications/latest` | **Campus Hub 校园社区 API**：校园墙帖子 / 评论 / 点赞、社团活动、全局紧急通知（见下文专节） |
| `/admin` | **SQLAdmin Web 管理后台**：Reviews 查看·编辑·删除、Reports 处理、Professors/Courses 维护；**Campus Hub 内容审核**（Posts / Post Comments / Club Events / Global Notifications）；超管另有 Users 封禁、Admin Applications 审批 |
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

### Campus Hub（校园娱乐与交流社区）

App 底部导航第 3 个 Tab（原 Materials 的位置）；**Materials 改为从首页「NEXT DEADLINE」卡片进入**。

**数据模型**（`backend/app/models.py`；启动时 `create_all` 自动建表，无需迁移）

| 模型 | 表 | 说明 |
|---|---|---|
| `Post` | `posts` | 校园墙帖子：`category` / `content` / `media_urls`(JSON) / `is_anonymous` / `likes_count` / `is_hidden` |
| `PostComment` | `post_comments` | 评论（同样支持匿名） |
| `PostLike` | `post_likes` | **点赞去重记录**（`post_id` + `liker_hash` 唯一约束） |
| `ClubEvent` | `club_events` | 社团活动通告：`is_approved` 审核开关 |
| `GlobalNotification` | `global_notifications` | 全校紧急通知：`level` = info/warning/danger，`is_active` 上下线开关 |

> 为什么多了一张 `PostLike`：需求里的 `POST /posts/{id}/like` 是**点赞 / 取消赞开关**，
> 要能正确"再点一次就取消"就必须记住"谁赞过"。沿用评价体系的匿名做法只存 `liker_hash`
> （HMAC of Univer 账号），不含任何可反查身份的字段；`Post.likes_count` 作为冗余计数供列表快速读取。

**接口**（读公开 / 写需登录；列表统一返回分页信封 `{items,total,limit,offset,has_more}`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/posts?category=&limit=&offset=` | 信息流（按分类分页；被下架的帖子不出现） |
| POST | `/api/v1/posts` | 发帖（需登录，限流 6/min；`media_urls` 只收 http(s)、最多 6 条） |
| POST | `/api/v1/posts/{id}/like` | 点赞 / 取消赞（同一账号再点一次即取消） |
| GET | `/api/v1/posts/{id}/comments` | 评论列表（按时间正序 = 楼层顺序） |
| POST | `/api/v1/posts/{id}/comments` | 发表评论（需登录，限流 12/min） |
| GET | `/api/v1/club-events?club_name=&include_past=` | 活动列表（只返回已审核，默认隐藏已结束的） |
| GET | `/api/v1/notifications/latest` | 当前生效的紧急通知；没有则返回 `null` |

**隐私不变量**：匿名帖 / 匿名评论的响应里 `author.name` **与 `author.department_tag` 都为 `null`** ——
这一点与评价体系**刻意不同**（评价的公开身份就是院系标签，评分需要粗粒度上下文；而校园墙的帖子
配上院系标签会显著缩小匿名范围）。`check_campus_api.py` 有对应断言，改动不会静默退化。
> 注意：`/admin` 是**员工界面**，为了追责会显示帖子作者显示名 —— 这是刻意的，与公开 API 是两个不同表面。

**内容治理**：违规内容走 `is_hidden` 软下架（从公开列表消失、其评论接口 404，后台可一键恢复）；
活动必须 `is_approved=true` 才公开；紧急通知靠 `is_active` 上下线。以上都在 `/admin` 的 Campus Hub 分组里操作。

### 管理后台多语言（EN / RU / ZH）

`/admin` 导航栏与登录页都有语言切换器（🌐 下拉），支持 **EN / RU / ZH** 三种语言：

| 组件 | 位置 | 说明 |
|---|---|---|
| 语言注册 | `backend/app/i18n.py` → `register_catalogs()` | SQLAdmin 0.31.1 内置 catalog **只有 en/de/az/ru/tr**，`zh` 由本仓库提供；运行时追加进 `sqladmin.i18n.SUPPORTED_LOCALES` / `translations` |
| 中文语言包 | `backend/locales/translations/zh/LC_MESSAGES/admin.{po,mo}` | SQLAdmin 自身的 52 条界面文案（登出/保存/搜索/分页/模态框…） |
| 业务文案 | `backend/app/i18n.py` → `APP_STRINGS` + `L()` | 菜单名、分类、动作按钮、确认弹窗、列标题（不在 SQLAdmin 的 catalog 里） |
| 登录页切换器 | `backend/templates/sqladmin/login.html` | 覆盖 SQLAdmin 自带模板（loader 首位 = 项目 `templates_dir`），登录后导航栏的切换器是 SQLAdmin 内置的 |

选择语言的三条路径（优先级从高到低，见 `sqladmin.i18n.LocaleMiddleware`）：

1. URL 查询参数 `?lang=zh`（并写入 `kaznu_admin_lang` cookie 持久化，有效期 1 年）；
2. `kaznu_admin_lang` cookie；
3. `Accept-Language` 请求头 —— 所以**浏览器语言是中文的用户，登录页直接就是中文**，无需先登录再切换。

⚠️ 改了 `.po` 必须重新编译，否则加载的还是旧 `.mo`：

```bash
python scripts/compile_admin_i18n.py        # .po → .mo（全部语言）
python scripts/compile_admin_i18n.py zh     # 只编译指定语言
python backend/tests/check_admin_i18n.py    # 自检：注册、切换器、cookie、三种语言的页面文案
```

### 部署 / 重启（服务器）

**推荐：systemd 托管（开机自启 + 崩溃自动拉起）**

单元文件在仓库里：`deploy/systemd/kaznu-api.service`（`/opt/kaznu11-main` + `127.0.0.1:8000` + `/var/log/kaznu-api.log`）。

```bash
# 首次安装
cp /opt/kaznu11-main/deploy/systemd/kaznu-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kaznu-api
systemctl status kaznu-api --no-pager

# 日常更新代码后
cd /opt/kaznu11-main
git pull --ff-only
pip install -r requirements.txt          # 首次或依赖更新时（sqladmin / itsdangerous / babel / aiosqlite 必需）
python scripts/compile_admin_i18n.py     # 改了管理后台语言包时
systemctl restart kaznu-api
curl -s http://127.0.0.1:8000/healthz    # 期望 {"status":"ok","db_ready":true,…,"admin":"/admin"}
```

⚠️ **两种方式不要混用**：`nohup` 起的进程不在 systemd 管理下，会和 systemd 抢 8000 端口。
从 nohup 迁移到 systemd 时先清掉旧进程：

```bash
pkill -f 'uvicorn main:app' || true
ss -ltnp | grep 8000 || echo "8000 已释放"
```

**备选：手动 nohup（临时调试用）**

```bash
cd /opt/kaznu11-main
git pull --ff-only
pip install -r requirements.txt
pkill -f 'uvicorn main:app' || true
nohup uvicorn main:app --host 127.0.0.1 --port 8000 >/var/log/kaznu-api.log 2>&1 &
```

- 用 aaPanel「Python 项目」托管时，把 restart 换成面板里的操作。
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
python backend/tests/check_admin_mount.py      # 断言：/docs、全部评价/管理端路由、/admin、/healthz、旧接口、种子数据、/app
python backend/tests/check_admin_i18n.py       # 断言：管理后台多语言（语言包注册、切换器、cookie、EN/RU/ZH 页面文案）
python backend/tests/check_campus_api.py       # 断言：Campus Hub 全部端点（匿名脱敏 / 分页 / 点赞开关 / 软下架 / 通知轮转 / 后台页面）
python backend/tests/check_campus_contract.py  # 断言：前端 TS 接口 ↔ 后端 OpenAPI 字段逐一对齐（防前后端类型漂移）
python backend/tests/smoke_test.py             # 原有业务冒烟（匿名性/一人一评/登录门禁）
```

### 线上验证
```bash
curl -s https://1losion.me/healthz            # 期望 {"status":"ok","db_ready":true,…,"admin":"/admin"}
curl -s https://1losion.me/openapi.json | grep -c '/api/v1/reviews'
```
浏览器打开 `https://1losion.me/docs`（应能看到 professors / courses / reviews / admin / super-admin / reports 分组）
与 `https://1losion.me/admin`（账号密码见下）。

> **管理后台登录凭据（实测确认）**
>
> | 部署方式 | 用户名 | 密码 |
> |---|---|---|
> | **未配置 `.env`**（服务器当前状态） | `superadmin@student.kaznu.kz` | `123456` |
> | 配置了仓库根 `.env` 里的 `SUPER_ADMIN_PASSWORD` | `SUPER_ADMIN_USERNAME` | `SUPER_ADMIN_PASSWORD` |
>
> 规则：`SUPER_ADMIN_USERNAME` 默认 `superadmin@student.kaznu.kz`；`SUPER_ADMIN_PASSWORD` 默认为**空**，
> 为空时**复用 `DEMO_PASSWORD`**（默认 `123456`）—— 见 `backend/app/config.py` 与 `backend/app/admin_ui.py:48`。
> 密码是**全局唯一**的（直接与环境变量明文比对，不按用户存哈希），所有 `role ∈ {admin, super_admin}` 的用户共用它。
>
> ⚠️ `123456` 同时是学生端 demo 密码，**生产环境务必在 `.env` 里改掉**
> （`SUPER_ADMIN_PASSWORD` + `DEMO_PASSWORD` + `ADMIN_SESSION_SECRET`）。

