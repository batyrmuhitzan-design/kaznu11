"""Smoke test for the 2.0 backend without PostgreSQL (python tests/smoke_test.py)."""
from __future__ import annotations

import asyncio
import os
import sys

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["SEED_ON_STARTUP"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from app.bootstrap import ensure_super_admin  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402


async def check(client: AsyncClient) -> None:
    r = await client.get("/")
    assert r.status_code == 200
    print("GET / ok")

    r = await client.get("/api/v1/professors", params={"q": "Akhmetov"})
    profs = r.json()
    assert r.status_code == 200 and profs and profs[0]["name"] == "Nurzhan Akhmetov", r.text
    print("professors?q=Akhmetov ok ->", profs[0]["name"])

    r = await client.get("/api/v1/professors", params={"q": "Bekova"})
    pid = r.json()[0]["id"]

    r = await client.get(f"/api/v1/professors/{pid}")
    assert r.status_code == 200 and r.json()["review_count"] > 0
    print("professor detail ok courses =", [c["code"] for c in r.json()["courses"]])

    r = await client.get("/api/v1/reviews", params={"professor_id": pid})
    reviews = r.json()
    assert reviews and all("user_department_tag" in x and "anonymous_hash" not in x for x in reviews)
    assert all("global_display_name" not in x for x in reviews)
    print("reviews anonymized ok:", len(reviews))

    r = await client.post("/api/v1/auth/login", json={"username": "20260001", "password": "123456"})
    assert r.status_code == 200, r.text
    login = r.json()
    token = login["access_token"]
    print("login ok name =", login["user"]["global_display_name"], "is_new =", login["is_new"])

    r2 = await client.post("/api/v1/auth/login", json={"username": "20260001", "password": "123456"})
    assert r2.json()["user"]["id"] == login["user"]["id"]
    print("second login reuses account ok")

    r = await client.patch(
        "/api/v1/me/display-name",
        json={"display_name": "zhasulan_kbtu"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200 and r.json()["global_display_name"] == "zhasulan_kbtu", r.text
    print("PATCH /me/display-name ok")

    r = await client.post("/api/v1/auth/login", json={"username": "hello_world", "password": "x"})
    assert r.status_code == 403, r.text
    print("non-Univer login rejected ok")

    r = await client.get("/api/v1/professors", params={"q": "Bateer"})
    pid2 = r.json()[0]["id"]
    detail = (await client.get(f"/api/v1/professors/{pid2}")).json()
    cid = detail["courses"][0]["id"]

    r = await client.get(
        "/api/v1/reviews/eligibility", params={"professor_id": pid2}, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.json()["can_review"] is True
    print("eligibility ok")

    r = await client.post(
        "/api/v1/reviews",
        json={
            "professor_id": pid2,
            "course_id": cid,
            "rating_easy": 4,
            "rating_quality": 5,
            "attendance_strictness": "not_mandatory",
            "comment": "Great course, highly recommend.",
            "tags": ["Caring", "Clear grading"],
            "user_department_tag": "Data Science Student",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["review"]["user_department_tag"] == "Data Science Student"
    print("POST review ok")

    r = await client.post(
        "/api/v1/reviews",
        json={
            "professor_id": pid2,
            "course_id": cid,
            "rating_easy": 5,
            "rating_quality": 5,
            "attendance_strictness": "recommended",
            "comment": "Again?",
            "tags": [],
            "user_department_tag": "Data Science Student",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 409, r.text
    print("duplicate review blocked ok")

    # ---- Super Admin / Admin application / Ban ----
    r = await client.post(
        "/api/v1/admin/apply",
        json={"reason": "I want to help moderate reviews and keep the community safe for everyone."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    app_id = r.json()["application"]["id"]
    print("admin apply ok")

    # super admin login (seeded via bootstrap)
    # super admin login (seeded via bootstrap)
    r = await client.post(
        "/api/v1/auth/login",
        json={"username": settings.super_admin_username, "password": settings.super_admin_password or "123456"},
    )
    assert r.status_code == 200, r.text
    super_token = r.json()["access_token"]
    super_uid = r.json()["user"]["id"]
    print("super admin login ok, role =", r.json()["user"]["role"])

    # normal user must be forbidden from super-admin list
    r = await client.get("/api/v1/super-admin/applications", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.text
    print("super-admin gated ok")

    r = await client.get(
        "/api/v1/super-admin/applications",
        params={"status": "pending"},
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200 and any(a["id"] == app_id for a in r.json()), r.text
    print("super admin sees applications ok")

    r = await client.post(
        f"/api/v1/super-admin/applications/{app_id}/handle",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200 and r.json()["applicant_role"] == "admin", r.text
    print("application approved -> role upgraded to admin")

    r = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["role"] == "admin", r.text
    print("applicant /me role now admin")

    # ban a second fresh account
    r2login = await client.post("/api/v1/auth/login", json={"username": "20260002", "password": "123456"})
    assert r2login.status_code == 200, r2login.text
    victim_token = r2login.json()["access_token"]
    victim_uid = r2login.json()["user"]["id"]
    r = await client.post(
        f"/api/v1/super-admin/users/{victim_uid}/ban",
        json={"is_banned": True},
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 200 and r.json()["user"]["is_banned"] is True, r.text
    r = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {victim_token}"})
    assert r.status_code == 403, r.text
    print("banned user is blocked ok")

    # super admin cannot be banned
    r = await client.post(
        f"/api/v1/super-admin/users/{super_uid}/ban",
        json={"is_banned": True},
        headers={"Authorization": f"Bearer {super_token}"},
    )
    assert r.status_code == 403, r.text
    print("super admin cannot be banned ok")

    assert (await client.get("/api/schedule?student_id=20260001")).status_code == 200
    assert (await client.get("/api/news")).status_code == 200
    print("legacy /api/schedule + /api/news ok")

    r = await client.get("/api/v1/courses", params={"q": "CS201"})
    assert r.status_code == 200 and r.json()
    print("courses?q=CS201 ok ->", r.json()[0]["code"])


async def main() -> None:
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
        await ensure_super_admin(session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await check(client)
    print("All backend smoke tests passed OK")


if __name__ == "__main__":
    asyncio.run(main())
