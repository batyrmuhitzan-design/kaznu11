/**
 * 全局 API 配置 —— 统一域名 + 强制 HTTPS（本文件是唯一的后端地址来源）
 *
 * 其它模块一律不要硬编码域名 / IP，统一从这里取：
 *
 *   网络层 / 用途                取 自                    最终请求地址
 *   ---------------------------------------------------------------------------
 *   News / Schedule / GPA       API_URLS.*               https://1losion.me/api/...
 *   Prof Reviews (apiFetch)     RMP_API                  https://1losion.me/api/v1/...
 *   版本检查 / 自动更新          UPDATE_URL               https://1losion.me/version.json
 *   灵动岛 / 埋点等原生桥        不联网（仅本地桥接）
 *
 * 域名只有一个来源：
 *   1) 默认值（不配 .env 也正确）：https://1losion.me
 *   2) 需要切换环境时在根目录 .env 覆盖：VITE_API_URL / VITE_GPA_API_URL
 *
 * ⚠️ HTTPS 策略（本文件强制）：
 *   - 任何 http:// 的后端地址都会被自动升级成 https:// 并打印警告；
 *   - 网络层调用 `blockInsecureRequest()` 后，明文请求在生产包里不会真的发出去；
 *   - 只有本机联调可以开 `VITE_ALLOW_INSECURE_HTTP=1` 例外，且仅 dev 构建生效。
 */

/** 统一域名：KazNU Helper 前端静态站 + 后端 API（唯一后端主机） */
export const API_HOST = "https://1losion.me";

type EnvMap = {
  VITE_API_URL?: string;
  VITE_GPA_API_URL?: string;
  VITE_STUDENT_ID?: string;
  /** 仅 dev 联调：允许明文 HTTP（生产构建忽略） */
  VITE_ALLOW_INSECURE_HTTP?: string;
  DEV?: boolean;
};

const env = ((import.meta as unknown as { env?: EnvMap }).env ?? {}) as EnvMap;

/** 仅开发构建 + 显式开关时才允许明文 HTTP；真机/生产包永远是 false */
const ALLOW_INSECURE_HTTP = env.DEV === true && env.VITE_ALLOW_INSECURE_HTTP === "1";

/**
 * 规整后端地址：去空白 → 补协议 → 去尾斜杠 → 把 http:// 强制升级为 https://。
 * 传空串/undefined 时使用 fallback（默认统一域名）。
 */
export function normalizeBaseUrl(raw?: string, fallback: string = API_HOST): string {
  const trimmed = (raw ?? "").trim();
  const value = trimmed.length > 0 ? trimmed : fallback;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const normalized = withScheme.replace(/\/+$/, "");

  if (/^http:\/\//i.test(normalized)) {
    if (ALLOW_INSECURE_HTTP) {
      console.warn("[config] 已放行明文 HTTP（仅 dev 联调）：", normalized);
      return normalized;
    }
    const upgraded = normalized.replace(/^http:\/\//i, "https://");
    console.warn("[config] 后端地址为明文 HTTP，已强制升级为 HTTPS：", normalized, "→", upgraded);
    return upgraded;
  }
  return normalized;
}

/** 主后端地址（默认 https://1losion.me） */
export const API_BASE_URL = normalizeBaseUrl(env.VITE_API_URL);
/** 统一域名：未单独配置 VITE_GPA_API_URL 时，GPA 与主后端同源。 */
export const GPA_BASE_URL = normalizeBaseUrl(env.VITE_GPA_API_URL, API_BASE_URL);
export const STUDENT_ID = env.VITE_STUDENT_ID ?? "20260001";

/**
 * 请求守卫：该地址是否安全？
 *  - 相对路径 → 同源（App 内是 capacitor:// 打包资源，Web 端是同源 https）→ 放行
 *  - https: / capacitor: / file: → 放行
 *  - http: → 仅 dev 且显式开启开关时放行，否则视为不安全
 */
export function isSecureRequestUrl(url: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  let protocol: string;
  try {
    protocol = new URL(url).protocol.toLowerCase();
  } catch {
    return false;
  }
  if (protocol === "https:" || protocol === "capacitor:" || protocol === "file:") return true;
  if (protocol === "http:") return ALLOW_INSECURE_HTTP;
  return true; // mailto: / tel: 等非 HTTP 协议不归本守则管理
}

/**
 * 网络层统一入口：不安全地址直接拦下并报错，避免明文请求被系统（ATS / Mixed Content）
 * 悄悄拦掉后无从排查。返回 true 表示「已阻止，调用方应直接返回」。
 */
export function blockInsecureRequest(url: string): boolean {
  if (isSecureRequestUrl(url)) return false;
  console.error("[config] 已阻止非 HTTPS 请求（请检查 VITE_API_URL / VITE_GPA_API_URL）：", url);
  return true;
}

/** App 中所有真实数据的后端接口 */
export const API_URLS = {
  news: `${API_BASE_URL}/api/news`,
  schedule: `${API_BASE_URL}/api/schedule`,
  gpa: `${GPA_BASE_URL}/api/gpa`,
} as const;
