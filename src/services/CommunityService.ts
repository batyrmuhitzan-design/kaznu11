/**
 * 社区论坛（NodeBB）入口服务。
 *
 * 设计要点（与后端 `backend/app/routers/community.py` 一一对应）：
 *  · 入口显隐由 `GET /community/status` 决定 —— 服务端没配好（域名/密钥缺失）
 *    就返回 enabled=false，前端**不显示**按钮，避免"点了没反应"；
 *  · 点按钮时用当前登录身份换一个**一次性跳转码**（60 秒、单次、绑用户），
 *    然后打开该 URL：后端 302 到论坛并顺手 `Set-Cookie`（共享 JWT），
 *    NodeBB 的 session-sharing 插件据此**免密登录/自动建号**。
 *  · 真机走 Capacitor Browser（应用内 Safari）；网页端**同页跳转**而不是 window.open
 *    —— 取码是异步的，window.open 会被浏览器当成弹窗拦掉。
 */
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { rmpEnsureToken } from "./ProfReviewsService";

const TIMEOUT_MS = 10_000;

/** 官方内嵌 WebView 插件（未安装时下面的动态 import 会失败并自动降级） */
const IN_APP_BROWSER_PKG = "@capacitor/inappbrowser";

export interface CommunityStatus {
  /** 服务端是否配置好了论坛（域名 + 共享密钥） */
  enabled: boolean;
  /** 论坛地址，例如 https://forum.1losion.me */
  forumUrl: string | null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response | null> {
  if (blockInsecureRequest(API_BASE_URL)) return null;
  const token = await rmpEnsureToken();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    console.warn(`[community] ${path} 请求失败`, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 读入口状态；任何失败都返回 null（调用方按"不显示入口"处理）。 */
export async function loadCommunityStatus(): Promise<CommunityStatus | null> {
  const res = await authedFetch("/community/status");
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { enabled?: boolean; forum_url?: string | null };
    return { enabled: Boolean(data.enabled), forumUrl: data.forum_url ?? null };
  } catch {
    return null;
  }
}

/** 打开社区论坛（免密）。返回 true 表示已发起跳转。 */
export async function openCommunityForum(): Promise<boolean> {
  const res = await authedFetch("/community/launch-token", { method: "POST" });
  if (!res || !res.ok) {
    console.warn(`[community] 换取跳转码失败：HTTP ${res?.status ?? "无响应"}`);
    return false;
  }
  let url = "";
  try {
    url = ((await res.json()) as { url?: string }).url ?? "";
  } catch {
    return false;
  }
  if (!url) return false;

  // ── 1) 首选：官方 @capacitor/inappbrowser 的**应用内 WKWebView** ──────────────
  //    为什么不用 @capacitor/browser：它在 iOS 上是 SFSafariViewController（进程外），
  //    **无法内嵌、也无法注入样式**（`windowName: '_self'` 并不是内嵌开关，别被字段名骗了）。
  //    为什么不用 iframe：NodeBB 发了 `X-Frame-Options: SAMEORIGIN` +
  //    `CSP frame-ancestors 'self'`，且从 capacitor://localhost 看属第三方 cookie，
  //    WKWebView 会拦 —— 登录态拿不到。
  //    动态 import + 兜底：插件没装时不报错，自动走下面的降级链。
  try {
    const [{ Capacitor }, inAppBrowser] = await Promise.all([
      import("@capacitor/core"),
      // 用变量 + @vite-ignore：插件未安装时不该让**打包失败**（Vite 默认会静态解析字面量 import）
      import(/* @vite-ignore */ IN_APP_BROWSER_PKG).catch(() => null),
    ]);
    const api = (inAppBrowser as unknown as { InAppBrowser?: { openInWebView?: (o: { url: string }) => Promise<unknown> } } | null)?.InAppBrowser;
    if (Capacitor.isNativePlatform() && api?.openInWebView) {
      await api.openInWebView({ url });
      return true;
    }
  } catch (error) {
    console.warn("[community] InAppBrowser 不可用，尝试降级", error);
  }

  // ── 2) 降级：Capacitor Browser（应用内 Safari，仍是系统浏览器进程）──────────
  try {
    const [{ Capacitor }, { Browser }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/browser"),
    ]);
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      return true;
    }
  } catch (error) {
    console.warn("[community] Capacitor Browser 不可用，回落到同页跳转", error);
  }
  // ── 3) 网页端：同页跳转（不会被弹窗拦截），后端 302 到论坛 ─────────────────
  window.location.href = url;
  return true;
}
