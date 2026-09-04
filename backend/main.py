from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
def get_schedule():
    return [
        {
            "id": "1",
            "name": "Machine Learning Foundations",
            "code": "CS 305",
            "instructor": "Dr. Aida Semagulova",
            "room": "IT Faculty, Lab 208B",
            "time": "10:00 AM - 11:30 AM",
            "type": "Lecture"
        },
        {
            "id": "2",
            "name": "Advanced Calculus II",
            "code": "MATH 201",
            "instructor": "Prof. Nurlan",
            "room": "Main Hall, 402",
            "time": "02:00 PM - 03:30 PM",
            "type": "Lab"
        }
    ]


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
    """Return demo campus announcements until the live university feed is connected."""
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
