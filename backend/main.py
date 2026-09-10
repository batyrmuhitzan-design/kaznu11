"""Backwards-compatible entrypoint for `uvicorn main:app` run from backend/.

Production code lives in the `app` package (app/main.py).

也可从仓库根以 `uvicorn backend.main:app` 启动：这里会把 backend/ 注入 sys.path，
保证 `import app.main` 一定能解析（与根目录 main.py 的行为一致）。
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.main import app  # noqa: E402,F401
