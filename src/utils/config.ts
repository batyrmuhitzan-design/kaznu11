/**
 * 全局 API 配置 —— 统一域名方案
 *
 * 生产/自建服务器：把所有后端接口放在【同一个域名】下，例如：
 *   https://1losion.me/api/news
 *   https://1losion.me/api/schedule
 *   https://1losion.me/api/gpa
 *   https://1losion.me/api/v1/professors ...
 *
 * 因此前端只需要一个基础地址变量：
 *
 *   .env（根目录）:
 *     VITE_API_URL=https://1losion.me     ← 统一域名（必填）
 *     VITE_GPA_API_URL=                            ← 留空 = 与 VITE_API_URL 同源（推荐）
 *     VITE_STUDENT_ID=20260001
 *
 *   VITE_GPA_API_URL 仅为兼容旧式“独立 GPA 服务端口(8001)”而保留：
 *   部署到自己的服务器并统一域名后，请把它留空，App 会自动回退到 VITE_API_URL。
 */

type EnvMap = {
  VITE_API_URL?: string;
  VITE_GPA_API_URL?: string;
  VITE_STUDENT_ID?: string;
};

const env = ((import.meta as unknown as { env?: EnvMap }).env ?? {}) as EnvMap;

export const API_BASE_URL = (env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
/** 统一域名：未单独配置 VITE_GPA_API_URL 时，GPA 与主后端同源。 */
export const GPA_BASE_URL = (env.VITE_GPA_API_URL?.trim() ? env.VITE_GPA_API_URL : API_BASE_URL).replace(/\/$/, "");
export const STUDENT_ID = env.VITE_STUDENT_ID ?? "20260001";

/** App 中所有真实数据的后端接口 */
export const API_URLS = {
  news: `${API_BASE_URL}/api/news`,
  schedule: `${API_BASE_URL}/api/schedule`,
  gpa: `${GPA_BASE_URL}/api/gpa`,
} as const;
