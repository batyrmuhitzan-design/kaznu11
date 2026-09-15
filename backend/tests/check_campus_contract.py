# -*- coding: utf-8 -*-
"""Campus Hub + 课程资料 + 社团 前后端契约自检 —— 比对后端 OpenAPI 模型 与 前端 TypeScript 接口。

    python backend/tests/check_campus_contract.py

为什么需要这个：前后端各写一份类型定义，靠人眼比对必然会漂移。
这里直接把 FastAPI 生成的 OpenAPI schema 字段集，和前端 TS 接口字段集做双向比对：

  * 后端有的字段，前端必须有（否则前端会拿到 undefined）；
  * 前端多出来的字段，只允许显式登记在 TS_ONLY 里的（例如离线标记 local_only）。

断言内容：
  1) 8 组模型 + 作者子结构 + 统一分页信封 Page[T] 的字段完全对齐
  2) 前端 Page<T> 与后端 Page[T] 的字段一致（items/total/limit/offset/has_more）
  3) 枚举一致：POST_CATEGORIES / CLUB_CATEGORIES / MATERIAL_FORMATS
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
TS_MATERIAL_FILE = ROOT / "src" / "services" / "MaterialService.ts"
TS_CLUB_FILE = ROOT / "src" / "services" / "ClubService.ts"

#: (前端 TS 接口名, 后端 Pydantic 模型名)
PAIRS = [
    ("CampusPost", "PostOut"),
    ("CampusComment", "CommentOut"),
    ("CampusAuthor", "PostAuthorOut"),
    ("ClubEventItem", "ClubEventOut"),
    ("CampusNotificationItem", "GlobalNotificationOut"),
    # ---- 本轮新增：课程资料 + 社团申请 ----
    ("MaterialItem", "MaterialOut"),
    ("MaterialSummary", "MaterialSummaryOut"),
    ("ClubItem", "ClubOut"),
    ("ClubApplication", "ClubApplicationOut"),
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
    """从 .ts 文件里抽出 `export interface X { ... }` 的字段名集合。

    支持 `export interface X extends Y {`（如 `ClubApplication extends ClubItem`）——
    继承来的字段由被继承的接口单独解析，这里只收本体声明的字段，比对时会对两者取并集。
    """
    out: dict[str, set[str]] = {}
    current: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        match = re.match(r"export interface (\w+)(<[^>]*>)?(\s+extends\s+(\w+))?\s*\{", line)
        if match:
            current = match.group(1)
            out[current] = set()
            parent = match.group(4)
            if parent:
                # 记录继承关系，稍后展开
                out.setdefault("__extends__", set()).add(f"{current}:{parent}")
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


def merge_ts_interfaces(*paths: Path) -> dict[str, set[str]]:
    """合并多个 TS 文件的接口定义，并展开 `extends` 继承（子接口 = 本体 ∪ 父接口）。"""
    merged: dict[str, set[str]] = {}
    extends: list[tuple[str, str]] = []
    for path in paths:
        parsed = parse_ts_interfaces(path)
        for parent_link in parsed.pop("__extends__", set()):
            child, parent = parent_link.split(":", 1)
            extends.append((child, parent))
        for name, fields in parsed.items():
            merged.setdefault(name, set()).update(fields)
    for _ in range(3):  # 三层足够（当前只有一层继承）
        for child, parent in extends:
            if child in merged and parent in merged:
                merged[child] = merged[child] | merged[parent]
    return merged


async def _main() -> None:
    # 延迟导入：需要先设好环境变量
    import main as entrypoint  # noqa: F401

    schema = entrypoint.app.openapi()
    models = schema.get("components", {}).get("schemas", {})
    ts = merge_ts_interfaces(TS_FILE, TS_MATERIAL_FILE, TS_CLUB_FILE)

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
    from app.models import CLUB_CATEGORIES, MATERIAL_FORMATS, POST_CATEGORIES

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

    # ---- 社团分类枚举（后端 CLUB_CATEGORIES vs 前端 ClubService）----
    club_text = TS_CLUB_FILE.read_text(encoding="utf-8")
    club_block = club_text.split("export const CLUB_CATEGORIES")[1].split("] as const")[0]
    ts_club_categories = set(re.findall(r'"(\w+)"', club_block))
    if ts_club_categories == set(CLUB_CATEGORIES):
        ok(f"社团分类枚举一致：{sorted(CLUB_CATEGORIES)}")
    else:
        bad(
            "社团分类枚举不一致 —— "
            f"后端独有 {sorted(set(CLUB_CATEGORIES) - ts_club_categories)}，"
            f"前端独有 {sorted(ts_club_categories - set(CLUB_CATEGORIES))}"
        )

    # ---- 资料格式枚举（后端 MATERIAL_FORMATS vs 前端 MaterialService）----
    material_text = TS_MATERIAL_FILE.read_text(encoding="utf-8")
    ts_formats = set(re.findall(r'"([A-Z]{3})"', material_text.split("MaterialFormat =")[1].split(";")[0]))
    if ts_formats == set(MATERIAL_FORMATS):
        ok(f"资料格式枚举一致：{sorted(MATERIAL_FORMATS)}")
    else:
        bad(
            "资料格式枚举不一致 —— "
            f"后端独有 {sorted(set(MATERIAL_FORMATS) - ts_formats)}，"
            f"前端独有 {sorted(ts_formats - set(MATERIAL_FORMATS))}"
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
