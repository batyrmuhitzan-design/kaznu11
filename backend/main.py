"""Backwards-compatible entrypoint for `uvicorn main:app` run from backend/.

Production code lives in the `app` package (app/main.py).
"""
from app.main import app  # noqa: F401
