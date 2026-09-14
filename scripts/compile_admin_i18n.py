# -*- coding: utf-8 -*-
"""
KazNU Helper — 编译管理后台 gettext 语言包（.po → .mo）。

背景：SQLAdmin 0.31.1 只内置 en / de / az / ru / tr，中文（zh）由本仓库提供。

    backend/app/i18n.py             运行时把 zh 注册进 sqladmin.i18n
    backend/locales/translations/   .po 是源文件（可读、可 diff）
                                    .mo 是运行时真正加载的二进制

⚠️ 改完 .po 必须跑一次本脚本，否则运行/服务器上加载的还是旧的 .mo。

用法：
    python scripts/compile_admin_i18n.py          # 编译全部语言
    python scripts/compile_admin_i18n.py zh       # 只编译指定语言
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES_DIR = ROOT / "backend" / "locales" / "translations"


def main(argv: list[str]) -> int:
    try:
        from babel.messages.mofile import write_mo
        from babel.messages.pofile import read_po
    except ImportError:
        print("✗ 需要 babel，请先安装：python -m pip install babel", file=sys.stderr)
        return 1

    wanted = {arg for arg in argv[1:] if not arg.startswith("-")}
    catalogs = sorted(LOCALES_DIR.glob("*/LC_MESSAGES/*.po"))
    if not catalogs:
        print(f"✗ 未找到任何 .po 文件：{LOCALES_DIR}", file=sys.stderr)
        return 1

    compiled = 0
    for po_path in catalogs:
        locale = po_path.parents[1].name
        if wanted and locale not in wanted:
            continue

        mo_path = po_path.with_suffix(".mo")
        with po_path.open("rb") as fh:
            catalog = read_po(fh, locale=locale)
        with mo_path.open("wb") as fh:
            write_mo(fh, catalog)

        translated = sum(1 for m in catalog if m.id and m.string)
        print(
            f"✓ {locale:<4} {translated:>3} 条 → {mo_path.relative_to(ROOT)}"
            f"  ({mo_path.stat().st_size} B)"
        )
        compiled += 1

    if compiled == 0:
        print(f"✗ 没有匹配的语言包（指定：{sorted(wanted) or '全部'}）", file=sys.stderr)
        return 1

    print(f"完成：编译 {compiled} 个语言包。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
