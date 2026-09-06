from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
from pathlib import Path

app = FastAPI(title="KazNU Helper API")

# 允许 iOS App 和前端本地跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "KazNU Helper Backend Ready"}

# 模拟后续从 univer.kaznu.kz 抓取的课表接口
@app.get("/api/schedule")
def get_schedule(student_id: str = "20260001"):
    """按星期(0=周一..6=周日)分组返回课表。接入 Univer 真实课表后替换即可。"""
    return {
        "0": [
            {"id": "c1", "name": "Linear Algebra", "room": "204", "prof": "Akhmetov N.T.", "type": "lecture", "startH": 9, "startM": 0, "endH": 10, "endM": 30},
            {"id": "c2", "name": "Higher Math II", "room": "315", "prof": "Bekova A.K.", "type": "lecture", "startH": 11, "startM": 0, "endH": 12, "endM": 30},
        ],
        "1": [
            {"id": "c5", "name": "Data Structures", "room": "301", "prof": "Seitkali B.M.", "type": "lecture", "startH": 9, "startM": 0, "endH": 10, "endM": 30},
        ],
        "2": [
            {"id": "c8", "name": "Physics II", "room": "Lab 3", "prof": "Nurlanova G.S.", "type": "lab", "startH": 14, "startM": 0, "endH": 15, "endM": 30},
        ],
        "3": [
            {"id": "c11", "name": "English C1", "room": "108", "prof": "Omarova D.S.", "type": "seminar", "startH": 16, "startM": 0, "endH": 17, "endM": 30},
        ],
    }


@app.get("/api/gpa")
def get_gpa():
    """Return the student's cumulative GPA plus the semester history used by the frontend sparkline."""
    return {
        "gpa": 3.82,
        "change": 0.04,
        "rank": "top 5%",
        "history": [3.55, 3.62, 3.70, 3.75, 3.78, 3.82],
    }


@app.get("/api/news")
def get_news():
    """真实新闻：来自 univer.kaznu.kz 新闻页抓取，与前端共享同一份 JSON。"""
    news_file = Path(__file__).resolve().parent.parent / "src" / "data" / "realNews.json"
    try:
        data = json.loads(news_file.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []
