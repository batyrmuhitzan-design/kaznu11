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

### Live Activity 远程推送（APNs）

把灵动岛 / 锁屏倒计时从**本地触发**升级为**服务器推送触发** —— 用户把 App 划掉后，
课前 15 分钟仍能自动弹卡片。完整接入步骤见 **`ios/PUSH_LIVE_ACTIVITY_SETUP.md`**。

**接口**（读需登录、staff 专属的见备注）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/live-activity/registration` | App 上报 device token / **push-to-start token**（按 user+设备覆盖） |
| POST | `/api/v1/live-activity/session` | 上报某个 Live Activity 的 push token（服务器据此 update / end） |
| DELETE | `/api/v1/live-activity/session/{activity_id}` | Activity 结束，注销 token |
| POST | `/api/v1/lessons/sync` | 整表同步课表（服务器端需要它才能算"课前 15 分钟"） |
| GET | `/api/v1/live-activity/status` | App 自检：我的注册 / 在跑的卡片 / APNs 状态 |
| POST | `/api/v1/live-activity/test-push` | **立刻**给自己推一条 15 分钟演示卡片（验全链路，不用等上课） |
| GET | `/api/v1/live-activity/apns-status` | 运维自检（staff）：凭据 / topic / 调度器 |
| POST | `/api/v1/live-activity/run-scheduler` | 手动跑一轮调度（staff） |

**三个必须知道的实现细节**（都已在测试里锁住）：

1. **Date 用 Apple 2001 基准**：ActivityKit 解 `content-state` 走默认 `JSONDecoder`，
   Swift 的 `Date` 编码为「距 2001-01-01 的秒数」。服务端若按 Unix 时间戳发，
   锁屏计时器会跑到 1970 年附近 → 统一用 `apple_reference_seconds()`。
2. **`event: "start"` 必须带 `attributes-type` 与 `attributes`**，否则 iOS 静默丢弃整条推送。
3. **`stale-date` 只影响"过期样式"，倒计时靠系统计时器自走** ——
   所以一条推送就能跑完整个 15 分钟，无需高频推送。

**调度幂等**：`live_activity_push_log` 用 `(user_id, occurrence_key, event)` 唯一约束去重
（`occurrence_key` 含日期，避免"下周同一节课"被误判为重复）。

**优雅降级**：未配置 APNs 凭据时后端照常运行，调度与 `test-push` 返回
`apns-not-configured` 并说明原因；App 端本地触发链路不受影响。

### 私信 Chat（WebSocket）/ 通知中心 / 图片上传

Campus 社区补全：**一对一私信 + 通知中心 + 全校广播 + 本地相册上传 + News 融入 Feed**。

**数据模型**（启动时 `create_all` 自动建表；`posts` 新增两列由 `_ensure_post_official_columns` 兼容迁移）

| 模型 | 表 | 说明 |
|---|---|---|
| `Conversation` | conversations | 一对一会话；参与者按 (a,b) 规范化排序 + 唯一约束 → 天然防重复会话 |
| `Message` | messages | 私信；`client_id` 唯一约束 = 离线队列幂等键；`read_at` 做已读回执 |
| `DeviceToken` | device_tokens | 通知用推送 token（**与 Live Activity 注册表分开**，关掉灵动岛也能收通知） |
| `UserNotification` | user_notifications | 定向通知（点赞/评论/私信/官方）；`(user_id, dedupe_key)` 唯一 → 反复点赞只留一条 |
| `NotificationReadCursor` | notification_read_cursors | 广播已读游标（一个时间戳，避免广播写 N 行） |

**端点**

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/chat/conversations` | 会话列表（含未读数）/ 开会话（幂等） |
| GET/POST | `/chat/conversations/{id}/messages` | 历史（倒序分页）/ 发送（REST 降级通道） |
| POST | `/chat/read` | 标记已读 + 回执给对方 |
| GET | `/chat/unread-count` | 私信未读数（角标兜底） |
| WS | `/api/v1/ws/chat?token=…` | **实时通道**：send / read / typing / ping ↔ ready / message / read / typing / pong / error |
| GET | `/notifications` | 通知中心（定向通知 + 广播 + 未读总数） |
| POST | `/notifications/read`、`/{id}/read` | 全部已读 / 单条已读 |
| POST | `/notifications/devices`、DELETE `/{device_id}` | 推送设备登记 / 注销 |
| POST | `/notifications/broadcast` | **全校广播**（staff）：入库 + WebSocket + APNs 扇出 |
| GET | `/notifications/push-status` | 推送自检（staff）：凭据 / alert topic / 设备数 |
| POST | `/uploads/image` | 图片上传（1-6 张，multipart）→ 绝对 URL |
| GET | `/uploads/status`、DELETE `/uploads/image` | 存储自检 / 删除（staff） |
| POST | `/posts/official` | 官方公告帖（staff）→ 置顶 + `kaznu.official` 徽章 + 系统横幅 |

**几条关键设计**

1. **三条通路各司其职**：入库（通知中心/已读）→ WebSocket（在前台秒到、不耗推送配额）→ APNs（**只有离线才发**，避免"前台已看到横幅又弹系统通知"的双重打扰）。
2. **WS 与 REST 共用 `persist_message()`**：WS 断了前端自动降级走 REST，幂等键（`client_id`）与推送行为完全一致，不会分叉。
3. **WS 帧必须 `model_dump(mode="json")`**：REST 由 FastAPI 序列化，WS 是自己 `json.dumps` —— 直接塞 Pydantic 对象会抛 `TypeError`，异常发生在 WS 处理器里 → 连接被关、消息发不出（已踩并加测试覆盖）。
4. **通知文案按设备语言渲染**：`notify_user(text_for=…)` 逐设备构造 payload（一台英文机一台俄文机都对）。
5. **广播不写 N 行**：`GlobalNotification` + 读游标时间戳，一次广播只写一行。
6. **上传按文件头校验**（不信 content-type），文件名随机 uuid（**不带用户信息**，符合社区匿名约定）；未配云存储时落本地磁盘 + `/media` 静态挂载，零凭据可用。
7. **WebSocket 鉴权走 query string**：浏览器 WS 不能自定义 Header；token 无效/封禁在握手阶段以 403 拒绝。

**环境变量**：`UPLOAD_DIR` / `UPLOAD_MAX_BYTES` / `UPLOADS_ENABLED` / `PUBLIC_BASE_URL` /
`STORAGE_BACKEND=local|s3`（S3 兼容：Supabase Storage / Azure Blob 网关 / R2）+ `S3_*` /
`NOTIFICATIONS_PUSH_ENABLED` / `BROADCAST_PUSH_BATCH`。

**自检**：`python backend/tests/check_social_api.py` —— 48 项，包含**真起 uvicorn 子进程 + 真 WebSocket 客户端**的端到端断言（收发消息、多端回显、幂等重发、typing、已读回执、鉴权拒绝、异常事件不崩连接）。

### 课程资料 + 社团申请（本轮产品重构）

**模型**

| 模型 | 表 | 说明 |
|---|---|---|
| `CourseMaterial` | course_materials | 教师上传的讲义 / PPT / 数据集；`course_code`/`course_title` 是**冗余快照**（课程改名不追改历史资料） |
| `ClubApplication` | club_applications | 社团创建申请；`status` 默认 **pending**（绝不能默认 approved，否则任何人可凭空造"官方社团"） |

**接口**

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/materials/summary` | 首页卡片专用：最新一条 + 总数 + 课程数（一次聚合，不用拉整页） |
| GET | `/materials/latest` | 资料列表（`Page[T]` 信封；支持 `course_code` / `file_format` 过滤） |
| POST | `/materials` | 登记资料（staff；query 参数形式，便于 curl 一行造数据） |
| GET | `/clubs/categories` | 社团分类枚举（文案由前端 i18n 渲染） |
| GET | `/clubs` | **公开**社团列表（只回 `status=approved` 且 `is_visible`） |
| GET | `/clubs/mine` | 我提交过的申请（含 pending/rejected + 驳回原因） |
| POST | `/clubs/apply` | 提交申请（**multipart/form-data**：字段 + Logo 文件） |

**为什么首页那张卡从"作业 Deadline"改成"最新资料"**
原实现写着 `NEXT DEADLINE` / "还剩 4h" / `Assignment 3` / `23:59 due`，全都是**写死的假数据**；
而它的点击目标是 `materials` 页 —— 说明真实业务一直是"老师刚上传了什么资料"。
现在卡片接 `/materials/summary`，显示真实文件名 + 课程 + 格式/体积 + "多久前上传"，
拿不到数据时显示空状态，**不再编造倒计时**。

**几条关键设计**

1. **社团申请默认 pending**：`GET /clubs` 是公开列表，默认 approved 等于给所有人开了"官方社团"后门。管理员在 `/admin/club-application` 点 **✅ Approve club** 才进列表，并在那一刻给申请人发结果通知。
2. **`POST /clubs/apply` 必须手写 Content-Type 以外的一切**：客户端**不能**手动设置 `Content-Type`（要交给浏览器补 multipart boundary），否则后端解析出的字段全是 `None`。前端 `ClubService` 有显式注释 + 守卫脚本会检查这一点。
3. **同名未审申请去重**（409）：防止连点/反复提交刷出一堆重复记录；前端把 409 单独提示，不当作网络错误。
4. **公开社团视图不含手机号**：`ClubOut` 故意没有 `contact_phone`（只在 `/clubs/mine` 与后台可见）—— 个人信息不进公开列表。
5. **新内容会像课前提醒一样推送**：新官方公告（`create_official_post`）与新审批通过的活动（`ClubEventAdmin.approve_events`）都会调 `announce_content()` 做**全量 APNs 扇出**；后台 `GlobalNotificationAdmin` 还多了 **📣 Push now** 动作（显式推送已存在的通知，避免"存草稿=误推"）。

**自检**：`python backend/tests/check_materials_clubs_api.py` —— 28 项（分页/排序/过滤/422/401、
multipart Logo 上传落盘、默认 pending、409 去重、`/clubs/mine`、回执通知、
后台 approve 动作闭环 + DB 复核）；另有 `check_campus_contract.py` 把前端 TS 接口与 OpenAPI 做双向字段比对。

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
python backend/tests/check_admin_mount.py          # 断言：/docs、全部评价/管理端路由、/admin、/healthz、旧接口、种子数据、/app
python backend/tests/check_admin_i18n.py           # 断言：管理后台多语言（语言包注册、切换器、cookie、EN/RU/ZH 页面文案）
python backend/tests/check_campus_api.py           # 断言：Campus Hub 全部端点（匿名脱敏 / 分页 / 点赞开关 / 软下架 / 通知轮转 / 后台页面）
python backend/tests/check_campus_contract.py      # 断言：前端 TS 接口 ↔ 后端 OpenAPI 字段逐一对齐（防前后端类型漂移）
python backend/tests/check_live_activity_api.py    # 断言：Live Activity 注册 / 课表 / 调度判定（幂等、时区、课前 15 分钟）/ APNs payload
python backend/tests/check_live_activity_contract.py  # 断言：Swift ContentState ↔ APNs payload 字段双向一致（含 Apple 2001 时间基准）
python backend/tests/smoke_test.py                 # 原有业务冒烟（匿名性/一人一评/登录门禁）
```

### 线上验证
```bash
curl -s https://1losion.me/healthz            # 期望 {"status":"ok","db_ready":true,…,"admin":"/admin"}
curl -s https://1losion.me/openapi.json | grep -c '/api/v1/reviews'
```
浏览器打开 `https://1losion.me/docs`（应能看到 professors / courses / reviews / admin / super-admin / reports 分组）
与 `https://1losion.me/admin`（账号密码见下）。

### 线上验证（部署后必做，两个脚本）
```bash
# 1) 本地跑：真 WebSocket + 真推送 + 私信撤回（打 https://1losion.me）
python backend/tests/check_live_e2e.py

# 2) 服务器跑：迁移补列 / 后台审核页 / /app 静态站是否换新
scp backend/tests/check_live_server.py kaznu:/tmp/check_deploy.py
ssh kaznu "python3 /tmp/check_deploy.py"
```

为什么这两个不能省（本地自检证明不了的事）：

| 事实 | 本地测试为什么证明不了 |
|---|---|
| `global_notifications.pushed_at` / `messages.deleted_by` 真的被 ALTER 到线上老库上了 | 本地临时库永远是**新 schema**，`create_all` 不给已存在的表加列；缺列时广播推送与撤回都会 500 |
| 广播帧经过 nginx + 真 WS 后仍带 `delivery_id` / `pushed_at` | 本地是桩 socket，只证明逻辑对；而 App 的弹窗/响铃**只认这两个字段** |
| `/app` 里是**这次**构建的资源 | 静态站是 `cap sync` / 手工上传的产物，与 `git push` 无关（本地另有 `npm run verify:ios-bundle` 查 iOS 工程） |

⚠️ `check_live_e2e.py` 会写生产数据（2 条全校广播 + 1 条私信），所以它**自己清理**：
广播跑完自动下线（`is_active=0` → 真机不再显示），断言失败也照样清理；清理失败判为失败并打印手动下线链接。
不会删行（留审计痕迹）——后台 Global Notifications 里能看到 `E2E 广播 A/B · <时间戳>` 这两条已停用的记录，可手工删除。

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

