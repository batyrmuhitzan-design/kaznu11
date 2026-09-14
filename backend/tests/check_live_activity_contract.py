# -*- coding: utf-8 -*-
"""Live Activity 跨端契约自检 —— Swift `ContentState` ↔ 后端 APNs payload。

    python backend/tests/check_live_activity_contract.py

为什么必须有这个：APNs 推送的 `content-state` 由 ActivityKit 用**默认 JSONDecoder**
解码，字段对不上时整条推送会被**静默丢弃**（没有任何报错），
靠人眼比对两边字段一定会漂移。这里把 Swift 的 `CodingKeys` /
`KaznuCourseAttributes` 静态属性解析出来，与 Python 侧构造的 payload 双向比对。

断言内容：
  1) ContentState.CodingKeys 与 build_content_state() 的键**完全一致**
  2) KaznuCourseAttributes 静态属性 与 build_attributes() 的键**完全一致**
  3) 枚举取值一致：phase = preClass/inClass；source = local/push
  4) Date 用 Apple 参考基准（2001-01-01），不是 Unix epoch
  5) App / Widget 两份 KaznuCourseAttributes.swift 逐字节一致（ActivityKit 硬要求）
  6) start payload 必带 attributes-type / attributes（缺了 iOS 丢弃整条推送）
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from app.live_activity_payload import (  # noqa: E402
    APPLE_REFERENCE_EPOCH,
    apple_reference_seconds,
    build_attributes,
    build_content_state,
    build_start_payload,
)

APP_ATTRS = ROOT / "ios" / "App" / "App" / "KaznuCourseAttributes.swift"
WIDGET_ATTRS = ROOT / "ios" / "App" / "KazNUWidgets" / "KaznuCourseAttributes.swift"

notes: list[str] = []
failures: list[str] = []


def ok(msg: str) -> None:
    notes.append(f"  [ok] {msg}")


def bad(msg: str) -> None:
    failures.append(f"  [!!] {msg}")


def swift_content_state_keys(text: str) -> set[str]:
    """解析 `private enum CodingKeys: String, CodingKey { ... }` 里的 case 名。"""
    block = re.search(
        r"enum CodingKeys: String, CodingKey \{(?P<body>.*?)\n\s*\}", text, re.DOTALL
    )
    if not block:
        return set()
    return set(re.findall(r"case\s+(\w+)", block.group("body")))


def swift_static_attributes(text: str) -> set[str]:
    """解析 `public struct KaznuCourseAttributes` 本体的静态属性。

    注意：文件里 `ContentState` 是**嵌套**在 ActivityAttributes 里、而且声明在静态属性之前，
    所以不能简单按位置切分，得先把嵌套结构整体摘掉再找 `public let`。
    """
    without_state = re.sub(
        r"public struct ContentState: Codable, Hashable \{.*?\n    \}",
        "",
        text,
        flags=re.DOTALL,
    )
    return set(re.findall(r"public let (\w+): String", without_state))


def swift_enum_cases(text: str, enum_name: str) -> set[str]:
    block = re.search(rf"public enum {enum_name}.*?\{{(?P<body>.*?)\n\}}", text, re.DOTALL)
    if not block:
        return set()
    return set(re.findall(r"case\s+(\w+)", block.group("body")))


def main() -> int:
    if not APP_ATTRS.exists():
        bad(f"找不到 {APP_ATTRS}")
        print("\n".join(failures))
        return 1
    swift = APP_ATTRS.read_text(encoding="utf-8")

    now = datetime(2026, 9, 14, 8, 45, tzinfo=timezone.utc)
    state = build_content_state(
        phase="preClass",
        stage_start=now,
        stage_end=now + timedelta(minutes=15),
        now=now,
        course_short="DS",
    )

    # ---- 1) ContentState 字段 ----
    swift_keys = swift_content_state_keys(swift)
    if not swift_keys:
        bad("未能从 Swift 解析出 CodingKeys（检查解析正则）")
    else:
        only_swift = sorted(swift_keys - set(state))
        only_python = sorted(set(state) - swift_keys)
        if not only_swift and not only_python:
            ok(f"ContentState.CodingKeys ↔ content-state 完全一致（{len(state)} 个字段）")
        else:
            if only_swift:
                bad(f"Swift 有、payload 没有：{only_swift} → 这些字段会取默认值")
            if only_python:
                bad(f"payload 有、Swift 没有：{only_python} → iOS 解码时会被忽略")

    # ---- 2) 静态属性 ----
    attributes = build_attributes(course_key="k", course_name="n", room="r", teacher="t")
    swift_attrs = swift_static_attributes(swift)
    if swift_attrs and swift_attrs == set(attributes):
        ok(f"KaznuCourseAttributes 静态属性 ↔ attributes 一致（{sorted(swift_attrs)}）")
    else:
        bad(f"静态属性不一致：Swift={sorted(swift_attrs)} payload={sorted(attributes)}")

    # ---- 3) 枚举取值 ----
    phases = swift_enum_cases(swift, "KaznuCoursePhase")
    if phases == {"preClass", "inClass"} and state["phase"] in phases:
        ok("phase 枚举一致：preClass / inClass")
    else:
        bad(f"phase 枚举不一致 → Swift={sorted(phases)} payload={state['phase']}")

    sources = swift_enum_cases(swift, "KaznuActivitySource")
    if sources == {"local", "push"} and state.get("source") in sources:
        ok("source 枚举一致：local / push（远端帧恒为 push）")
    else:
        bad(f"source 枚举不一致 → Swift={sorted(sources)} payload={state.get('source')}")

    # ---- 4) Date 基准 ----
    if apple_reference_seconds(APPLE_REFERENCE_EPOCH) == 0:
        ok("Date 基准 = 2001-01-01（Swift Date 默认编码；误用 Unix 会差 978307200 秒）")
    else:
        bad("Date 基准错误")

    # ---- 5) start payload 结构 ----
    start = build_start_payload(
        lesson={
            "course_key": "k",
            "name": "Data Structures",
            "short": "DS",
            "room": "305",
            "teacher": "T",
        },
        phase="preClass",
        stage_start=now,
        stage_end=now + timedelta(minutes=15),
        now=now,
    )
    aps = start["aps"]
    required = {"timestamp", "event", "content-state", "attributes-type", "attributes", "stale-date"}
    missing = sorted(required - set(aps))
    if missing:
        bad(f"start payload 缺必需键：{missing}")
    else:
        ok("start payload 含 timestamp / event / content-state / attributes-type / attributes / stale-date")
    if aps.get("attributes-type") == "KaznuCourseAttributes":
        ok("attributes-type 与 Swift 类型名一致")
    else:
        bad(f"attributes-type 不匹配 → {aps.get('attributes-type')}")

    # ---- 6) 两份副本一致 ----
    if WIDGET_ATTRS.exists():
        if APP_ATTRS.read_bytes() == WIDGET_ATTRS.read_bytes():
            ok("App / KazNUWidgets 两份 KaznuCourseAttributes.swift 逐字节一致")
        else:
            bad("两份副本不一致（ActivityKit 硬要求）")
    else:
        bad(f"缺少 Widget 侧副本：{WIDGET_ATTRS}")

    print("\n===== Live Activity 跨端契约自检（Swift ↔ APNs payload）=====")
    print("\n".join(notes))
    if failures:
        print("\n----- 问题 -----")
        print("\n".join(failures))
        return 1
    print("\n全部检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
