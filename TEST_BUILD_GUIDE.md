# KazNU Helper 2.0.0 test build — Prof Reviews (RateMyProf)

Test version on top of the shipped **1.3.0** native app.

## What is new
1. **⭐ Prof Reviews** (Professor & Course Ratings)
   - Home → Quick Access tile ⭐ Prof Reviews
   - Services → new "Course & Professor Ratings" card
   - Schedule → tap a lesson → detail popup → **View Professor Rating**
   - Dashboard main course card → **View Professor Rating** link for the current/next professor
2. **Language**: every new screen/label is EN · KZ · RU and reacts to the in-app language switch.
3. **Community account**: Univer-shaped login auto-assigns a random global name
   (`user` + 7 digits). Edit it in **Profile → Settings → Global display name** or in the
   Prof Reviews 👤 sheet. Reviews only ever show your department tag — never the name.
4. **Backend (FastAPI + PostgreSQL)** under `backend/` — see `backend/README.md`.

## 1. Run the backend (Docker / local)
```bash
cd backend
copy .env.example .env
docker compose up --build        # Postgres 16 + API on :8000
# or locally:
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Smoke test without Postgres:
```bash
cd backend
python tests/smoke_test.py
```
Endpoints (all under `/api/v1`): `auth/login`, `me` (+ display-name/department-tag),
`professors`, `courses`, `reviews` (anonymous), `reviews/eligibility`, rate limits
5/min login · 2/min review post.

The app points to `VITE_API_URL` (see `.env` / `src/utils/config.ts`). If the backend is
unreachable on your phone, Prof Reviews works fully offline from its demo catalog and marks
itself "Demo data".

## 2. Build the iOS IPA

Windows cannot compile iOS, so use **GitHub Actions** (recommended) or a local Mac.

### A. GitHub Actions（推荐）

触发方式二选一：

- **自动**：push 到 `main` / `master`（仅 `.md` 与 `deploy/**` 的改动不会触发）；
- **手动**：Actions → **Build iOS IPA** → *Run workflow*（可选 `runner` 输入，默认 `macos-latest`；
  实测该镜像为 **macOS 26 + Xcode 26.6 / iOS SDK 26.5**，满足 Capacitor 8 的 Xcode 26+ 要求）。

一次运行会并行产出 **两个未签名 IPA**（都是 `Release` 构建）：

| Artifact 名 | 下载到的文件 | 内容 | 安装前提 |
|---|---|---|---|
| `KazNUHelper-full-ipa` | `KazNUHelper-full-unsigned.ipa` | App **+ `KazNUWidgets.appex`**：Live Activity / 灵动岛 / 桌面小组件 | **付费** Apple 开发者账号（免费账号无法签名 App Extension） |
| `KazNUHelper-sideload-ipa` | `KazNUHelper-sideload-unsigned.ipa` | 已剥离 Widget 扩展（同时移除 App Groups 权限） | **免费** Apple ID 即可侧载，但**看不到**锁屏倒计时 / 灵动岛 |

流水线步骤（与 `ios/LIVE_ACTIVITY_GUIDE.md` 一致）：

```
checkout → node 22 → npm ci → 工程结构自检(node scripts/verify-ios-live-activity.cjs)
  → npm run build（Web）→ [仅 sideload] 剥离 Widget 扩展
  → npx cap sync ios（保留仓库里已提交的 ios 工程，只同步）
  → xcodebuild Release 未签名构建 → 校验 .appex 是否符合预期
  → 清理 _CodeSignature / embedded.mobileprovision → 打包 ipa → 上传 artifact
```

### B. Local Mac

```bash
npm ci
npm run build
npx cap sync ios
cd ios/App
# 完整包（含扩展）
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" CODE_SIGN_STYLE=Manual
mkdir -p Payload && cp -r build/Build/Products/Release-iphoneos/App.app Payload/
zip -r KazNUHelper-full-unsigned.ipa Payload
```

## 3. Install on your iPhone for testing

Artifacts are **unsigned** (CI has no Apple certificate), so a sideloading tool re-signs them:

- **AltStore / AltServer**（Windows / Mac）：右键 ipa → Install。
- **Sideloadly**（Windows / Mac）：拖入 ipa，填 Apple ID → Start。

选哪个包：

- **免费 Apple ID** → 只能装 `KazNUHelper-sideload-ipa`。
  Bundle id 仍是 `com.kaznu.helper`，版本 `2.0.0 (13)`。
  该包已去掉 App Groups 权限（免费账号不支持），App 会自动回退到标准 `UserDefaults` 存课表缓存，
  功能不受影响（只是没有桌面小组件与 Live Activity）。
- **付费开发者账号（$99/年）** → 装 `KazNUHelper-full-ipa`，可以测 **Live Activity / 灵动岛**。
  真机测试步骤：
  1. 打开 App → 进入 **Schedule** 拉一次课表（会把课表同步给原生）；
  2. 若恰好在某节课前 30 分钟内 → 直接进入倒计时；否则等到 T-30，
     或点击 T-60 上课提醒通知上的「开启灵动岛 / Start Live Activity」按钮立即触发；
  3. 锁屏 / 下拉通知中心看大卡片（圆环倒计时绿→橙→红），长按灵动岛看展开态、退出到桌面看紧凑态。
- **付费账号 + Xcode 真机调试**（不走侧载）同样可测：`npx cap open ios` → 选 Team → `⌘R`。

## 0. 管理后台 (SQLAdmin)
浏览器打开 `https://1losion.me/admin`（本地则是 `http://127.0.0.1:8000/admin`）。
- 入口是仓库根目录的 `main.py`（`uvicorn main:app`）：它把评价系统 `/api/v1/*`、管理后台 `/admin`、
  文档 `/docs`、健康检查 `/healthz` 与旧版兼容接口挂在同一个应用上。
- 首次启动自动创建超管：`SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`（默认 `admin@1losion.me` / `admin123456`）。
- 学生可在 App/API 用 `POST /api/v1/admin/apply` 申请；超管在 `/admin` 的
  “Admin Applications”面板一键 Approve/Reject；Users 面板可一键 Ban/Unban。
- role=admin 的账号只能看到 Reviews / Professors / Courses / Reports 内容面板；
  Reviews 面板可查看（含评价正文预览）、编辑、批量删除。
- 未配置 `DATABASE_URL` 时自动使用本地 SQLite（`kaznu_helper.db`）；DB 不可用时 `/docs` 与 `/admin`
  登录页仍可访问（`/healthz` 显示 `db_ready:false`）。

部署 / 重启 / 验证（含 openresty 反代片段、无 Postgres 场景）：见 **`backend/README.md`** →
“统一入口挂载 / 部署 / 自检 / 线上验证”。最快的自检：

```bash
python backend/tests/check_admin_mount.py     # 无需 Postgres
```

## Notes / verification done
- `python backend/tests/smoke_test.py` → all assertions passed (login, display name,
  anonymity invariants, duplicate-review 409, legacy endpoints).
- `npm run build` (vite 8) → success; `npx cap sync ios` → success; `dist/` copied into
  `ios/App/App/public`.
- Backend logs/session storage in this repo are demo-grade (localStorage). Production
  deployment should move the bearer token to iOS Keychain and enable Alembic migrations.
