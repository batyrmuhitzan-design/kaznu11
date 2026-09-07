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

## 2. Produce the iOS IPA (macOS/Xcode)
Windows cannot compile iOS. Two options:

**A. GitHub Actions (recommended)** — push this branch (or use *Actions → Build iOS IPA →
Run workflow*, now enabled via `workflow_dispatch`) → download the `KazNUHelper-iOS` artifact:
`ios/App/KazNUHelper.ipa`. The workflow already keeps the committed `ios/` project and does
`vite build` → `cap sync ios` → unsigned `xcodebuild` → `.ipa`.

**B. Local Mac**
```bash
npm ci
npx vite build
npx cap sync ios
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos \
  CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO -derivedDataPath build
mkdir -p Payload && cp -r build/Build/Products/Release-iphoneos/App.app Payload/
zip -r KazNUHelper.ipa Payload
```

## 3. Install on your iPhone for testing
The artifact is **unsigned** (no paid Apple certificate in CI). Install with a free signing
tool on your Mac/PC:
- **AltStore / AltServer** (Windows OK): right-click the ipa → Install KazNU Helper.
- or **Sideloadly** (Windows OK) with your Apple ID.
Bundle id stays `com.kaznu.helper`, version **2.0.0 (13)**.

## 0. 管理后台 (SQLAdmin)
浏览器打开 `https://<你的统一域名>/admin`（本地则是 `http://127.0.0.1:8000/admin`）。
- 首次启动自动创建超管：`SUPER_ADMIN_USERNAME`（默认 `superadmin@student.kaznu.kz`），密码=`DEMO_PASSWORD`(123456)。
- 学生可在 App/API 用 `POST /api/v1/admin/apply` 申请；超管在 `/admin` 的
  “Admin Applications”面板一键 Approve/Reject；Users 面板可一键 Ban/Unban。
- role=admin 的账号只能看到 Reviews / Professors / Courses / Reports 内容面板。

## Notes / verification done
- `python backend/tests/smoke_test.py` → all assertions passed (login, display name,
  anonymity invariants, duplicate-review 409, legacy endpoints).
- `npm run build` (vite 8) → success; `npx cap sync ios` → success; `dist/` copied into
  `ios/App/App/public`.
- Backend logs/session storage in this repo are demo-grade (localStorage). Production
  deployment should move the bearer token to iOS Keychain and enable Alembic migrations.
