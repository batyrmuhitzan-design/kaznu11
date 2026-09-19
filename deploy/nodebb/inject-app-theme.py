#!/usr/bin/env python3
"""把「App 内嵌极简主题」注入 NodeBB（ACP → Appearance → Custom HTML/CSS）。

    python3 deploy/nodebb/inject-app-theme.py            # 注入（幂等，可重复跑）
    python3 deploy/nodebb/inject-app-theme.py --revert   # 清空 customCSS/customJS

为什么用写 API 而不是手点 ACP：
  · 可复现、可回滚、可进仓库（`.env` 里的 master token 已具备 admin 权限）；
  · 触发条件是 URL 带 `kz_app=1`（App 的 launch 流程会带上），
    所以**网页版与 ACP 完全不受影响**——这是"只在 App 内生效"的关键。

依据：public/openapi/write/admin/settings/setting.yaml → PUT /api/v3/admin/settings/{setting}
      （body {"value": "..."}；CSRF 必带，见 deploy/nodebb/README.md 的鉴权实测）
"""
from __future__ import annotations

import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:4567"
CSS_FILE = HERE / "app-theme.css"

#: 只在 App 内嵌会话生效：URL 带 kz_app=1 或上次已记过标记 → 给 <html> 加 .kz-app
CUSTOM_JS = """
/* KazNU Helper：仅在 App 内嵌 WebView 会话中启用极简主题 */
(function () {
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('kz_app') === '1') {
      localStorage.setItem('kz_app', '1');
    } else if (params.get('kz_app') === '0') {
      localStorage.removeItem('kz_app');
    }
    if (localStorage.getItem('kz_app') === '1') {
      document.documentElement.classList.add('kz-app');
    }
  } catch (e) { /* 隐私模式下 localStorage 不可用：忽略，仅本次不加类 */ }
})();
""".strip()


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def main() -> int:
    env = read_env()
    revert = "--revert" in sys.argv
    css = "" if revert else CSS_FILE.read_text(encoding="utf-8")
    js = "" if revert else CUSTOM_JS

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    state = {"csrf": ""}

    def csrf() -> str:
        with opener.open(urllib.request.Request(BASE + "/login"), timeout=20) as res:
            html = res.read().decode("utf-8", "ignore")
        m = re.search(r'"csrf_token"\s*:\s*"([0-9a-fA-F]+)"', html)
        state["csrf"] = m.group(1) if m else ""
        return state["csrf"]

    body = json.dumps(
        {"username": env["NODEBB_ADMIN_USER"], "password": env["NODEBB_ADMIN_PASSWORD"]}
    ).encode()
    req = urllib.request.Request(BASE + "/api/v3/utilities/login", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-csrf-token", csrf())
    with opener.open(req, timeout=25) as res:
        print(f"  登录：{res.status}")

    token = env.get("NODEBB_API_TOKEN", "")
    for setting, value in (("customCSS", css), ("customJS", js)):
        req = urllib.request.Request(
            f"{BASE}/api/v3/admin/settings/{setting}?_uid=1",
            data=json.dumps({"value": value}).encode(),
            method="PUT",
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("x-csrf-token", csrf())
        req.add_header("Authorization", f"Bearer {token}")
        try:
            with opener.open(req, timeout=40) as res:
                print(f"  [ok] {setting} → HTTP {res.status}（{len(value)} 字符）")
        except urllib.error.HTTPError as exc:
            print(f"  [!!] {setting} → HTTP {exc.code} {exc.read().decode()[:200]}")
            return 1

    # 复核：公开页面里应出现我们的样式
    with urllib.request.urlopen(BASE + "/", timeout=20) as res:
        html = res.read().decode("utf-8", "ignore")
    has_css = "kz-app" in html
    print(f"  {'[ok]' if has_css else '[!!]'} 首页已带出 kz-app 样式：{has_css}")
    print("  App 内访问入口示例： https://forum.1losion.me/?kz_app=1")
    return 0 if has_css else 1


if __name__ == "__main__":
    raise SystemExit(main())
