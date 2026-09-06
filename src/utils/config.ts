/**
 * 全局 API 配置：真机/上线时只需在这里（或 .env）改地址。
 *
 * 打包 iOS 时：
 *  - 本地后端与手机同一 WiFi：把 VITE_API_URL 设为 http://<你电脑局域网IP>:8000
 *  - 后端已部署到公网：直接把 VITE_API_URL 设为 https://你的域名
 *  - 也可以不改代码，在项目根目录建 .env 写入：
 *      VITE_API_URL=https://api.example.com
 *      VITE_GPA_API_URL=https://api.example.com
 *      VITE_STUDENT_ID=你的学号
 */

type EnvMap = {
  VITE_API_URL?: string;
  VITE_GPA_API_URL?: string;
  VITE_STUDENT_ID?: string;
};

const env = ((import.meta as unknown as { env?: EnvMap }).env ?? {}) as EnvMap;

export const API_BASE_URL = (env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
export const GPA_BASE_URL = (env.VITE_GPA_API_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
export const STUDENT_ID = env.VITE_STUDENT_ID ?? "20260001";

/** App 中所有真实数据的后端接口 */
export const API_URLS = {
  news: `${API_BASE_URL}/api/news`,
  schedule: `${API_BASE_URL}/api/schedule`,
  gpa: `${GPA_BASE_URL}/api/gpa`,
} as const;
