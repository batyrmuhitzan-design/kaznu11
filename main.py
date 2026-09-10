"""KazNU Helper — 统一 FastAPI 入口（生产 / 线上 `uvicorn main:app` 用的就是这个文件）。

这个入口现在挂载三部分：

  1) **完整的 2.0 后端**（`backend/app/`）：Univer 身份 + 教授/课程评价（Prof Reviews）
     + 举报 + 管理端 API，全部在 `/api/v1/*` 下：
        /api/v1/auth/*        登录 / 注册（Univer 账号形态校验）
        /api/v1/me/*          全局显示名 / 部门标签
        /api/v1/professors    教授列表与检索
        /api/v1/courses       课程列表与检索
        /api/v1/reviews       评价：GET 列表 / POST 发表（匿名，一人一教授一条）/ eligibility / like
        /api/v1/admin/*       管理员申请、审批、封禁（管理端 API）
        /api/v1/super-admin/* 超管接口
        /api/v1/reports/*     评价举报
  2) **Web 管理后台**：SQLAdmin 挂载在 `/admin`
     （Users / Admin Applications / Professors / Courses / Reviews / Reports；
       评价可查看/检索/编辑/删除，举报可处理，管理员申请可 Approve/Reject，用户可 Ban/Unban）
  3) 1.0 原型接口（`/api/v1/schedule`、`/api/v1/grades`）继续保留，避免老客户端 404；
     旧版 `/api/news`、`/api/schedule`、`/api/gpa` 由 2.0 后端的兼容 router 提供。
  4) 可选：前端构建产物（`dist/`）挂到 `/app`，方便同源预览静态站（不影响 `/admin` 与 `/api`）。

启动：
    uvicorn main:app --host 0.0.0.0 --port 8000

常用环境变量（写在仓库根 .env 即可，backend/app/config.py 会自动加载）：
    DATABASE_URL          # 不设置时退回本地 SQLite 文件（零依赖可跑通）
    SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD   # /admin 登录（默认 admin@1losion.me / admin123456）
    DEMO_PASSWORD         # 学生端 demo 密码（默认 123456）
    ADMIN_SESSION_SECRET  # 后台会话签名密钥（生产请单独设置）
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import Query
from fastapi.staticfiles import StaticFiles

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
WEB_DIR = ROOT_DIR / "dist"

# `backend/` 里有 app 包（backend/app/*），加入 sys.path 后 `import app.main` 才能解析。
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# ---- 挂载完整的 2.0 后端（含 /api/v1/* 评价路由、SQLAdmin /admin、/healthz、旧版 /api/news 等）----
from app.main import app  # noqa: E402  (必须在上面的 sys.path 注入之后导入)


# =====================================================================
# 1.0 原型接口（兼容保留：线上一直在提供，留着以免老客户端 404）
# =====================================================================
@app.get("/api/v1/schedule", tags=["legacy"], summary="旧版课表原型接口（兼容保留）")
def legacy_schedule(student_id: str = Query(..., description="学生学号")):
    return {
        "status": "success",
        "student_id": student_id,
        "schedule": [
            {"id": 1, "time": "09:00 - 10:20", "subject": "Data Structures & Algorithms", "teacher": "Dr. Akhmetov", "room": "304 FIT", "type": "Lecture"},
            {"id": 2, "time": "10:30 - 11:50", "subject": "Database Systems", "teacher": "Prof. Suleimenov", "room": "208 FIT", "type": "Practice"},
            {"id": 3, "time": "13:00 - 14:20", "subject": "Web Development", "teacher": "Tutor Bateer", "room": "401 FIT", "type": "Lab"},
        ],
    }


@app.get("/api/v1/grades", tags=["legacy"], summary="旧版成绩原型接口（兼容保留）")
def legacy_grades(student_id: str = Query(..., description="学生学号")):
    return {
        "status": "success",
        "student_id": student_id,
        "gpa": 3.85,
        "courses": [
            {"subject": "Data Structures", "grade": "A", "score": 95},
            {"subject": "Database Systems", "grade": "A-", "score": 91},
            {"subject": "Linear Algebra", "grade": "B+", "score": 88},
        ],
    }


# =====================================================================
# 前端静态资源（可选）：`npm run build` 之后把 dist/ 挂到 /app
# =====================================================================
_WEB_MOUNTED = WEB_DIR.is_dir() and (WEB_DIR / "index.html").is_file()
if _WEB_MOUNTED:
    app.mount("/app", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

print(
    "[kaznu] 入口已就绪 → /docs 接口文档、/admin 管理后台（SQLAdmin）"
    + ("、/app 前端静态站" if _WEB_MOUNTED else "（未发现 dist/，跳过 /app 挂载：先 npm run build）")
)
