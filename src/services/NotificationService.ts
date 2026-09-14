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
  /** broadcast = 全校广播；notification = 定向通知（点赞/评论/官方公告） */
  origin: "broadcast" | "notification";
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
  return false;
}