/**
 * 社团 / 组织：申请创建 + 公开列表（后端 /api/v1/clubs）。
 *
 * 与 CampusService 同一套约定：
 *  - 非 https 地址拦下不发请求；超时/失败返回 null（调用方决定回退）；
 *  - `POST /clubs/apply` 是 **multipart/form-data**（字段 + Logo 文件），
 *    所以**不能**手写 Content-Type —— 必须让浏览器自己带 boundary；
 *  - 需要登录（社团创建是实名行为），token 复用 rmpEnsureToken。
 */
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { rmpEnsureToken } from "./ProfReviewsService";

export const CLUBS_API = `${API_BASE_URL}/api/v1`;

/** 社团分类（与后端 CLUB_CATEGORIES 一一对应；文案由 i18n 渲染） */
export const CLUB_CATEGORIES = [
  "academic",
  "sports",
  "arts",
  "tech",
  "volunteer",
  "media",
] as const;

export type ClubCategory = (typeof CLUB_CATEGORIES)[number];

/** 分类 → i18n key */
export const CLUB_CATEGORY_KEY: Record<ClubCategory, string> = {
  academic: "clubCatAcademic",
  sports: "clubCatSports",
  arts: "clubCatArts",
  tech: "clubCatTech",
  volunteer: "clubCatVolunteer",
  media: "clubCatMedia",
};

/** 分类 → emoji（表单 Chip 上用，省一个图标依赖） */
export const CLUB_CATEGORY_EMOJI: Record<ClubCategory, string> = {
  academic: "🎓",
  sports: "⚽️",
  arts: "🎭",
  tech: "💻",
  volunteer: "🤝",
  media: "📸",
};

/** 公开列表里的社团（后端 ClubOut；**不含手机号**，那是私密字段） */
export interface ClubItem {
  id: string;
  club_name: string;
  category: string;
  description: string | null;
  avatar_url: string | null;
  contact_name: string | null;
  contact_telegram: string | null;
  created_at: string;
}

/** 我提交的申请（后端 ClubApplicationOut；带审核状态与备注） */
export interface ClubApplication extends ClubItem {
  status: "pending" | "approved" | "rejected";
  is_visible: boolean;
  review_note: string | null;
  contact_phone: string | null;
  reviewed_at: string | null;
}

export interface ClubApplyInput {
  clubName: string;
  category: ClubCategory;
  description?: string;
  contactName?: string;
  contactTelegram?: string;
  contactPhone?: string;
  /** 社团 Logo（已在 UploadService 里压缩过的 Blob 或原始 File） */
  avatar?: File | Blob | null;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await rmpEnsureToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 公开社团列表。失败返回 null。 */
export async function loadClubs(limit = 20): Promise<ClubItem[] | null> {
  const url = `${CLUBS_API}/clubs?limit=${limit}`;
  if (blockInsecureRequest(url)) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const page = (await res.json()) as { items?: ClubItem[] };
    return Array.isArray(page.items) ? page.items : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 我提交过的申请（含 pending / rejected，便于在 App 里看到进度）。失败返回 null。 */
export async function loadMyClubs(): Promise<ClubApplication[] | null> {
  const url = `${CLUBS_API}/clubs/mine`;
  if (blockInsecureRequest(url)) return null;
  const headers = await authHeader();
  if (!headers.Authorization) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { ...headers, Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as ClubApplication[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export type ClubApplyResult =
  | { ok: true; application: ClubApplication }
  | { ok: false; reason: "unauth" | "network" | "duplicate" | "invalid"; detail?: string };

/**
 * 提交社团创建申请（multipart/form-data）。
 *
 * 注意三件事：
 *  1. **不要手动设置 Content-Type** —— fetch 传 FormData 时会自动补上带 boundary 的头，
 *     手写会让后端解析不出任何字段（表现为"所有字段都是 None"）；
 *  2. 文件名必须带扩展名（后端按**文件魔数**校验，扩展名只用于展示）；
 *  3. 409 是"你已提交过同名社团，正在等待审核"，要单独区分给用户看，
 *     否则用户会以为是网络问题而反复重试。
 */
export async function applyForClub(input: ClubApplyInput): Promise<ClubApplyResult> {
  const url = `${CLUBS_API}/clubs/apply`;
  if (blockInsecureRequest(url)) return { ok: false, reason: "network" };

  const headers = await authHeader();
  if (!headers.Authorization) return { ok: false, reason: "unauth" };

  const form = new FormData();
  form.append("club_name", input.clubName.trim());
  form.append("category", input.category);
  if (input.description?.trim()) form.append("description", input.description.trim());
  if (input.contactName?.trim()) form.append("contact_name", input.contactName.trim());
  if (input.contactTelegram?.trim()) form.append("contact_telegram", input.contactTelegram.trim());
  if (input.contactPhone?.trim()) form.append("contact_phone", input.contactPhone.trim());
  if (input.avatar) {
    const avatar = input.avatar;
    // File 直接取原名；压缩后的 Blob 没有 name，给一个带扩展名的默认名
    // （后端按**文件魔数**校验类型，扩展名只用于展示/落盘）
    const fileName = avatar instanceof File ? avatar.name || "club-logo.jpg" : "club-logo.jpg";
    form.append("avatar", avatar, fileName);
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers, // ⚠️ 故意只带 Authorization
      body: form,
      signal: controller.signal,
    });
    if (res.status === 409) return { ok: false, reason: "duplicate" };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauth" };
    if (res.status === 422) {
      const detail = await res.text();
      return { ok: false, reason: "invalid", detail: detail.slice(0, 200) };
    }
    if (!res.ok) return { ok: false, reason: "network", detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { club: ClubApplication };
    return { ok: true, application: data.club };
  } catch (error) {
    return { ok: false, reason: "network", detail: String(error) };
  } finally {
    window.clearTimeout(timer);
  }
}
