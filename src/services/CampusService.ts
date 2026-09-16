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

// =====================================================================
// 离线发件箱（Outbox）：发帖 / 评论 / 点赞失败后自动补发
// =====================================================================

/**
 * 为什么必须有它（用户反馈："用户写的评论同步不到管理端"）
 * ----------------------------------------------------------
 * 之前的实现是"请求失败就把内容写到 localStorage 并标 `local_only`，
 * 然后**再也不管**"。结果：
 *   * 用户在弱网 / 未登录 / 后端 4xx 时发的评论**永远留在手机上**；
 *   * 管理端自然看不到 —— 不是后台的问题，是内容根本没上传。
 *
 * 现在每次失败都会**入队**，然后在以下时机自动重试：
 *   * 每次进 Campus 拉数据之前；
 *   * App 回到前台、网络恢复（online 事件）；
 *   * 每 60s 的看护循环。
 * 成功后再把本地占位内容删掉（服务器的数据接管展示）。
 */
export type OutboxKind = "post" | "comment" | "like";

export interface OutboxItem {
  /** 本地 op id（同时是本地占位内容的 id，成功后按它清理） */
  id: string;
  kind: OutboxKind;
  /** comment / like 用 */
  postId?: string;
  content?: string;
  isAnonymous?: boolean;
  category?: PostCategory;
  mediaUrls?: string[];
  /** like 的期望状态（true = 点赞，false = 取消） */
  liked?: boolean;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

const OUTBOX_KEY = "kaznu:campus:outbox";
const OUTBOX_MAX = 60;

function readOutbox(): OutboxItem[] {
  return readJson<OutboxItem[]>(OUTBOX_KEY, []).filter((item) => item && item.id && item.kind);
}

function writeOutbox(items: OutboxItem[]): void {
  writeJson(OUTBOX_KEY, items.slice(-OUTBOX_MAX));
}

/** 入队（同 id 只保留一条，避免重试叠加） */
export function enqueueOutbox(item: OutboxItem): void {
  const rest = readOutbox().filter((entry) => entry.id !== item.id);
  writeOutbox([...rest, item]);
}

export function outboxCount(): number {
  return readOutbox().length;
}

export function outboxItems(): OutboxItem[] {
  return readOutbox();
}

const outboxListeners = new Set<(count: number) => void>();

/** 订阅"待同步条数"（Campus 页据此显示「N 条未同步 · 点此重试」） */
export function subscribeOutbox(cb: (count: number) => void): () => void {
  outboxListeners.add(cb);
  cb(outboxCount());
  return () => {
    outboxListeners.delete(cb);
  };
}

function notifyOutbox(): void {
  const count = outboxCount();
  outboxListeners.forEach((cb) => cb(count));
}

/** 成功后清掉本地占位内容（服务器的数据接管展示） */
function dropLocalPlaceholder(item: OutboxItem): void {
  if (item.kind === "post") {
    writeJson(LOCAL_POSTS_KEY, localPosts().filter((post) => post.id !== item.id));
    return;
  }
  if (item.kind === "comment" && item.postId) {
    const key = `${LOCAL_COMMENTS_KEY}:${item.postId}`;
    writeJson(key, localComments(item.postId).filter((comment) => comment.id !== item.id));
  }
}

let flushing = false;

/**
 * 把发件箱里的操作按顺序补发一遍。
 *
 * 顺序很重要：**先发帖再发评论**（评论挂在帖子上），所以按 createdAt 升序处理。
 * 返回 `{sent, failed, remaining}` 便于 UI/日志展示。
 */
export async function flushCampusOutbox(): Promise<{ sent: number; failed: number; remaining: number }> {
  if (flushing) return { sent: 0, failed: 0, remaining: outboxCount() };
  const queue = readOutbox().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (queue.length === 0) return { sent: 0, failed: 0, remaining: 0 };

  flushing = true;
  let sent = 0;
  let failed = 0;
  const stillPending: OutboxItem[] = [];

  try {
    for (const item of queue) {
      try {
        if (item.kind === "post") {
          const res = await apiFetchAuthed("/posts", {
            method: "POST",
            body: JSON.stringify({
              content: item.content ?? "",
              category: item.category ?? "general",
              is_anonymous: item.isAnonymous ?? true,
              media_urls: item.mediaUrls ?? [],
            }),
          });
          if (res && res.status === 201) {
            dropLocalPlaceholder(item);
            sent += 1;
            continue;
          }
        } else if (item.kind === "comment" && item.postId) {
          const res = await apiFetchAuthed(`/posts/${item.postId}/comments`, {
            method: "POST",
            body: JSON.stringify({
              content: item.content ?? "",
              is_anonymous: item.isAnonymous ?? true,
            }),
          });
          if (res && res.status === 201) {
            dropLocalPlaceholder(item);
            sent += 1;
            continue;
          }
          // 帖子已被删除（404）→ 这条评论永远发不出去，丢弃而不是无限重试
          if (res && res.status === 404) {
            dropLocalPlaceholder(item);
            continue;
          }
        } else if (item.kind === "like" && item.postId) {
          const res = await apiFetchAuthed(`/posts/${item.postId}/like`, { method: "POST" });
          if (res && (res.ok || res.status === 404)) {
            sent += 1;
            continue;
          }
        }
      } catch {
        /* 网络异常 → 留队重试 */
      }
      stillPending.push({ ...item, attempts: item.attempts + 1 });
      failed += 1;
    }
  } finally {
    flushing = false;
  }

  writeOutbox(stillPending);
  notifyOutbox();
  return { sent, failed, remaining: stillPending.length };
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
  // 先把离线期间攒下的发帖/评论/点赞补发一遍，再拉数据 ——
  // 这样刚补发成功的内容能立刻以"服务器数据"的形态出现（而不是留在本地的占位）。
  try {
    await flushCampusOutbox();
  } catch {
    /* 补发失败不影响正常读取 */
  }

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
  // 入队：离线点赞联网后补发（点赞是开关语义，按顺序重放即可收敛到最终状态）
  enqueueOutbox({
    id: newLocalId("local-like"),
    kind: "like",
    postId: post.id,
    liked: nextLiked,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: res ? `HTTP ${res.status}` : "network",
  });
  return { post: optimistic, synced: false };
}

/** 发帖。成功 → 服务器数据；失败 → 落本地**并进发件箱**（后续自动补发）。 */
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
  enqueueOutbox({
    id: post.id,
    kind: "post",
    content: input.content,
    category: input.category,
    isAnonymous: input.is_anonymous,
    mediaUrls: input.media_urls,
    createdAt: post.created_at,
    attempts: 0,
    lastError: res ? `HTTP ${res.status}` : "network",
  });
  return { post, synced: false };
}

/** 评论。成功 → 服务器数据；失败 → 落本地**并进发件箱**（后续自动补发）。 */
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
  // 入队：联网后自动补发，否则这条评论永远只存在于本机（管理端也就看不到）
  enqueueOutbox({
    id: comment.id,
    kind: "comment",
    postId,
    content: input.content,
    isAnonymous: input.is_anonymous,
    createdAt: comment.created_at,
    attempts: 0,
    lastError: res ? `HTTP ${res.status}` : "network",
  });
  return { comment, synced: false };
}
