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

from .models import Course, Professor, Review

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

