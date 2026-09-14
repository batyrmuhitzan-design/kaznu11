# -*- coding: utf-8 -*-
"""Campus Hub 前后端契约自检 —— 比对后端 OpenAPI 模型 与 前端 TypeScript 接口。

    python backend/tests/check_campus_contract.py

为什么需要这个：前后端各写一份类型定义，靠人眼比对必然会漂移。
这里直接把 FastAPI 生成的 OpenAPI schema 字段集，和 `src/data/campusDemo.ts`
里解析出来的 TS 接口字段集做双向比对：

  * 后端有的字段，前端必须有（否则前端会拿到 undefined）；
  * 前端多出来的字段，只允许显式登记在 TS_ONLY 里的（例如离线标记 local_only）。

断言内容：
  1) 4 组模型 + 作者子结构 + 统一分页信封 Page[T] 的字段完全对齐
  2) 前端 Page<T> 与后端 Page[T] 的字段一致（items/total/limit/offset/has_more）
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ["SUPER_ADMIN_USERNAME"] = "admin@1losion.me"
os.environ["SUPER_ADMIN_PASSWORD"] = "admin123456"
os.environ["ADMIN_SESSION_SECRET"] = "check-campus-contract-secret"

TS_FILE = ROOT / "src" / "data" / "campusDemo.ts"

#: (前端 TS 接口名, 后端 Pydantic 模型名)
PAIRS = [
    ("CampusPost", "PostOut"),
    ("CampusComment", "CommentOut"),
    ("CampusAuthor", "PostAuthorOut"),
    ("ClubEventItem", "ClubEventOut"),
    ("CampusNotificationItem", "GlobalNotificationOut"),
]

#: 后端 schema 里用于内部配置的字段，不属于业务数据
BACKEND_ONLY = {"model_config"}
#: 前端独有字段（离线/UI 标记），后端不返回，属预期差异
TS_ONLY = {"local_only"}

#: 统一分页信封的字段
PAGE_FIELDS = {"items", "total", "limit", "offset", "has_more"}

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def note(msg: str) -> None:
    notes.append(f"       {msg}")


def parse_ts_interfaces(path: Path) -> dict[str, set[str]]:
    """从 .ts 文件里抽出 `export interface X { ... }` 的字段名集合。"""
    out: dict[str, set[str]] = {}
    current: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        match = re.match(r"export interface (\w+)(<[^>]*>)?\s*\{", line)
        if match:
            current = match.group(1)
            out[current] = set()
            continue
        if current is None:
            continue
        if line.startswith("}"):
            current = None
            continue
        field = re.match(r"(\w+)\??\s*:", line)
        if field:
            out[current].add(field.group(1))
    return out


async def _main() -> None:
    # 延迟导入：需要先设好环境变量
    import main as entrypoint  # noqa: F401

    schema = entrypoint.app.openapi()
    models = schema.get("components", {}).get("schemas", {})
    ts = parse_ts_interfaces(TS_FILE)

    if not ts:
        bad(f"未能从 {TS_FILE.relative_to(ROOT)} 解析出任何接口")
        return

    for ts_name, backend_name in PAIRS:
        backend = models.get(backend_name)
        if backend is None:
            bad(f"OpenAPI 里找不到后端模型 {backend_name}")
            continue
        ts_fields = ts.get(ts_name)
        if ts_fields is None:
            bad(f"TS 文件里找不到接口 {ts_name}")
            continue

        backend_fields = {
            name for name in (backend.get("properties") or {}) if name not in BACKEND_ONLY
        }

        missing_in_ts = sorted(backend_fields - ts_fields)
        extra_in_ts = sorted(ts_fields - backend_fields - TS_ONLY)

        if missing_in_ts or extra_in_ts:
            if missing_in_ts:
                bad(f"{ts_name} 缺少后端字段：{missing_in_ts}（后端 {backend_name}）")
            if extra_in_ts:
                bad(f"{ts_name} 多出未登记字段：{extra_in_ts}")
        else:
            ok(f"{ts_name} ↔ {backend_name} 字段一致（{len(backend_fields)} 个）")

    # ---- 统一分页信封 ----
    page_names = [name for name in models if name.startswith("Page_")]
    if not page_names:
        bad("OpenAPI 里找不到分页信封 Page[T]")
    else:
        page_model = models[page_names[0]]
        page_backend = set(page_model.get("properties") or {})
        page_ts = ts.get("Page", set())
        if PAGE_FIELDS - page_backend:
            bad(f"后端 Page[T] 缺字段：{sorted(PAGE_FIELDS - page_backend)}")
        elif PAGE_FIELDS - page_ts:
            bad(f"前端 Page<T> 缺字段：{sorted(PAGE_FIELDS - page_ts)}")
        else:
            ok(f"分页信封 Page[T] 前后端一致：{sorted(PAGE_FIELDS)}")
        note(f"后端模型名：{page_names[0]}")

    # ---- 分类枚举一致性（后端 POST_CATEGORIES vs 前端 CAMPUS_CATEGORIES）----
    from app.models import POST_CATEGORIES

    ts_text = TS_FILE.read_text(encoding="utf-8")
    ts_categories = set(re.findall(r'\{\s*id:\s*"(\w+)",\s*emoji:', ts_text))
    backend_categories = set(POST_CATEGORIES)
    if ts_categories == backend_categories:
        ok(f"分类枚举一致：{sorted(backend_categories)}")
    else:
        bad(
            "分类枚举不一致 —— "
            f"后端独有 {sorted(backend_categories - ts_categories)}，"
            f"前端独有 {sorted(ts_categories - backend_categories)}"
        )


def main() -> None:
    asyncio.run(_main())
    print("\n===== Campus Hub 前后端契约自检 =====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        sys.exit(1)
    print("\n全部检查通过")


if __name__ == "__main__":
    main()
