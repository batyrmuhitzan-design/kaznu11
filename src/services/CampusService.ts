/**
 * Campus Hub —— 后端接入（尽力而为）+ 离线演示数据回退。
 *
 * 与 `ProfReviewsService` 保持同一套约定：
 *  - 后端地址只有一个来源：`utils/config.ts` → https://1losion.me/api/v1；
 *  - 非 https 地址直接拦下不发请求（`blockInsecureRequest`）；
 *  - 超时 / 网络失败 / 未登录 → 返回 null，调用方回退到演示数据；
 *  - 登录拿 token 复用 `rmpEnsureToken()`（带本地缓存，避免重复登录）。
 *
 * 离线行为（与评价体系一致：离线可用）：
 *  - 只读：帖子 / 活动 / 通知全部回退到 `src/data/campusDemo.ts`；
 *  - 写入：发帖 / 评论 / 点赞在离线时落到 localStorage，并标记 `local_only`，
 *    UI 会显示"未同步"，联网后新内容会在下次拉取时与服务器内容合并展示。
 */
import {
  DEMO_COMMENTS,
  DEMO_EVENTS,
  DEMO_NOTIFICATION,
  DEMO_POSTS,
  type CampusComment,
  type CampusNotificationItem,
  type CampusPost,
  type ClubEventItem,
  type Page,
  type PostCategory,
} from "../data/campusDemo";
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { loadCommunityAccount, rmpEnsureToken } from "./ProfReviewsService";

/** Campus Hub 后端根地址（统一域名下的 /api/v1） */
export const CAMPUS_API = `${API_BASE_URL}/api/v1`;

const LOCAL_POSTS_KEY = "kaznu:campus:localPosts";
const LOCAL_COMMENTS_KEY = "kaznu:campus:localComments";
const LOCAL_LIKES_KEY = "kaznu:campus:likes";

export interface CampusSnapshot {
  posts: CampusPost[];
  events: ClubEventItem[];
  notification: CampusNotificationItem | null;
  /** live = 实时后端；demo = 离线演示数据 */
  source: "live" | "demo";
}

export interface NewPostInput {
  content: string;
  category: PostCategory;
  is_anonymous: boolean;
  media_urls: string[];
}

export interface NewCommentInput {
  content: string;
  is_anonymous: boolean;
}

// ---------------------------------------------------------------- 底层请求

async function apiFetch(path: string, init?: RequestInit, timeoutMs = 4000): Promise<Response | null> {
  const url = `${CAMPUS_API}${path}`;
  if (blockInsecureRequest(url)) return null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    window.clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

/** 带上 Bearer token 的请求（拿不到 token 时返回 null，调用方走离线分支）。 */
async function apiFetchAuthed(
  path: string,
  init: RequestInit = {},
  timeoutMs = 4500,
): Promise<Response | null> {
  const token = await rmpEnsureToken();
  if (!token) return null;
  return apiFetch(
    path,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    },
    timeoutMs,
  );
}

// ------------------------------------------------------------ 本地离线存储

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储不可用（隐私模式）时静默降级 */
  }
}

function localPosts(): CampusPost[] {
  return readJson<CampusPost[]>(LOCAL_POSTS_KEY, []).filter((p) => p && p.id);
}

function localComments(postId: string): CampusComment[] {
  return readJson<CampusComment[]>(`${LOCAL_COMMENTS_KEY}:${postId}`, []).filter((c) => c && c.id);
}

function localLikedIds(): string[] {
  return readJson<string[]>(LOCAL_LIKES_KEY, []);
}

function setLocalLiked(postId: string, liked: boolean): void {
  const ids = new Set(localLikedIds());
  if (liked) ids.add(postId);
  else ids.delete(postId);
  writeJson(LOCAL_LIKES_KEY, [...ids]);
}

/** 把本地点赞状态套到列表上（服务器返回的 liked 优先，离线数据用本地记录）。 */
function applyLocalLikes(posts: CampusPost[]): CampusPost[] {
  const liked = new Set(localLikedIds());
  return posts.map((p) => (p.local_only ? p : { ...p, liked: p.liked || liked.has(p.id) }));
}

function newLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- 读接口

/**
 * 拉取 Campus Hub 首屏数据（帖子流 / 活动 / 紧急通知）。
 *
 * 三项各自独立：某一项失败不影响其它项；帖子或活动拉不到时整体标记 source="demo"，
 * 界面会显示"离线演示数据"角标（与 ProfReviews 的 live/demo 角标一致）。
 */
export async function loadCampus(
  category: PostCategory | "all" = "all",
  limit = 20,
): Promise<CampusSnapshot> {
  const query = category !== "all" ? `&category=${category}` : "";
  const [postsRes, eventsRes, notifRes] = await Promise.all([
    apiFetch(`/posts?limit=${limit}${query}`),
    apiFetch("/club-events?limit=20"),
    apiFetch("/notifications/latest"),
  ]);

  const livePosts =
    postsRes && postsRes.ok ? ((await postsRes.json()) as Page<CampusPost>) : null;
  const liveEvents =
    eventsRes && eventsRes.ok ? ((await eventsRes.json()) as Page<ClubEventItem>) : null;

  // 注意：通知接口在"当前没有生效通知"时也会返回 200 + null，
  // 这与"请求失败"必须区分开（否则会误显示演示通知）。
  let notification: CampusNotificationItem | null = null;
  let notificationLive = false;
  if (notifRes && notifRes.ok) {
    notificationLive = true;
    notification = (await notifRes.json()) as CampusNotificationItem | null;
  }

  const isLive = Boolean(livePosts && liveEvents);
  const serverPosts = livePosts ? livePosts.items : DEMO_POSTS;
  const local = localPosts().filter((p) => category === "all" || p.category === category);
  const filtered = category === "all" ? serverPosts : serverPosts.filter((p) => p.category === category);

  return {
    // 本地未同步的帖子排最前（它们是最新创建的）
    posts: [...local, ...applyLocalLikes(filtered)],
    events: liveEvents ? liveEvents.items : DEMO_EVENTS,
    notification: notificationLive ? notification : DEMO_NOTIFICATION,
    source: isLive ? "live" : "demo",
  };
}

/** 某篇帖子的评论（本地未同步的追加在末尾）。 */
export async function loadPostComments(
  postId: string,
): Promise<{ items: CampusComment[]; source: "live" | "demo" }> {
  const local = localComments(postId);
  const res = await apiFetch(`/posts/${postId}/comments?limit=100`);
  if (res && res.ok) {
    const page = (await res.json()) as Page<CampusComment>;
    return { items: [...page.items, ...local], source: "live" };
  }
  return {
    items: [...DEMO_COMMENTS.filter((c) => c.post_id === postId), ...local],
    source: "demo",
  };
}

// ---------------------------------------------------------------- 写接口

/**
 * 点赞 / 取消赞。先给出乐观结果（UI 立即响应），再尝试同步到后端。
 * `synced=false` 表示只记在本地（离线或本地帖）。
 */
export async function togglePostLike(
  post: CampusPost,
): Promise<{ post: CampusPost; synced: boolean }> {
  const nextLiked = !post.liked;
  const optimistic: CampusPost = {
    ...post,
    liked: nextLiked,
    likes_count: Math.max(0, post.likes_count + (nextLiked ? 1 : -1)),
  };

  if (post.local_only) return { post: optimistic, synced: false };

  const res = await apiFetchAuthed(`/posts/${post.id}/like`, { method: "POST" }, 3500);
  if (res && res.ok) {
    const data = (await res.json()) as { likes_count: number; liked: boolean };
    setLocalLiked(post.id, data.liked);
    return { post: { ...post, likes_count: data.likes_count, liked: data.liked }, synced: true };
  }

  setLocalLiked(post.id, nextLiked);
  return { post: optimistic, synced: false };
}

/** 发帖。成功 → 服务器数据；失败 → 落本地并标记"未同步"。 */
export async function submitCampusPost(
  input: NewPostInput,
): Promise<{ post: CampusPost; synced: boolean }> {
  const res = await apiFetchAuthed("/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res && res.status === 201) {
    const data = (await res.json()) as { post: CampusPost };
    return { post: data.post, synced: true };
  }

  const acc = loadCommunityAccount();
  const post: CampusPost = {
    id: newLocalId("local-post"),
    category: input.category,
    content: input.content,
    media_urls: input.media_urls,
    is_anonymous: input.is_anonymous,
    author: {
      is_anonymous: input.is_anonymous,
      name: input.is_anonymous ? null : acc.displayName,
      department_tag: acc.departmentTag,
    },
    likes_count: 0,
    comment_count: 0,
    liked: false,
    created_at: new Date().toISOString(),
    local_only: true,
  };
  writeJson(LOCAL_POSTS_KEY, [post, ...localPosts()].slice(0, 50));
  return { post, synced: false };
}

/** 评论。成功 → 服务器数据；失败 → 落本地。 */
export async function submitCampusComment(
  postId: string,
  input: NewCommentInput,
): Promise<{ comment: CampusComment; synced: boolean }> {
  const res = await apiFetchAuthed(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res && res.status === 201) {
    const data = (await res.json()) as { comment: CampusComment };
    return { comment: data.comment, synced: true };
  }

  const acc = loadCommunityAccount();
  const comment: CampusComment = {
    id: newLocalId("local-comment"),
    post_id: postId,
    content: input.content,
    is_anonymous: input.is_anonymous,
    author: {
      is_anonymous: input.is_anonymous,
      name: input.is_anonymous ? null : acc.displayName,
      department_tag: acc.departmentTag,
    },
    created_at: new Date().toISOString(),
    local_only: true,
  };
  writeJson(`${LOCAL_COMMENTS_KEY}:${postId}`, [...localComments(postId), comment]);
  return { comment, synced: false };
}
