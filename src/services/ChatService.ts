/**
 * 私信 Chat —— 前端唯一的数据入口（REST 历史/发送 + WebSocket 实时）。
 *
 * 为什么两条通路都要
 * ------------------
 * | 场景                     | 走哪条                     | 原因                             |
 * |--------------------------|----------------------------|----------------------------------|
 * | 进入会话看历史           | REST GET /messages         | 请求-响应最自然，不用等 WS 建连    |
 * | 在线收发、已读、正在输入 | WebSocket                  | 秒到、省推送配额                  |
 * | WS 断线时发送            | REST POST /messages        | 消息不能因为掉线丢掉              |
 * | 掉线且连 REST 也失败     | localStorage 发件箱        | 联网后自动补发（幂等 client_id）   |
 *
 * 幂等：每条消息都带客户端生成的 ``client_id``（uuid）。服务器遇到相同 client_id
 * 直接返回老消息（``created=false``），所以"WS 发了一次 + 恢复网络后又补发"不会出现
 * 两个气泡。UI 上用 ``client_id`` 把乐观气泡替换成服务端气泡。
 *
 * 连接生命周期由 ``App.tsx`` 在登录后挂载（``attachChatRealtime``），退出登录调用
 * ``closeChatSocket``；页面层只订阅事件，不自己建连接（避免多页面各开一条）。
 */
import type { Page } from "../data/campusDemo";
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { rmpEnsureToken } from "./ProfReviewsService";

/** 私信后端根地址（与 Campus / ProfReviews 同源：https://1losion.me/api/v1） */
export const CHAT_API = `${API_BASE_URL}/api/v1`;
/** WebSocket 地址：http→ws / https→wss 由同一常量推导，避免两处各写一份域名 */
export const CHAT_WS_URL = `${CHAT_API.replace(/^http/i, "ws")}/ws/chat`;

const OUTBOX_KEY = "kaznu:chat:outbox";
/** 心跳间隔：移动网络下 NAT 会把长时间静默的连接掐掉 */
const HEARTBEAT_MS = 25_000;
/** 重连退避上限 */
const MAX_BACKOFF_MS = 15_000;
/** 应用级关闭码：服务端在握手阶段拒绝（token 失效 / 账号停用） */
const WS_UNAUTHORIZED = 4401;

export interface ChatPeer {
  id: string;
  display_name: string;
  department_tag?: string | null;
}

export interface Conversation {
  id: string;
  peer: ChatPeer;
  last_message_preview: string;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
  created_at: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  media_urls: string[];
  client_id: string | null;
  read_at: string | null;
  is_deleted: boolean;
  created_at: string | null;
  is_mine: boolean;
  /** 本地乐观气泡：还没拿到服务端回执 */
  pending?: boolean;
  /** 已进发件箱，等联网补发 */
  queued?: boolean;
  /** 服务端明确拒绝（超长 / 空消息） */
  failed?: boolean;
}

export interface ChatSendResult {
  clientId: string;
  /** 走了 REST 且成功时带上服务端消息；WS 发送时为 undefined（等广播回显） */
  message?: ChatMessage;
  /** true = 没发出去，已进发件箱 */
  queued: boolean;
}

/** 服务端 → 客户端的事件（协议见 backend/app/routers/chat.py 的 chat_socket） */
export type ChatServerEvent =
  | { type: "ready"; user_id: string; unread: number }
  | { type: "message"; message: ChatMessage }
  | { type: "read"; conversation_id: string; reader_id: string; at?: string }
  | { type: "read-ack"; conversation_id: string; marked: number }
  | { type: "typing"; conversation_id: string; user_id: string }
  | {
      /** 消息被撤回 / 被管理员下架 —— 对端 UI 立即替换成占位文案 */
      type: "message-deleted";
      conversation_id: string;
      message_id: string;
      deleted_by: "user" | "staff";
    }
  | { type: "notification"; notification: Record<string, unknown> }
  | { type: "broadcast"; broadcast: Record<string, unknown> }
  | { type: "pong" }
  | { type: "error"; reason: string; [key: string]: unknown };

export type ChatConnectionState = "idle" | "connecting" | "online" | "offline" | "unauthorized";

// =====================================================================
// 底层请求
// =====================================================================

async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response | null> {
  const url = `${CHAT_API}${path}`;
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

async function readJson<T>(res: Response | null): Promise<T | null> {
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function createClientId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* 老 WebView 没有 randomUUID */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// =====================================================================
// REST
// =====================================================================

/** 我的会话列表（按最后一条消息倒序）。 */
export async function listConversations(limit = 30, offset = 0): Promise<Page<Conversation> | null> {
  const res = await apiFetchAuthed(`/chat/conversations?limit=${limit}&offset=${offset}`);
  return readJson<Page<Conversation>>(res);
}

/**
 * 会话消息。
 *
 * ⚠️ 服务端是**倒序分页**：``offset=0`` 返回的是最新一页。调用方渲染前要 reverse
 * （``ChatDetail`` 里就是这么做的），往上翻历史用 ``offset += limit``。
 */
export async function listMessages(
  conversationId: string,
  limit = 30,
  offset = 0,
): Promise<Page<ChatMessage> | null> {
  const res = await apiFetchAuthed(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}&offset=${offset}`,
  );
  return readJson<Page<ChatMessage>>(res);
}

/** 开启（或取回已存在的）与某位用户的会话。``peerId`` 来自帖子/评论作者。 */
export async function startConversation(input: {
  peerId?: string;
  peerUsername?: string;
}): Promise<Conversation | null> {
  const body = input.peerId
    ? { peer_id: input.peerId }
    : input.peerUsername
      ? { peer_username: input.peerUsername }
      : null;
  if (!body) return null;
  const res = await apiFetchAuthed("/chat/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await readJson<{ conversation?: Conversation }>(res);
  return data?.conversation ?? null;
}

/** 进入会话时清零未读（REST 兜底；在线时会话内会优先走 WS）。 */
export async function markConversationRead(conversationId: string): Promise<number> {
  const res = await apiFetchAuthed("/chat/read", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  const data = await readJson<{ marked?: number }>(res);
  if (data && typeof data.marked === "number") setChatUnread(Math.max(0, chatUnread - data.marked));
  return data?.marked ?? 0;
}

/** 私信未读数（红点兜底轮询；主通路是 WS 的 ready / message / read 帧）。 */
export async function fetchChatUnread(): Promise<number> {
  const res = await apiFetchAuthed("/chat/unread-count");
  const data = await readJson<{ messages?: number }>(res);
  if (data && typeof data.messages === "number") setChatUnread(data.messages);
  return data?.messages ?? chatUnread;
}

// =====================================================================
// 未读数订阅（Dashboard 红点 / 会话列表共用，保证两处同步）
// =====================================================================

let chatUnread = 0;
const unreadListeners = new Set<(count: number) => void>();

export function getChatUnread(): number {
  return chatUnread;
}

export function setChatUnread(next: number): void {
  const value = Math.max(0, Math.round(next));
  if (value === chatUnread) return;
  chatUnread = value;
  unreadListeners.forEach((cb) => cb(value));
}

export function subscribeChatUnread(cb: (count: number) => void): () => void {
  unreadListeners.add(cb);
  cb(chatUnread);
  return () => {
    unreadListeners.delete(cb);
  };
}

// =====================================================================
// 发件箱（离线补发）
// =====================================================================

interface OutboxItem {
  conversation_id: string;
  body: string;
  media_urls: string[];
  client_id: string;
  at: number;
}

function readOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list)
      ? list.filter((item) => item?.conversation_id && item?.client_id)
      : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: OutboxItem[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-50)));
  } catch {
    /* 存储不可用（隐私模式）时放弃离线补发，不阻塞发送流程 */
  }
}

function enqueueOutbox(item: OutboxItem): void {
  const list = readOutbox().filter((existing) => existing.client_id !== item.client_id);
  list.push(item);
  writeOutbox(list);
}

export function chatOutboxSize(): number {
  return readOutbox().length;
}

/** 把发件箱里的消息逐条补发（WS 建连后 / 回前台时调用）。 */
export async function flushChatOutbox(): Promise<number> {
  const pending = readOutbox();
  if (pending.length === 0) return 0;
  const remaining: OutboxItem[] = [];
  let sent = 0;
  for (const item of pending) {
    const res = await apiFetchAuthed(
      `/chat/conversations/${encodeURIComponent(item.conversation_id)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          body: item.body,
          media_urls: item.media_urls,
          client_id: item.client_id,
        }),
      },
    );
    if (res && res.ok) {
      sent += 1;
      const data = await readJson<{ sent?: ChatMessage }>(res);
      if (data?.sent) emit({ type: "message", message: data.sent });
    } else if (res && res.status >= 400 && res.status < 500) {
      // 4xx = 服务端明确拒绝（超长 / 会话不存在）→ 不再重试，避免死循环
      sent += 1;
    } else {
      remaining.push(item);
    }
  }
  writeOutbox(remaining);
  return sent;
}

// =====================================================================
// WebSocket 实时通道
// =====================================================================

let socket: WebSocket | null = null;
let state: ChatConnectionState = "idle";
let heartbeat: number | undefined;
let reconnectTimer: number | undefined;
let backoff = 1_000;
/** 用户显式断开（退出登录 / 卸载）后不再自动重连 */
let manuallyClosed = false;

const eventListeners = new Set<(event: ChatServerEvent) => void>();
const stateListeners = new Set<(state: ChatConnectionState) => void>();

export function getChatConnectionState(): ChatConnectionState {
  return state;
}

export function subscribeChatConnection(cb: (state: ChatConnectionState) => void): () => void {
  stateListeners.add(cb);
  cb(state);
  return () => {
    stateListeners.delete(cb);
  };
}

/** 订阅所有服务端事件（message / notification / broadcast / typing / read …）。 */
export function subscribeChatEvents(cb: (event: ChatServerEvent) => void): () => void {
  eventListeners.add(cb);
  return () => {
    eventListeners.delete(cb);
  };
}

function emit(event: ChatServerEvent): void {
  eventListeners.forEach((cb) => {
    try {
      cb(event);
    } catch (error) {
      console.warn("[chat] 事件订阅者抛错（已隔离）:", error);
    }
  });
}

function setState(next: ChatConnectionState): void {
  if (state === next) return;
  state = next;
  stateListeners.forEach((cb) => cb(next));
}

function clearTimers(): void {
  if (heartbeat !== undefined) window.clearInterval(heartbeat);
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  heartbeat = undefined;
  reconnectTimer = undefined;
}

/** 按当前 token 拼 WS 地址（token 只能走 query —— 浏览器 WS 不支持自定义 Header）。 */
async function socketUrl(): Promise<string | null> {
  const token = await rmpEnsureToken();
  if (!token) return null;
  return `${CHAT_WS_URL}?token=${encodeURIComponent(token)}`;
}

/**
 * 建立（或复用）实时连接。
 *
 * @returns 是否已发起建连（WS 是异步的，在线状态请订阅 ``subscribeChatConnection``）
 */
export async function connectChatSocket(): Promise<boolean> {
  manuallyClosed = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return true;
  }
  const url = await socketUrl();
  if (!url) return false;
  if (blockInsecureRequest(url)) return false;

  setState("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    setState("offline");
    scheduleReconnect();
    return false;
  }
  socket = ws;

  ws.onopen = () => {
    backoff = 1_000;
    setState("online");
    heartbeat = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, HEARTBEAT_MS);
    // 断线期间攒下的消息在这里补发
    void flushChatOutbox();
    void fetchChatUnread();
  };

  ws.onmessage = (raw) => {
    let event: ChatServerEvent | null = null;
    try {
      event = JSON.parse(String(raw.data)) as ChatServerEvent;
    } catch {
      return;
    }
    if (!event || typeof event.type !== "string") return;
    if (event.type === "ready") {
      setChatUnread(event.unread ?? 0);
    } else if (event.type === "message") {
      // 收到别人发来的消息 → 红点 +1（自己发的多设备回显不算）
      const message = event.message;
      if (message && !message.is_mine) setChatUnread(chatUnread + 1);
    } else if (event.type === "read-ack") {
      setChatUnread(Math.max(0, chatUnread - (event.marked ?? 0)));
    }
    emit(event);
  };
  ws.onerror = () => {
    /* onclose 一定会跟着来，这里不重复处理 */
  };

  ws.onclose = (ev) => {
    clearTimers();
    socket = null;
    if (ev.code === WS_UNAUTHORIZED) {
      // token 失效：提示重新登录，不进入无限重连
      setState("unauthorized");
      return;
    }
    setState("offline");
    if (!manuallyClosed) scheduleReconnect();
  };

  return true;
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void connectChatSocket();
  }, backoff);
  backoff = Math.min(MAX_BACKOFF_MS, Math.round(backoff * 1.8));
}

/** 主动断开（退出登录 / App 卸载时调用），不会再自动重连。 */
export function closeChatSocket(): void {
  manuallyClosed = true;
  clearTimers();
  const ws = socket;
  socket = null;
  setState("idle");
  try {
    ws?.close(1000, "client-close");
  } catch {
    /* 已断开 */
  }
}

/** 通过 WS 发一条事件；不可用时返回 false（调用方转 REST）。 */
export function sendSocketEvent(event: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

/**
 * 发消息：优先 WS（秒到 + 不消耗推送配额），WS 不可用 → REST，REST 也失败 → 发件箱。
 *
 * @returns 客户端幂等 id（UI 用它把乐观气泡对齐成服务端气泡）与是否进了发件箱
 */
export async function sendChatMessage(
  conversationId: string,
  body: string,
  mediaUrls: string[] = [],
  clientIdOverride?: string,
): Promise<ChatSendResult> {
  // clientId 允许调用方先给：UI 必须在请求发出**之前**插入乐观气泡，
  // 之后服务端回执帧带着同一个 client_id 回来，才能真的对齐替换（见 mergeMessage）
  const clientId = clientIdOverride ?? createClientId();
  if (sendSocketEvent({ type: "send", conversation_id: conversationId, body, media_urls: mediaUrls, client_id: clientId })) {
    return { clientId, queued: false };
  }
  const res = await apiFetchAuthed(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", body: JSON.stringify({ body, media_urls: mediaUrls, client_id: clientId }) },
  );
  const data = await readJson<{ sent?: ChatMessage }>(res);
  if (data?.sent) return { clientId, message: data.sent, queued: false };
  if (res && res.status >= 400 && res.status < 500) {
    // 明确被拒（超长/空）→ 不丢进发件箱，交给 UI 标红
    return { clientId, queued: false };
  }
  enqueueOutbox({
    conversation_id: conversationId,
    body,
    media_urls: mediaUrls,
    client_id: clientId,
    at: Date.now(),
  });
  return { clientId, queued: true };
}

/** 标记已读：在线走 WS（顺带回执对方），否则走 REST。 */
export function markConversationReadSmart(conversationId: string): void {
  if (sendSocketEvent({ type: "read", conversation_id: conversationId })) return;
  void markConversationRead(conversationId);
}

/** 「正在输入…」——纯实时，不需要落库，断线就自然消失。 */
export function sendTyping(conversationId: string): void {
  sendSocketEvent({ type: "typing", conversation_id: conversationId });
}

/**
 * 合并一条服务端消息：优先用 ``client_id`` 对齐乐观气泡，其次按 id 去重。
 *
 * @returns 新的消息数组（已按时间正序，服务端气泡替换掉本地 pending 气泡）
 */
export function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const byClient = incoming.client_id
    ? list.findIndex((m) => m.client_id && m.client_id === incoming.client_id)
    : -1;
  if (byClient >= 0) {
    const next = [...list];
    next[byClient] = { ...incoming, pending: false, queued: false };
    return next;
  }
  if (list.some((m) => m.id === incoming.id)) {
    return list.map((m) =>
      m.id === incoming.id ? { ...m, ...incoming, pending: false, queued: false } : m,
    );
  }
  return [...list, incoming];
}

/**
 * 撤回 / 下架一条消息（软删除）。
 *
 * * 本人撤回：只能删自己发的；
 * * 管理员下架：staff 可删任何一条（后台私信审核页也调同一个端点）。
 *
 * 返回后对端会通过 WS 收到 `message-deleted` 帧，UI 立即把气泡换成占位文案。
 */
export async function deleteChatMessage(
  messageId: string,
): Promise<{ ok: boolean; deletedBy?: string }> {
  const res = await apiFetchAuthed(`/chat/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
  if (!res || !res.ok) return { ok: false };
  try {
    const data = (await res.json()) as { deleted_by?: string };
    return { ok: true, deletedBy: data.deleted_by };
  } catch {
    return { ok: true };
  }
}

/**
 * 把"消息已撤回"应用到本地列表（WS 帧 / 本人撤回后共用）。
 * 只改这一条：body 清空 + is_deleted，UI 显示「消息已被撤回」。
 */
export function applyMessageDeleted(list: ChatMessage[], messageId: string): ChatMessage[] {
  return list.map((m) => (m.id === messageId ? { ...m, is_deleted: true, body: "", media_urls: [] } : m));
}

/**
 * 挂上实时通道的生命周期（登录后调用，返回卸载函数）。
 *
 *  - 启动即建连；
 *  - 回前台 / 网络恢复时补一次未读、补发发件箱、必要时重连（系统会回收后台 WS）。
 */
export function attachChatRealtime(): () => void {
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    void connectChatSocket();
    void fetchChatUnread();
    void flushChatOutbox();
  };
  const onOnline = () => {
    void connectChatSocket();
    void flushChatOutbox();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  void connectChatSocket();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    closeChatSocket();
  };
}
