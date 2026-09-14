# -*- coding: utf-8 -*-
"""验证 /admin 的多语言（EN / RU / ZH）是否真的生效。

    python backend/tests/check_admin_i18n.py

无需 PostgreSQL（自动用临时 SQLite），Windows / Linux 均可直接跑。

断言内容：
  1) 语言包注册：sqladmin.i18n 的 SUPPORTED_LOCALES / translations 都包含 zh
  2) 登录页：默认英文；?lang=zh 变中文；?lang=ru 变俄文；Accept-Language 也被采纳
  3) 语言切换器在登录页与登录后的导航栏都存在（en / ru / zh 三个链接）
  4) 选择写入 kaznu_admin_lang cookie，并被后续请求沿用
  5) 登录后导航菜单 / 列标题按语言切换（业务文案，走 app/i18n.py 的 L()）
  6) L() 语义：同一文案复用同一实例（SQLAdmin 靠 == 合并分类菜单）、可哈希
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# 必须在导入入口前设置：临时 SQLite，避免依赖 Postgres
_db_file = Path(tempfile.gettempdir()) / "kaznu_check_admin_i18n.db"
if _db_file.exists():
    _db_file.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_file.as_posix()}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-admin-i18n-session-secret"

import httpx  # noqa: E402

from sqladmin import i18n as sqladmin_i18n  # noqa: E402

import main as entrypoint  # noqa: E402  ← 被测对象：仓库根 main.py

from app.bootstrap import ensure_super_admin  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.i18n import L, translate  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402

USERNAME = os.environ["SUPER_ADMIN_USERNAME"]
PASSWORD = os.environ["SUPER_ADMIN_PASSWORD"]

# 各语言下必须出现的标志性文案：(语言, 登录页标记, 导航栏标记, 列标题标记)
LOGIN_MARKERS = {
    "en": ["Username", "Password", "Login to"],
    "ru": ["Имя пользователя", "Пароль", "Вход"],
    "zh": ["用户名", "密码", "登录"],
}
NAV_MARKERS = {
    "en": ["Users", "Professors", "Reviews", "Created At"],
    "ru": ["Пользователи", "Преподаватели", "Отзывы", "Создано"],
    "zh": ["用户", "教授", "评价", "创建时间"],
}

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def note(msg: str) -> None:
    notes.append(f"       {msg}")


async def _prepare_db(app) -> None:
    await init_db()
    async with SessionLocal() as session:
        await seed_if_empty(session)
    async with SessionLocal() as session:
        await ensure_super_admin(session)
    app.state.db_ready = True


def _check_markers(where: str, text: str, locale: str, markers: dict) -> None:
    """断言 `text` 里包含该语言的全部标志性文案。"""
    missing = [m for m in markers[locale] if m not in text]
    if missing:
        bad(f"{where}（{locale}）缺少文案：{', '.join(missing)}")
    else:
        ok(f"{where}（{locale}）→ 命中 {', '.join(markers[locale])}")


async def _run() -> None:
    # ---- 1) 语言包注册 ----
    supported = list(sqladmin_i18n.SUPPORTED_LOCALES)
    registered = sorted(getattr(sqladmin_i18n, "translations", {}).keys())
    if all(code in supported for code in ("en", "ru", "zh")):
        ok(f"SUPPORTED_LOCALES 含 en/ru/zh → {supported}")
    else:
        bad(f"SUPPORTED_LOCALES 缺少语言 → {supported}")
    if "zh" in registered:
        ok(f"zh 语言包已注册（已加载 catalog：{registered}）")
    else:
        bad(f"zh 语言包未注册（已加载：{registered}）；先执行 scripts/compile_admin_i18n.py")

    app = entrypoint.app
    await _prepare_db(app)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # ---- 2) 登录页默认英文 ----
        page = await client.get("/admin/login")
        _check_markers("/admin/login 默认语言", page.text, "en", LOGIN_MARKERS)

        # ---- 3) 登录页的语言切换器（自定义模板 backend/templates/sqladmin/login.html）----
        has_links = all(f"lang={code}" in page.text for code in ("en", "ru", "zh"))
        if has_links and "Language" in page.text:
            ok("登录页含语言切换器（en / ru / zh 三个选项 + Language 标题）")
        else:
            bad("登录页缺少语言切换器（检查 backend/templates/sqladmin/login.html）")
        for label in ("English", "Русский", "中文"):
            if label not in page.text:
                bad(f"切换器缺少语言显示名：{label}")
        note("切换器显示名 English / Русский / 中文 由 babel 的 locale display_name 提供")

        # ---- 4) ?lang=zh / ?lang=ru + cookie 持久化 ----
        zh_page = await client.get("/admin/login?lang=zh")
        _check_markers("/admin/login?lang=zh", zh_page.text, "zh", LOGIN_MARKERS)
        set_cookie = zh_page.headers.get("set-cookie", "")
        if "kaznu_admin_lang=zh" in set_cookie:
            ok("?lang=zh → 写入 kaznu_admin_lang cookie（语言选择被持久化）")
        else:
            bad(f"?lang=zh 未写入语言 cookie：{set_cookie!r}")

        again = await client.get("/admin/login")
        if "用户名" in again.text:
            ok("cookie 生效：后续未带 ?lang 的请求仍是中文")
        else:
            bad("cookie 未生效：后续请求回退了语言")

        ru_page = await client.get("/admin/login?lang=ru")
        _check_markers("/admin/login?lang=ru", ru_page.text, "ru", LOGIN_MARKERS)

        await client.get("/admin/login?lang=en")  # 复位，避免影响后面登录断言

    # ---- 5) Accept-Language 协商（全新客户端、无 cookie）----
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as fresh:
        neg = await fresh.get(
            "/admin/login", headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        )
        if "用户名" in neg.text:
            ok("Accept-Language: zh-CN → 登录页自动中文（浏览器语言优先，无需先登录）")
        else:
            bad("Accept-Language: zh-CN 未生效（登录页仍非中文）")

    # ---- 6) 登录后：导航栏 / 列标题 / 动作按钮 按语言切换 ----
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as staff:
        login = await staff.post(
            "/admin/login",
            data={"username": USERNAME, "password": PASSWORD},
            follow_redirects=False,
        )
        if login.status_code in (302, 303):
            ok(f"超管登录 → {login.status_code}（进入后台）")
        else:
            bad(f"超管登录失败 → {login.status_code}（后续导航断言将不可信）")

        for locale in ("en", "ru", "zh"):
            res = await staff.get(f"/admin/user/list?lang={locale}")
            if res.status_code != 200:
                bad(f"/admin/user/list?lang={locale} → {res.status_code}")
                continue
            _check_markers("/admin/user/list 导航+列标题", res.text, locale, NAV_MARKERS)
            if not all(f"lang={code}" in res.text for code in ("en", "ru", "zh")):
                bad(f"登录后导航栏缺少语言切换器（{locale}）")

        # 列标题（业务文案，走 app/i18n.py 的 L()）
        zh_list = await staff.get("/admin/review/list?lang=zh")
        zh_markers = ("质量分", "轻松分", "考勤严格度", "点赞数")
        missing = [m for m in zh_markers if m not in zh_list.text]
        if missing:
            bad("/admin/review/list（zh）列标题缺少：" + ", ".join(missing))
        else:
            ok("/admin/review/list（zh）列标题已翻译（" + " / ".join(zh_markers) + "）")

        # 批量动作按钮（🚫 Ban / ✅ Unban 属于 UserAdmin，只有超管能看）
        user_list = await staff.get("/admin/user/list?lang=zh")
        if "封禁" in user_list.text and "解封" in user_list.text:
            ok("/admin/user/list（zh）批量动作按钮已翻译（🚫 封禁 / ✅ 解封）")
        else:
            bad("/admin/user/list（zh）批量动作按钮未翻译")

        # 审批按钮（✅ Approve / ❌ Reject 属于 AdminApplicationAdmin）
        app_list = await staff.get("/admin/admin-application/list?lang=ru")
        if "Одобрить" in app_list.text and "Отклонить" in app_list.text:
            ok("/admin/admin-application/list（ru）审批按钮已翻译（Одобрить / Отклонить）")
        else:
            bad(f"/admin/admin-application/list（ru）审批按钮未翻译（{app_list.status_code}）")

    # ---- 7) L() 的语义（SQLAdmin 依赖这些行为，回归防护）----
    if L("Users") is L("Users"):
        ok("L() 同一文案返回同一实例（SQLAdmin 用 == 合并分类菜单）")
    else:
        bad("L() 未复用实例：分类菜单可能被拆成多个下拉")

    if len({L("Users"), L("Professors"), L("Users")}) == 2:
        ok("惰性标签可哈希且相等语义正确（column_labels 会当字典键用）")
    else:
        bad("惰性标签哈希 / 相等语义异常")

    if sqladmin_i18n.BABEL_INSTALLED:
        cases = [("zh", "用户"), ("ru", "Пользователи"), ("en", "Users")]
        for locale, expected in cases:
            sqladmin_i18n.set_locale(locale)
            got = str(L("Users"))
            if got == expected:
                ok(f"set_locale('{locale}') → L('Users') = {got!r}")
            else:
                bad(f"set_locale('{locale}') → L('Users') = {got!r}，期望 {expected!r}")
        sqladmin_i18n.set_locale("zh")
        if translate("Professors") == "教授":
            ok("translate('Professors') 在 zh 下返回 '教授'")
        else:
            bad(f"translate('Professors') zh → {translate('Professors')!r}")
        sqladmin_i18n.set_locale("en")


def main() -> None:
    asyncio.run(_run())
    print("\n===== 管理后台多语言自检（EN / RU / ZH）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
