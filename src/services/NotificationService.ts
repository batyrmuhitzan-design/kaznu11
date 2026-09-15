/**
 * 通知中心 —— 真实后端接入（替代原来写死 3 条假数据的 `views/Notifications.tsx` 数据源）。
 *
 * 三类通知在前端的呈现：
 *
 * | 类型       | 后端存放                                   | 前端处理                              |
 * |------------|--------------------------------------------|---------------------------------------|
 * | 点赞/评论/私信 | ``user_notifications``（每人一行，is_read） | 列表 + 红点 + 点进跳 route            |
 * | 官方公告   | ``user_notifications``（kind=official）     | 同上，图标用 📢                        |
 * | 全校广播   | ``global_notifications``（一行，游标已读）  | 顶部 Banner（全局，任意 Tab 都弹）      |
 *
 * 实时通路复用私信那条 WebSocket：服务端会往同一连接推
 * ``{"type":"notification",...}`` 与 ``{"type":"broadcast",...}``（见 backend/app/push.py），
 * 所以 ``App.tsx`` 里一个 ``subscribeChatEvents`` 就能同时喂饱私信与通知两个模块。
 */
import { useEffect, useState } from "react";
import type { NotificationLevel } from "../data/campusDemo";
import { postSystemBannerNow } from "../native/notifications";
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { rmpEnsureToken } from "./ProfReviewsService";

const NOTIF_API = `${API_BASE_URL}/api/v1`;

export interface NotificationItem {
  id: string;
  /** like | comment | message | official | system */
  kind: string;
  title: string;
  body: string;
  /** 点击跳转：post / chat / news / campus / none */
  route: string;
  route_id: string | null;
  actor_name: string | null;
  is_read: boolean;
  created_at: string | null;
}

export interface BroadcastItem {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  is_read: boolean;
  created_at: string | null;
}

export interface NotificationCenter {
  items: NotificationItem[];
  broadcasts: BroadcastItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  unread_count: number;
}

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response | null> {
  const url = `${NOTIF_API}${path}`;
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

async function apiFetchAuthed(
  path: string,
  init: RequestInit = {},
  timeoutMs = 6000,
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

/** 通知中心首屏：定向通知（分页）+ 全校广播 + 未读总数。 */
export async function loadNotificationCenter(limit = 20, offset = 0): Promise<NotificationCenter | null> {
  const res = await apiFetchAuthed(`/notifications?limit=${limit}&offset=${offset}`);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as NotificationCenter;
    setNotificationUnread(data.unread_count ?? 0);
    return {
      items: data.items ?? [],
      broadcasts: data.broadcasts ?? [],
      total: data.total ?? 0,
      limit: data.limit ?? limit,
      offset: data.offset ?? offset,
      has_more: Boolean(data.has_more),
      unread_count: data.unread_count ?? 0,
    };
  } catch {
    return null;
  }
}

/** 单条已读。 */
export async function markNotificationRead(id: string): Promise<boolean> {
  const res = await apiFetchAuthed(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
  if (res?.ok) setNotificationUnread(notificationUnread - 1);
  return Boolean(res?.ok);
}

/** 全部已读（含广播读游标：服务器按时间戳推进，不写 N 行）。 */
export async function markAllNotificationsRead(): Promise<boolean> {
  const res = await apiFetchAuthed("/notifications/read", { method: "POST" });
  if (res?.ok) setNotificationUnread(0);
  return Boolean(res?.ok);
}

/** 通知未读数（红点兜底轮询）。 */
export async function fetchNotificationUnread(): Promise<number> {
  const res = await apiFetchAuthed("/notifications/unread-count");
  const data = res && res.ok ? ((await res.json()) as { notifications?: number }) : null;
  if (data && typeof data.notifications === "number") setNotificationUnread(data.notifications);
  return data?.notifications ?? notificationUnread;
}

// =====================================================================
// 未读数（Dashboard 铃铛红点 + 通知中心共用）
// =====================================================================

let notificationUnread = 0;
const unreadListeners = new Set<(count: number) => void>();

export function getNotificationUnread(): number {
  return notificationUnread;
}

export function setNotificationUnread(next: number): void {
  const value = Math.max(0, Math.round(next));
  if (value === notificationUnread) return;
  notificationUnread = value;
  unreadListeners.forEach((cb) => cb(value));
}

export function subscribeNotificationUnread(cb: (count: number) => void): () => void {
  unreadListeners.add(cb);
  cb(notificationUnread);
  return () => {
    unreadListeners.delete(cb);
  };
}

/** React Hook：任何组件（首页铃铛、通知中心标题）都能拿到实时未读数。 */
export function useNotificationUnread(): number {
  const [count, setCount] = useState(() => getNotificationUnread());
  useEffect(() => subscribeNotificationUnread(setCount), []);
  return count;
}

// =====================================================================
// 全局应用内 Banner（全校广播：任意 Tab 都能看到，与推送横幅互补）
// =====================================================================

export interface InAppBanner {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  /** broadcast = 全校广播；notification = 定向通知；content = 新官方公告 / 新社团活动 */
  origin: "broadcast" | "notification" | "content";
}

let banner: InAppBanner | null = null;
const bannerListeners = new Set<(item: InAppBanner | null) => void>();

export function subscribeBanner(cb: (item: InAppBanner | null) => void): () => void {
  bannerListeners.add(cb);
  cb(banner);
  return () => {
    bannerListeners.delete(cb);
  };
}

export function getBanner(): InAppBanner | null {
  return banner;
}

function setBanner(next: InAppBanner | null): void {
  banner = next;
  bannerListeners.forEach((cb) => cb(next));
  if (!next || hasSeenBanner(next.id)) return;
  rememberBanner(next.id);
  // 同一事件走两条通路：应用内浮层（上）+ 真实 iOS 系统横幅（下，走本地通知）
  void postSystemBannerNow({
    id: bannerNotificationId(next.id),
    threadId:
      next.origin === "broadcast"
        ? "kaznu.broadcast"
        : next.origin === "content"
          ? "kaznu.content"
          : "kaznu.notify",
    title: next.title,
    body: next.message,
  });
}

/** 已弹过横幅的 id（持久化：否则重启 App 会把同一条广播再弹一遍） */
const SEEN_BANNER_KEY = "kaznu:seenBannerIds";

function seenBannerIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_BANNER_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function hasSeenBanner(id: string): boolean {
  return seenBannerIds().includes(id);
}

function rememberBanner(id: string): void {
  try {
    localStorage.setItem(SEEN_BANNER_KEY, JSON.stringify([...seenBannerIds(), id].slice(-50)));
  } catch {
    /* 存储不可用时最多"重启后再弹一次"，不影响功能 */
  }
}

/**
 * 横幅对应的**数字通知 id**（iOS 本地通知要 int）。
 *
 * 用 80_000 段：避开课前提醒（<10_000）与即时横幅（60_000 / 70_000，见 native/notifications.ts），
 * 三者互不覆盖 —— 否则广播会把"上课提醒"顶掉。
 */
function bannerNotificationId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return 80_000 + (hash % 9_900);
}

/** 关闭当前 Banner（用户手动 × 掉，或超时自动收起）。 */
export function dismissBanner(): void {
  setBanner(null);
}

// =====================================================================
// 实时刷新信号：WS 事件到达 → 打开着的通知中心/会话列表自动重取一次
// =====================================================================

let revision = 0;
const revisionListeners = new Set<(rev: number) => void>();

export function getRealtimeRevision(): number {
  return revision;
}

export function subscribeRealtimeRevision(cb: (rev: number) => void): () => void {
  revisionListeners.add(cb);
  cb(revision);
  return () => {
    revisionListeners.delete(cb);
  };
}

function bumpRevision(): void {
  revision += 1;
  revisionListeners.forEach((cb) => cb(revision));
}

/** 私信相关事件（message/read）也会让会话列表失效，同样需要重取 */
export function notifyRealtimeChange(): void {
  bumpRevision();
}

/**
 * 把 WS 帧喂给通知模块（由 ``App.tsx`` 的全局 WS 订阅调用）。
 *
 * @returns 是否消费了该帧（false = 不是通知类事件，调用方按私信帧处理）
 */
export function handleRealtimeNotificationEvent(event: {
  type: string;
  notification?: Record<string, unknown>;
  broadcast?: Record<string, unknown>;
}): boolean {
  if (event.type === "notification" && event.notification) {
    const raw = event.notification as Partial<NotificationItem>;
    setNotificationUnread(notificationUnread + 1);
    setBanner({
      id: String(raw.id ?? `n-${Date.now()}`),
      title: String(raw.title ?? ""),
      message: String(raw.body ?? ""),
      level: "info",
      origin: "notification",
    });
    bumpRevision();
    return true;
  }
  if (event.type === "broadcast" && event.broadcast) {
    const raw = event.broadcast as Partial<BroadcastItem>;
    setBanner({
      id: String(raw.id ?? `b-${Date.now()}`),
      title: String(raw.title ?? ""),
      message: String(raw.message ?? ""),
      level: (raw.level as NotificationLevel) ?? "info",
      origin: "broadcast",
    });
    bumpRevision();
    return true;
  }
  // 新内容上线（新官方公告 / 新社团活动）—— 后端 announce_content 推的帧。
  // 走和全校广播完全相同的两条通路：应用内浮层 + **真实 iOS 系统横幅**（有声音、
  // 进通知中心、锁屏可见），这就是"有新 news / 新活动也要像课前提醒那样在应用外通知"。
  const content = (event as { content?: Record<string, unknown> }).content;
  if (event.type === "content" && content) {
    setBanner({
      id: `content:${String(content.route ?? "")}:${String(content.route_id ?? Date.now())}`,
      title: String(content.title ?? ""),
      message: String(content.body ?? ""),
      level: "info",
      origin: "content",
    });
    bumpRevision();
    return true;
  }
  // 官方公告帖：后端 create_official_post 会广播 {"type":"official", post_id}。
  // 这里做一次"有新公告"的横幅（正文要等 Feed 拉到，所以只给标题级提示）。
  if (event.type === "official") {
    setBanner({
      id: `official:${String((event as { post_id?: string }).post_id ?? Date.now())}`,
      title: "KazNU Official",
      message: String((event as { title?: string }).title ?? ""),
      level: "info",
      origin: "content",
    });
    bumpRevision();
    return true;
  }
  return false;
}

// =====================================================================
// 前台通知看护（管理端直插数据库时的兜底）
// =====================================================================

/** 前台轮询间隔（45s：够及时，又不至于费电/费流量） */
const FOREGROUND_POLL_MS = 45_000;

interface LatestBroadcast {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  created_at: string | null;
}

/**
 * 前台通知看护：登录后挂载，返回卸载函数。
 *
 * **为什么必须有它** —— 管理端发全校通知有两条路径：
 *  1) 调 `POST /notifications/broadcast`（App 内广播面板 / API）：会**同时**推 WebSocket 帧，
 *     在线用户秒到（见 `backend/app/push.py → broadcast_notification`）；
 *  2) 直接在 SQLAdmin 后台往 `global_notifications` 表插一行：**不产生任何实时帧**，
 *     只能靠轮询发现，否则用户得重启 App 才看得到（"我在管理端发了通知但 App 没反应"就是这个原因）。
 *
 * 每 45s + 每次回前台：拉一次"最新广播"与未读数 → 没弹过就弹（应用内 Banner + 真实系统横幅）。
 *
 * ⚠️ **App 被系统杀掉时收不到**：iOS 不允许常驻进程，唯一途径是 APNs 远程推送，
 * 服务器需配 `.p8` 凭据（客户端 token 上报已在 `PushRegistrationService` 就绪，配好即生效）。
 */
/**
 * 新内容看护（官方公告 / 新社团活动）。
 *
 * 与"全校广播"同样的两条通路：应用内浮层 + 真实系统横幅，只是数据源不同：
 *  - 官方公告 = Campus Feed 里 `is_official=true` 的帖子（News 已并入 Campus，
 *    官方帖就是新闻，后端按 `is_official DESC` 排序，所以 limit=5 必含最新的）；
 *  - 新活动 = `GET /club-events` 里最新的几条。
 *
 * 为什么不能只靠 WebSocket 帧：用户**离线几分钟**再回到 App 时帧已经错过，
 * 而这期间学校可能刚好发了公告 / 批了新活动。所以前台轮询一次兜底。
 *
 * ⚠️ App 被划掉时仍然收不到 —— iOS 不允许常驻。那种情况由服务端 APNs 负责
 * （`announce_official_post` / `announce_club_event` 会扇出全量设备推送）。
 */
async function pollContentUpdates(silent = false): Promise<void> {
  const res = await apiFetchAuthed("/posts?limit=5", {}, 5000);
  if (res?.ok) {
    try {
      const page = (await res.json()) as { items?: Array<Record<string, unknown>> };
      const official = (page.items ?? []).find((p) => p.is_official === true);
      if (official?.id) {
        const id = `post:${String(official.id)}`;
        if (!hasSeenBanner(id)) {
          if (silent) {
            // 首次运行只"登记已见"，不弹：否则刚装 App 登录就被历史公告刷一屏横幅
            rememberBanner(id);
          } else {
            setBanner({
              id,
              title: String(official.official_badge ?? "KazNU Official"),
              message: String(official.content ?? "").replace(/\s+/g, " ").slice(0, 120),
              level: "info",
              origin: "content",
            });
            bumpRevision();
          }
        }
      }
    } catch {
      /* 结构异常就当没有新公告 */
    }
  }

  const eventsRes = await apiFetchAuthed("/club-events?limit=3", {}, 5000);
  if (eventsRes?.ok) {
    try {
      const page = (await eventsRes.json()) as { items?: Array<Record<string, unknown>> };
      for (const event of page.items ?? []) {
        if (!event.id) continue;
        const id = `event:${String(event.id)}`;
        if (hasSeenBanner(id)) continue;
        if (silent) {
          rememberBanner(id);
          continue;
        }
        setBanner({
          id,
          title: `${String(event.club_name ?? "")} · ${String(event.title ?? "")}`,
          message: String(event.location ?? event.description ?? "").replace(/\s+/g, " ").slice(0, 120),
          level: "info",
          origin: "content",
        });
        bumpRevision();
        break; // 一轮最多提示一条，避免刚进 App 就被 5 条横幅刷屏
      }
    } catch {
      /* 同上 */
    }
  }
}

export function startNotificationWatcher(): () => void {
  let timer: number | undefined;
  let stopped = false;
  /** 第一次轮询只登记"已见"，不弹横幅（避免登录瞬间被历史内容刷屏） */
  let firstRun = true;

  const tick = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    const res = await apiFetchAuthed("/notifications/latest", {}, 5000);
    if (res && res.ok) {
      let latest: LatestBroadcast | null = null;
      try {
        latest = (await res.json()) as LatestBroadcast | null;
      } catch {
        latest = null;
      }
      if (latest?.id && !hasSeenBanner(latest.id)) {
        // 统一走 setBanner：应用内浮层 + 系统横幅 + 去重都在那里完成
        setBanner({
          id: latest.id,
          title: latest.title,
          message: latest.message,
          level: latest.level ?? "info",
          origin: "broadcast",
        });
        bumpRevision();
      }
    }
    // 新官方公告 / 新活动（离线期间错过的 WS 帧在这里补上）
    await pollContentUpdates(firstRun);
    firstRun = false;
    void fetchNotificationUnread();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };

  void tick();
  timer = window.setInterval(() => void tick(), FOREGROUND_POLL_MS);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}