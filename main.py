from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 允许前端跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有前端域名访问
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = FastAPI(
    title="KazNU Helper API",
    description="KazNU Helper 基础后端接口",
    version="1.0.0"
)

# 允许跨域请求，方便前端 React / iOS 调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "online", "message": "KazNU Helper API 运行正常！"}

# 1. 假数据：课表接口
@app.get("/api/v1/schedule")
def get_schedule(student_id: str = Query(..., description="学生学号")):
    return {
        "status": "success",
        "student_id": student_id,
        "schedule": [
            {
                "id": 1,
                "time": "09:00 - 10:20",
                "subject": "Data Structures & Algorithms",
                "teacher": "Dr. Akhmetov",
                "room": "304 FIT",
                "type": "Lecture"
            },
            {
                "id": 2,
                "time": "10:30 - 11:50",
                "subject": "Database Systems",
                "teacher": "Prof. Suleimenov",
                "room": "208 FIT",
                "type": "Practice"
            },
            {
                "id": 3,
                "time": "13:00 - 14:20",
                "subject": "Web Development",
                "teacher": "Tutor Bateer",
                "room": "401 FIT",
                "type": "Lab"
            }
        ]
    }

# 2. 假数据：成绩接口
@app.get("/api/v1/grades")
def get_grades(student_id: str = Query(..., description="学生学号")):
    return {
        "status": "success",
        "student_id": student_id,
        "gpa": 3.85,
        "courses": [
            {"subject": "Data Structures", "grade": "A", "score": 95},
            {"subject": "Database Systems", "grade": "A-", "score": 91},
            {"subject": "Linear Algebra", "grade": "B+", "score": 88}
        ]
    }


@app.get("/api/news")
def get_news():
    """演示校园新闻接口，后续可替换为校园网抓取结果。"""
    return [
        {
            "id": "news-1",
            "title": "ҚҰТТЫҚТАЙМЫЗ!!!",
            "summary": "Әл-Фараби атындағы Қазақ ұлттық университетінің 2025-2026 оқу жылының қысқы емтихан сессиясының қорытындылары бойынша бос білім беру гранттарына тағайындалған келесі студенттер мен магистранттарды құттықтаймыз!!!",
            "body": "Қазақстан Республикасы Ғылым және жоғары білім министрлігінің 2026 жылғы 20 наурыздағы бұйрығына сәйкес бос білім беру гранттары тағайындалды. Студент кеңсесі тізімде көрсетілген білім алушылардан келісім шартқа қол қоюларын сұрайды.",
            "published_at": "2026-07-23T14:35:00+05:00",
            "category": "University",
            "accent": "#007AFF",
        },
        {
            "id": "news-2",
            "title": "Құрметті білім алушылар!",
            "summary": "Жазғы семестрге тіркелу және оқу үдерісін жоспарлау туралы маңызды ақпарат.",
            "body": "Жазғы семестрге тіркелу Univer жүйесінде ашық. Пәндерді таңдаудан бұрын академиялық кеңесшіңізбен оқу жоспарын нақтылаңыз.",
            "published_at": "2026-07-23T10:20:00+05:00",
            "category": "Students",
            "accent": "#30D158",
        },
        {
            "id": "news-3",
            "title": "Вакансия",
            "summary": "Университет бөлімдеріне студенттерді жұмысқа шақырамыз.",
            "body": "Кампус жобаларына көмекші қажет. Толық ақпарат пен өтінім беру формасы мансап орталығының парақшасында жарияланған.",
            "published_at": "2026-07-22T15:55:00+05:00",
            "category": "Career",
            "accent": "#FF9F0A",
        },
        {
            "id": "news-4",
            "title": "Coursera 2026",
            "summary": "Студенттерге арналған жаңа онлайн курстар топтамасы қолжетімді.",
            "body": "Coursera for Campus бағдарламасы аясында жаңа курстар ашылды. Қатысу үшін университеттік поштаңызбен тіркеліңіз.",
            "published_at": "2026-06-22T17:12:00+05:00",
            "category": "Learning",
            "accent": "#5E5CE6",
        },
        {
            "id": "news-5",
            "title": "Вебинарлар для студентов",
            "summary": "Шілде айындағы вебинарлар кестесі жарияланды.",
            "body": "Апта сайынғы вебинарлар оқу, мансап және студенттік бастамалар тақырыптарына арналады.",
            "published_at": "2026-06-20T17:39:00+05:00",
            "category": "Events",
            "accent": "#FF453A",
        },
    ]