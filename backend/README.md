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

