/**
 * 版本检测 / 自动更新服务。
 *
 * 版本元数据来源（按优先级）：
 *  1) 后端：VITE_UPDATE_API_URL（GET → { latest_version, min_supported_version, update_url, notes }）
 *  2) 演示/默认：打包内 /version.json（public/version.json）
 *
 * 判定规则：
 *  - current < latest 且 current >= min        → 可选更新（可“暂不更新”，本次启动不再提醒）
 *  - current < min_supported_version           → 强制更新（阻断页面操作，只有【立即更新】）
 */
import pkg from "../../package.json";

export const APP_VERSION = pkg.version;

export interface UpdateInfo {
  latest_version: string;
  min_supported_version: string;
  update_url: string;
  notes?: string[];
}

export type UpdateKind = "none" | "optional" | "forced";

const UPDATE_URL = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_UPDATE_API_URL) || "version.json";

function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

export async function fetchUpdateInfo(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${UPDATE_URL}${UPDATE_URL.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as UpdateInfo;
    if (!data.latest_version || !data.min_supported_version) return null;
    return data;
  } catch {
    return null;
  }
}

export function classifyUpdate(current: string, info: UpdateInfo): UpdateKind {
  if (versionAtLeast(current, info.latest_version)) return "none";
  if (versionAtLeast(current, info.min_supported_version)) return "optional";
  return "forced";
}

const SKIP_KEY = "kaznu:skipUpdateVersion";

/** “暂不更新”只对【本次启动】生效。 */
export function isOptionalSkipped(latestVersion: string): boolean {
  try {
    return sessionStorage.getItem(SKIP_KEY) === latestVersion;
  } catch {
    return false;
  }
}

export function skipOptional(latestVersion: string) {
  try {
    sessionStorage.setItem(SKIP_KEY, latestVersion);
  } catch {
    /* ignore */
  }
}

/** 打开更新页（iOS 内 WebView 尝试新窗口，失败则当前页跳转）。 */
export function openUpdateUrl(url: string) {
  if (!url) return;
  try {
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.href = url;
  } catch {
    window.location.href = url;
  }
}
