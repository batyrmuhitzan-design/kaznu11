"""Seed catalog of professors/courses/reviews for the 2.0 beta test.

The professors intentionally match the names shown in the Schedule demo
(Akhmetov, Bekova, Seitkali, Serikova, Omarova, Semagulova, Suleimenov, Bateer)
so "View Professor Rating" deep links find real matching profiles.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    ClubApplication,
    ClubEvent,
    Course,
    CourseMaterial,
    GlobalNotification,
    Post,
    PostComment,
    Professor,
    Review,
    User,
)

_COURSES = [
    {"code": "MATH101", "title": "Linear Algebra", "department": "Mathematics", "credits": 5},
    {"code": "MATH102", "title": "Higher Mathematics II", "department": "Mathematics", "credits": 5},
    {"code": "CS201", "title": "Data Structures & Algorithms", "department": "Computer Science", "credits": 5},
    {"code": "PHYS101", "title": "Physics II", "department": "Physics", "credits": 5},
    {"code": "LANG101", "title": "English C1", "department": "Foreign Languages", "credits": 3},
    {"code": "CS350", "title": "Machine Learning", "department": "Computer Science", "credits": 5},
    {"code": "CS210", "title": "Database Systems", "department": "Computer Science", "credits": 4},
    {"code": "WEB201", "title": "Web Development", "department": "Computer Science", "credits": 4},
]

# Each professor entry maps a course code to its seeded reviews.
_PROFESSORS: list[dict] = [
    {
        "name": "Nurzhan Akhmetov",
        "department": "Mathematics",
        "courses": {
            "MATH101": [
                (4, 5, "mandatory", "Clear theorems, tough but fair exams. His proofs are a pleasure to follow.", ["Clear grading", "Inspirational"], "Applied Math Student", 3, 9),
                (3, 4, "recommended", "Fast pace. Bring a notebook — he explains on the board and never re-uploads slides.", ["Tough grader"], "Math Student", 1, 30),
                (5, 5, "recommended", "The best lecturer in the math block. Go to class, skip the textbook.", ["Inspirational"], "Data Science Student", 2, 45),
            ],
            "MATH102": [
                (3, 4, "recommended", "Solid follow-up to Linear Algebra. Office hours really help.", ["Clear grading"], "Physics Student", 0, 12),
            ],
        },
    },
    {
        "name": "Assel Bekova",
        "department": "Mathematics",
        "courses": {
            "MATH102": [
                (5, 5, "not_mandatory", "Kind, patient, and explains integrals like stories. Attestations are fair.", ["Caring", "Inspirational"], "Computer Science Student", 4, 5),
                (4, 4, "recommended", "Attendance not forced but her practice sets are gold for the exam.", ["Clear grading"], "Applied Math Student", 1, 21),
            ],
        },
    },
    {
        "name": "Bauyrzhan Seitkali",
        "department": "Computer Science",
        "courses": {
            "CS201": [
                (5, 5, "recommended", "Incredible Data Structures lecturer. Every concept is visualized on the projector.", ["Inspirational", "Clear grading"], "Computer Science Student", 5, 2),
                (4, 5, "mandatory", "Tough labs but you actually learn how to code. Be ready for pop quizzes.", ["Tough grader"], "Data Science Student", 2, 14),
                (3, 4, "recommended", "Excellent content, grading a bit harsh on the final project.", ["Tough grader"], "Software Engineering Student", 0, 40),
            ],
        },
    },
    {
        "name": "Gulnur Serikova",
        "department": "Physics",
        "courses": {
            "PHYS101": [
                (4, 4, "mandatory", "Lab reports are strict — follow the template exactly. Lecture itself is engaging.", ["Tough grader"], "Physics Student", 2, 7),
                (3, 5, "recommended", "Physics II is hard but she explains everything twice if asked.", ["Caring"], "Engineering Student", 1, 18),
            ],
        },
    },
    {
        "name": "Dinara Omarova",
        "department": "Foreign Languages",
        "courses": {
            "LANG101": [
                (5, 4, "mandatory", "English C1 done right — speaking every class, essays every week, real progress.", ["Caring", "Clear grading"], "International Relations Student", 3, 6),
                (4, 5, "recommended", "Amazing energy. Small group means you can't hide, which is good.", ["Inspirational"], "Computer Science Student", 1, 25),
            ],
        },
    },
    {
        "name": "Aigerim Semagulova",
        "department": "Computer Science",
        "courses": {
            "CS350": [
                (5, 5, "not_mandatory", "Machine Learning from scratch in NumPy — you finish the course actually understanding it.", ["Inspirational", "Caring"], "Data Science Student", 6, 1),
                (4, 5, "recommended", "Great theory depth; homework takes time but is worth it.", ["Clear grading"], "Computer Science Student", 2, 11),
            ],
        },
    },
    {
        "name": "Bekarys Suleimenov",
        "department": "Computer Science",
        "courses": {
            "CS210": [
                (3, 4, "mandatory", "Database Systems covers real SQL + indexing. Attendance via QR code every class.", ["Tough grader"], "Computer Science Student", 1, 16),
                (4, 4, "recommended", "Solid course. The final design project teaches you more than the lectures.", ["Clear grading"], "Data Science Student", 2, 22),
            ],
        },
    },
    {
        "name": "Alibek Bateer",
        "department": "Computer Science",
        "courses": {
            "WEB201": [
                (4, 5, "recommended", "Web Development bootcamp style — two full-stack projects by the end.", ["Inspirational"], "Computer Science Student", 3, 4),
                (5, 4, "not_mandatory", "Super practical, current stack. He answers Telegram questions at night too.", ["Caring"], "Software Engineering Student", 1, 19),
            ],
        },
    },
]

def _seed_hash(seed_key: str) -> str:
    return "seed-" + hashlib.sha256(seed_key.encode("utf-8")).hexdigest()[:48]


async def seed_if_empty(session: AsyncSession) -> bool:
    """Insert the demo catalog once. Returns True when seeding ran."""
    existing = await session.scalar(select(func.count(Professor.id)))
    if existing:
        return False

    now = datetime.now(timezone.utc)
    course_map: dict[str, Course] = {}
    for c in _COURSES:
        course = Course(**c)
        session.add(course)
        course_map[c["code"]] = course
    await session.flush()

    for prof in _PROFESSORS:
        professor = Professor(
            name=prof["name"],
            department=prof["department"],
            avatar_url=None,
        )
        session.add(professor)
        await session.flush()

        for course_code, entries in prof["courses"].items():
            course = course_map[course_code]
            easy_scores: list[int] = []
            quality_scores: list[int] = []
            for idx, (easy, quality, attendance, comment, tags, tag, likes, days_ago) in enumerate(entries):
                easy_scores.append(easy)
                quality_scores.append(quality)
                created = now - timedelta(days=days_ago, hours=idx * 7)
                session.add(
                    Review(
                        professor_id=professor.id,
                        course_id=course.id,
                        rating_easy=easy,
                        rating_quality=quality,
                        attendance_strictness=attendance,
                        comment=comment,
                        tags=tags,
                        likes_count=likes,
                        anonymous_hash=_seed_hash(f"{prof['name']}:{course_code}:{idx}"),
                        user_department_tag=tag,
                        created_at=created,
                    )
                )
        # Professor roll-up from the seed reviews.
        professor.rating_easy = round(sum(easy_scores) / len(easy_scores), 2) if easy_scores else 0.0
        professor.rating_quality = round(sum(quality_scores) / len(quality_scores), 2) if quality_scores else 0.0

    await session.commit()
    return True


# =====================================================================
# Campus Hub 示例数据（校园墙 / 社团活动 / 全局通知）
# =====================================================================

#: 演示学生账号（不会被登录流程误用：用户名形态合法但不属于真实学号）
_DEMO_STUDENTS: list[dict] = [
    {"username": "demo.dana@student.kaznu.kz", "display": "dana_k", "dept": "Computer Science Student"},
    {"username": "demo.yerlan@student.kaznu.kz", "display": "yerlan_t", "dept": "Applied Math Student"},
    {"username": "demo.madina@student.kaznu.kz", "display": "madina_s", "dept": "Physics Student"},
]

#: 帖子演示数据。``media`` 用 picsum 的**确定性**种子图（https，稳定），
#: 前端对加载失败的图片做降级隐藏，所以离线时也不会出现破图。
_DEMO_POSTS: list[dict] = [
    {
        "category": "course_review",
        "content": (
            "CS201 Data Structures (Seitkali) — 前两周一定要跟上 lab，期中之后难度陡增。"
            "板书会把每个结构画出来，期末还会给一份题型清单。想拿 A 就老老实实做 lab 3 之后的每一次练习。"
        ),
        "is_anonymous": True,
        "author_index": 0,
        "likes": 42,
        "hours_ago": 3,
        "media": [],
        "comments": [
            ("完全同意，lab 3 之后一定要自己手写一遍", True),
            ("题型清单会发在 Telegram 班群里吗？", True),
            ("他 office hour 也很好问，别害羞", False, 1),
        ],
    },
    {
        "category": "lost_found",
        "content": (
            "在 4 号楼 305 教室丢了一个深蓝色保温杯（杯身有白色贴纸），大概是周三下午 3 点那节课。"
            "如果有同学看到麻烦 comment 一下，谢谢 🙏"
        ),
        "is_anonymous": True,
        "author_index": 2,
        "likes": 8,
        "hours_ago": 6,
        "media": ["https://picsum.photos/seed/kaznu-bottle/800/520"],
        "comments": [("刚在 305 讲台抽屉里看到一个，去问问助教", True)],
    },
    {
        "category": "hackathon",
        "content": (
            "准备组队参加 10 月的 KazNU Hackathon（赛道：智慧校园）。"
            "目前 2 人（后端 + iOS)，还缺 1 个会 Figma/前端的同学。有作品集更好，没有也行，关键是能一起熬夜 😄"
        ),
        "is_anonymous": False,
        "author_index": 0,
        "likes": 27,
        "hours_ago": 9,
        "media": [],
        "comments": [
            ("前端在这！做过两个 React 项目，私信聊", True),
            ("什么时候截止报名？", True),
        ],
    },
    {
        "category": "housing",
        "content": (
            "Кто-нибудь сдаёт комнату рядом с кампусом на зимний семестр? "
            "Ищу недалеко от Тимирязева, желательно с мебелью. Готов заселиться с 1 декабря."
        ),
        "is_anonymous": False,
        "author_index": 2,
        "likes": 15,
        "hours_ago": 26,
        "media": [],
        "comments": [("Напиши в 4-й блок общежития, там часто освобождается", True)],
    },
    {
        "category": "club",
        "content": (
            "机器人社团招新啦 🤖 每周三 18:00 在 FIT 楼实验室，零基础也能来玩。"
            "做 RoboCup 备赛 + 寒假有个校级比赛，报名截止本周五。"
        ),
        "is_anonymous": False,
        "author_index": 1,
        "likes": 33,
        "hours_ago": 30,
        "media": [
            "https://picsum.photos/seed/kaznu-robot/800/520",
            "https://picsum.photos/seed/kaznu-robot-2/800/520",
        ],
        "comments": [
            ("零基础真的可以吗？我只会一点点 Python", True),
            ("可以！第一节课就是点灯 😄", False, 1),
        ],
    },
    {
        "category": "general",
        "content": "图书馆 4 楼自习室今天人特别少，安静得能听见空调声。要赶 paper 的同学可以来占位 📚",
        "is_anonymous": True,
        "author_index": 1,
        "likes": 19,
        "hours_ago": 52,
        "media": [],
        "comments": [],
    },
]

#: 社团 / 讲座活动演示数据。
#: ``approved=False`` 的那条专门用来演示后台审核流程（未审核 → 公开列表看不到）。
#: 外链均为占位地址，仅用于演示 RSVP 跳转按钮。
_DEMO_EVENTS: list[dict] = [
    {
        "club_name": "KazNU Robotics Club",
        "title": "RoboCup 校内选拔赛说明会",
        "description": "介绍今年 RoboCup 赛道规则、组队方式与备赛日程。零基础同学可先来旁听，现场有机器人演示。",
        "poster": "https://picsum.photos/seed/kaznu-event-robocup/900/560",
        "days_ahead": 2,
        "hour": 18,
        "location": "FIT Building · Lab 401",
        "register_link": "https://kaznu.kz",
        "approved": True,
    },
    {
        "club_name": "Al-Farabi Debate Society",
        "title": "英语辩论公开课：如何构建论证",
        "description": "由校辩论队教练主讲，适合准备参加国际赛事或想提升口语与逻辑的同学。现场分组练习。",
        "poster": "https://picsum.photos/seed/kaznu-event-debate/900/560",
        "days_ahead": 5,
        "hour": 16,
        "location": "Main Building · Auditorium 2",
        "register_link": "https://forms.gle/kaznu-debate-rsvp",
        "approved": True,
    },
    {
        "club_name": "KazNU Tech Society",
        "title": "KazNU Hackathon 2026 报名启动",
        "description": "48 小时线下黑客松，赛道包含智慧校园、教育科技与开放数据。提供餐食与导师，奖金池 1,000,000 ₸。",
        "poster": "https://picsum.photos/seed/kaznu-event-hackathon/900/560",
        "days_ahead": 9,
        "hour": 10,
        "location": "Innovation Hub · Floor 3",
        "register_link": "https://1losion.me",
        "approved": True,
    },
    {
        "club_name": "KazNU Music Club",
        "title": "秋季校园音乐会（待审核）",
        "description": "社团乐队与合唱团联合演出，曲目包含哈萨克民谣与流行改编。该条为**待审核**示例：在 /admin 通过后才会出现在 App 里。",
        "poster": "https://picsum.photos/seed/kaznu-event-music/900/560",
        "days_ahead": 14,
        "hour": 19,
        "location": "Palace of Students",
        "register_link": None,
        "approved": False,
    },
]

#: 全局紧急通知演示数据（1 条 danger + 1 条 warning 生效，1 条 info 已停用）。
_DEMO_NOTIFICATIONS: list[dict] = [
    {
        "title": "Exam week starts Monday",
        "message": "Midterm exam week runs Sep 21–26. Library opening hours are extended to 24/7 from Sunday.",
        "level": "danger",
        "active": True,
        "hours_ago": 3,
    },
    {
        "title": "Плановое отключение воды",
        "message": "16 сентября с 09:00 до 15:00 в главном корпусе и блоке 4 отключат воду. Запасите воду заранее.",
        "level": "warning",
        "active": True,
        "hours_ago": 8,
    },
    {
        "title": "Nauryz holiday notice",
        "message": "Campus offices will be closed Mar 21–23 for Nauryz. Classes resume Mar 24.",
        "level": "info",
        "active": False,
        "hours_ago": 220,
    },
]


async def seed_campus_if_empty(session: AsyncSession, author: User) -> bool:
    """插入 Campus Hub 演示数据；``posts`` 表非空时直接跳过（幂等）。

    ``author`` 是内置超管账号。匿名帖 / 匿名评论在库里**仍需**一个 ``user_id``
    （外键必须指向真实行），只是 API 永远不会把它发出去 —— 返回体里只有
    ``is_anonymous=True`` 和院系标签。
    """
    existing = await session.scalar(select(func.count(Post.id)))
    if existing:
        return False

    now = datetime.now(timezone.utc)

    # 演示学生账号：已存在则复用，保证函数可安全重复调用
    students: list[User] = []
    for spec in _DEMO_STUDENTS:
        user = await session.scalar(select(User).where(User.univer_username == spec["username"]))
        if user is None:
            user = User(
                univer_username=spec["username"],
                univer_email=spec["username"],
                global_display_name=spec["display"],
                department_tag=spec["dept"],
            )
            session.add(user)
            await session.flush()
        students.append(user)

    def pick(index: int | None) -> User:
        """``index`` 指向 ``_DEMO_STUDENTS``；``None`` = 用超管账号。"""
        if index is None or not students:
            return author
        return students[index % len(students)]

    for spec in _DEMO_POSTS:
        created = now - timedelta(hours=spec["hours_ago"])
        post = Post(
            user_id=pick(spec.get("author_index")).id,
            is_anonymous=spec["is_anonymous"],
            category=spec["category"],
            content=spec["content"],
            media_urls=spec["media"] or None,
            likes_count=spec["likes"],
            created_at=created,
        )
        session.add(post)
        await session.flush()

        for idx, entry in enumerate(spec["comments"]):
            content, is_anonymous = entry[0], entry[1]
            commenter_index = entry[2] if len(entry) > 2 else None
            session.add(
                PostComment(
                    post_id=post.id,
                    user_id=pick(commenter_index).id,
                    is_anonymous=is_anonymous,
                    content=content,
                    created_at=created + timedelta(minutes=25 * (idx + 1)),
                )
            )

    for spec in _DEMO_EVENTS:
        event_time = (now + timedelta(days=spec["days_ahead"])).replace(
            hour=spec["hour"], minute=0, second=0, microsecond=0
        )
        session.add(
            ClubEvent(
                club_name=spec["club_name"],
                title=spec["title"],
                description=spec["description"],
                poster_url=spec["poster"],
                event_time=event_time,
                location=spec["location"],
                register_link=spec["register_link"],
                is_approved=spec["approved"],
            )
        )

    for spec in _DEMO_NOTIFICATIONS:
        session.add(
            GlobalNotification(
                title=spec["title"],
                message=spec["message"],
                level=spec["level"],
                is_active=spec["active"],
                created_at=now - timedelta(hours=spec["hours_ago"]),
            )
        )

    await session.commit()
    return True


# =====================================================================
# 课程资料（首页「最新资料」卡片）—— 独立判空
# =====================================================================

#: 演示资料。``hours_ago`` 越小越新 —— 首页卡片取的就是最新的那条。
#: 文件名刻意做成「课程 - Lecture N.pdf」这种真实命名习惯（需求里的示例形状）。
_DEMO_MATERIALS: list[dict] = [
    {
        "course_code": "CS 201",
        "course_title": "Data Structures & Algorithms",
        "professor_name": "Akhmetov N.T.",
        "file_name": "Data Structures - Lecture 3.pdf",
        "file_format": "PDF",
        "size_label": "3.2 MB",
        "pages": 48,
        "hours_ago": 3,
        "uploaded_by": "Akhmetov N.T.",
    },
    {
        "course_code": "CS 201",
        "course_title": "Data Structures & Algorithms",
        "professor_name": "Akhmetov N.T.",
        "file_name": "Assignment 3 - Starter Code",
        "file_format": "ZIP",
        "size_label": "12 MB",
        "pages": None,
        "hours_ago": 26,
        "uploaded_by": "Akhmetov N.T.",
    },
    {
        "course_code": "MATH 201",
        "course_title": "Higher Mathematics II",
        "professor_name": "Bekova A.K.",
        "file_name": "Differential Equations - Lecture Notes",
        "file_format": "PPT",
        "size_label": "6 MB",
        "pages": None,
        "hours_ago": 30,
        "uploaded_by": "Bekova A.K.",
    },
    {
        "course_code": "PHYS 120",
        "course_title": "Physics Lab",
        "professor_name": "Serikova G.M.",
        "file_name": "Experiment 2 data sheet",
        "file_format": "XLS",
        "size_label": "0.4 MB",
        "pages": None,
        "hours_ago": 52,
        "uploaded_by": "Serikova G.M.",
    },
    {
        "course_code": "MATH 150",
        "course_title": "Linear Algebra",
        "professor_name": "Akhmetov N.T.",
        "file_name": "Linear Algebra and its Applications (4th ed.)",
        "file_format": "PDF",
        "size_label": "42 MB",
        "pages": 714,
        "hours_ago": 96,
        "uploaded_by": "Library",
    },
    {
        "course_code": "LANG 310",
        "course_title": "English C1 — Academic Writing",
        "professor_name": "Ivanova O.P.",
        "file_name": "Academic Writing Handbook",
        "file_format": "DOC",
        "size_label": "0.8 MB",
        "pages": 96,
        "hours_ago": 120,
        "uploaded_by": "Ivanova O.P.",
    },
]


async def seed_materials_if_empty(session: AsyncSession) -> bool:
    """插入演示课程资料；``course_materials`` 非空时跳过（幂等）。

    独立判空是刻意的：线上的库早就有了 posts / 教授数据，
    若和 ``seed_campus_if_empty`` 共用判空条件，新表永远补不上数据。
    """
    existing = await session.scalar(select(func.count(CourseMaterial.id)))
    if existing:
        return False

    now = datetime.now(timezone.utc)
    for spec in _DEMO_MATERIALS:
        session.add(
            CourseMaterial(
                course_code=spec["course_code"],
                course_title=spec["course_title"],
                professor_name=spec["professor_name"],
                file_name=spec["file_name"],
                file_format=spec["file_format"],
                size_label=spec["size_label"],
                pages=spec["pages"],
                uploaded_by=spec["uploaded_by"],
                is_visible=True,
                created_at=now - timedelta(hours=spec["hours_ago"]),
            )
        )
    await session.commit()
    return True


# =====================================================================
# 社团申请（Campus Hub → Clubs）—— 独立判空
# =====================================================================

#: 演示社团。``status`` 里混入一条 ``pending`` 是刻意的 ——
#: 让管理员一进 /admin 就能看到"待审核"长什么样，而不是只看到已通过的。
_DEMO_CLUBS: list[dict] = [
    {
        "club_name": "ACM Code Club",
        "category": "tech",
        "description": (
            "Weekly competitive programming sessions, mock interviews and a "
            "semester-long project team. Beginners welcome — we pair you with a mentor."
        ),
        "contact_name": "Campus Assistant",
        "contact_telegram": "@acm_kaznu",
        "status": "approved",
        "days_ago": 12,
    },
    {
        "club_name": "Dance Society",
        "category": "arts",
        "description": "Hip-hop, contemporary and folk dance crews. Open rehearsals every Thursday.",
        "contact_name": "Campus Assistant",
        "contact_telegram": "@kaznu_dance",
        "status": "approved",
        "days_ago": 8,
    },
    {
        "club_name": "Debate Union",
        "category": "academic",
        "description": "Parliamentary debate training in EN / KZ / RU. We compete across Almaty.",
        "contact_name": "Campus Assistant",
        "contact_telegram": "@kaznu_debate",
        "status": "approved",
        "days_ago": 4,
    },
    {
        "club_name": "Astro Photography Lab",
        "category": "media",
        "description": "Night-sky shoots from the observatory roof. Waiting for staff approval.",
        "contact_name": "Campus Assistant",
        "contact_telegram": "@astro_kaznu",
        "status": "pending",
        "days_ago": 1,
    },
]


async def seed_clubs_if_empty(session: AsyncSession, author: User) -> bool:
    """插入演示社团；``club_applications`` 非空时跳过（幂等）。

    ``author`` 作为申请人（外键必须指向真实行）；线上早已建好超管账号，
    所以直接复用，不额外造用户。
    """
    existing = await session.scalar(select(func.count(ClubApplication.id)))
    if existing:
        return False

    now = datetime.now(timezone.utc)
    for spec in _DEMO_CLUBS:
        session.add(
            ClubApplication(
                user_id=author.id,
                club_name=spec["club_name"],
                category=spec["category"],
                description=spec["description"],
                contact_name=spec["contact_name"],
                contact_telegram=spec["contact_telegram"],
                status=spec["status"],
                is_visible=True,
                created_at=now - timedelta(days=spec["days_ago"]),
                reviewed_at=(
                    None
                    if spec["status"] == "pending"
                    else now - timedelta(days=spec["days_ago"])
                ),
            )
        )
    await session.commit()
    return True

