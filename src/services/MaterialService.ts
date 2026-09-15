/**
 * 课程资料（Course Materials）—— 后端接入 + 离线回退。
 *
 * 服务对象是**首页 GPA 卡右侧那张卡片**（产品修正：它原本被误写成"作业 Deadline"，
 * 实际业务是"最新课程教材 / 资料更新"）以及 Materials 页。
 *
 * 约定与 CampusService / ProfReviewsService 完全一致：
 *  - 后端地址只有一个来源 `utils/config.ts`（https://1losion.me/api/v1）；
 *  - 非 https 地址直接拦下不发请求；
 *  - 超时 / 网络失败 → 返回 null，调用方回退到本地演示数据并标注"离线"；
 *  - 读取接口**不需要登录**（公开教学资源），所以这里不带 token。
 */
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";

/** 资料接口根地址（统一域名下的 /api/v1） */
export const MATERIALS_API = `${API_BASE_URL}/api/v1`;

export type MaterialFormat = "PDF" | "PPT" | "DOC" | "XLS" | "ZIP";

/** 一条资料 —— 字段与后端 `MaterialOut`（backend/app/schemas.py）逐一对齐 */
export interface MaterialItem {
  id: string;
  course_code: string;
  course_title: string;
  professor_name: string | null;
  file_name: string;
  file_format: MaterialFormat | string;
  size_label: string | null;
  pages: number | null;
  file_url: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface MaterialSummary {
  latest: MaterialItem | null;
  total: number;
  course_count: number;
}

/** 首页卡片 / Materials 页共用的离线演示数据（离线也能看到内容，不空面板） */
export const DEMO_MATERIALS: MaterialItem[] = [
  {
    id: "demo-mat-1",
    course_code: "CS 201",
    course_title: "Data Structures & Algorithms",
    professor_name: "Akhmetov N.T.",
    file_name: "Data Structures - Lecture 3.pdf",
    file_format: "PDF",
    size_label: "3.2 MB",
    pages: 48,
    file_url: null,
    uploaded_by: "Akhmetov N.T.",
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
  {
    id: "demo-mat-2",
    course_code: "MATH 201",
    course_title: "Higher Mathematics II",
    professor_name: "Bekova A.K.",
    file_name: "Differential Equations - Lecture Notes",
    file_format: "PPT",
    size_label: "6 MB",
    pages: null,
    file_url: null,
    uploaded_by: "Bekova A.K.",
    created_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
  },
  {
    id: "demo-mat-3",
    course_code: "PHYS 120",
    course_title: "Physics Lab",
    professor_name: "Serikova G.M.",
    file_name: "Experiment 2 data sheet",
    file_format: "XLS",
    size_label: "0.4 MB",
    pages: null,
    file_url: null,
    uploaded_by: "Serikova G.M.",
    created_at: new Date(Date.now() - 52 * 3600_000).toISOString(),
  },
];

async function apiFetch(path: string, timeoutMs = 4000): Promise<Response | null> {
  const url = `${MATERIALS_API}${path}`;
  if (blockInsecureRequest(url)) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 首页卡片专用摘要：最新一条 + 总数 + 课程数。
 *
 * 后端为这个卡片专门做了 `/materials/summary` 聚合接口 —— 首页只要一个 2 行高的
 * 卡片，没必要拉整页 20 条（省流量、也省得前端自己算）。
 * 拿不到时返回 `null`，由调用方决定回退演示数据。
 */
export async function loadMaterialSummary(): Promise<MaterialSummary | null> {
  const res = await apiFetch("/materials/summary");
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as MaterialSummary;
    if (!data || typeof data.total !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/** 最新资料列表（Materials 页 / 需要更多条目时用）。失败返回 null。 */
export async function loadLatestMaterials(limit = 20): Promise<MaterialItem[] | null> {
  const res = await apiFetch(`/materials/latest?limit=${Math.max(1, Math.min(100, limit))}`);
  if (!res || !res.ok) return null;
  try {
    const page = (await res.json()) as { items?: MaterialItem[] };
    return Array.isArray(page.items) ? page.items : null;
  } catch {
    return null;
  }
}

/** 离线演示摘要（与后端同样的形状，保证 UI 分支只有一套） */
export function demoSummary(): MaterialSummary {
  return {
    latest: DEMO_MATERIALS[0],
    total: DEMO_MATERIALS.length,
    course_count: new Set(DEMO_MATERIALS.map((m) => m.course_code)).size,
  };
}

/** 相对时间（"3h ago" / "2d ago"），用于卡片上的"多久前上传"。 */
export function materialAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
