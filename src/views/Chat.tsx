/**
 * 私信 Chat —— 会话列表 + 会话详情（底部导航之外的子屏，通过首页头部的消息入口进入）。
 *
 * 交互约定（与 iOS 原生一致）
 * --------------------------
 *  - 气泡：自己右侧蓝色，对方左侧灰色；时间只在"间隔超过 5 分钟"时插一条分隔；
 *  - 已读：自己最后一条消息下方显示"已读/已送达"（对方 read_at 由 WS read 帧回执）；
 *  - 正在输入：对方 typing 帧 → 顶部显示"正在输入…"，3 秒无后续自动消失；
 *  - 发送：先进本地气泡（pending），服务端回执用 client_id 对齐替换；离线进发件箱；
 *  - 图片：相册选图 → canvas 压缩 → 上传 → 以缩略图渲染，点击放大。
 *
 * 数据全部走 `services/ChatService`（REST + WS），本文件不直接 fetch。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { hapticTap, motorHaptic } from "../utils/haptics";
import { useKeyboardOpen } from "../utils/keyboard";
import {
  createClientId,
  mergeMessage,
  chatOutboxSize,
  getChatUnread,
  listConversations,
  listMessages,
  markConversationReadSmart,
  sendChatMessage,
  sendTyping,
  subscribeChatConnection,
  subscribeChatEvents,
  subscribeChatUnread,
  type ChatConnectionState,
  type ChatMessage,
  type Conversation,
} from "../services/ChatService";
import { subscribeRealtimeRevision } from "../services/NotificationService";
import { MAX_UPLOAD_FILES, uploadImages } from "../services/UploadService";

type TFn = ReturnType<typeof useI18n>;

/** ISO → HH:MM（本地时区） */
function clockTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** 会话列表用的相对时间：今天→HH:MM，昨天→“昨天”，更早→日期 */
function listTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return clockTime(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** 两个时间戳是否跨天（跨天要在气泡间插日期分隔） */
function isNewDay(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!previous?.created_at || !current.created_at) return false;
  return new Date(previous.created_at).toDateString() !== new Date(current.created_at).toDateString();
}

/** 两条消息间隔 > 5 分钟才显示时间（避免每行都挂时间戳） */
function isQuietGap(previous: ChatMessage | undefined, current: ChatMessage): boolean {
  if (!previous?.created_at || !current.created_at) return true;
  return new Date(current.created_at).getTime() - new Date(previous.created_at).getTime() > 5 * 60_000;
}

/** 头像：实名取首字母，匿名（理论上私信不匿名，兜底）用 🕶️ */
function PeerAvatar({ name, anonymous = false, size = 40 }: { name: string; anonymous?: boolean; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: anonymous ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #0033A0, #007AFF)",
        color: "#fff",
      }}
    >
      {anonymous ? "🕶️" : (name || "?").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** 返回键（与其它子屏一致） */
function BackButton({ onClick }: { onClick: () => void }) {
  const t = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold"
    >
      <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
        <path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("back")}
    </button>
  );
}

/** 连接状态小圆点（在线灰点隐藏，离线/未授权才提示，避免打扰） */
function ConnectionPill({ state }: { state: ChatConnectionState }) {
  const t = useI18n();
  if (state === "online" || state === "idle") return null;
  const label =
    state === "connecting" ? t("chatConnecting") : state === "unauthorized" ? t("chatAuthExpired") : t("chatOffline");
  const tone = state === "unauthorized" ? "#FF6B6B" : "#FFB340";
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: `${tone}22`, color: tone }}
    >
      {label}
    </span>
  );
}

/** 未读数徽标 */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center text-white shrink-0"
      style={{ background: "#FF3B30", fontSize: 10, fontWeight: 700 }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** 供首页头部直接用的未读订阅（保证头部红点与会话列表同步） */
export function useChatUnread(): number {
  const [count, setCount] = useState(() => getChatUnread());
  useEffect(() => subscribeChatUnread(setCount), []);
  return count;
}

// =====================================================================
// 会话列表
// =====================================================================

export default function ChatList({
  onBack,
  onOpenConversation,
}: {
  onBack: () => void;
  onOpenConversation: (conversation: Conversation) => void;
}) {
  const t = useI18n();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [connection, setConnection] = useState<ChatConnectionState>("idle");
  const [query, setQuery] = useState("");
  const unread = useChatUnread();
  const outbox = chatOutboxSize();

  const refresh = useCallback(async () => {
    const page = await listConversations();
    if (!page) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setFailed(false);
    setItems(page.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  // WS 连接状态（离线时给个轻提示，不阻塞浏览）
  useEffect(() => subscribeChatConnection(setConnection), []);
  // 任一新消息 / 已读回执到达 → 重新拉一次列表（会话摘要与未读数都变了）
  useEffect(() => subscribeRealtimeRevision(() => void refresh()), [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.peer.display_name.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <BackButton onClick={onBack} />
          <div className="flex items-center gap-2">
            <ConnectionPill state={connection} />
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,122,255,0.16)", color: "var(--accent-soft-text)" }}>
              {unread > 0 ? `${unread} ${t("chatUnreadShort")}` : t("chatAllRead")}
            </span>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mt-3">{t("messages")}</h1>
        {outbox > 0 && (
          <p className="text-[10px] mt-1" style={{ color: "#FFB340" }}>
            {outbox} {t("chatQueuedHint")}
          </p>
        )}
      </div>

      <div className="px-4 pt-2 shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chatSearch")}
          className="w-full outline-none text-sm text-white placeholder:text-xs px-3 py-2.5 squircle-sm"
          style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-8 space-y-2.5 animate-slide-up">
        {loading ? (
          <p className="text-xs text-center py-10 theme-muted">…</p>
        ) : failed && items.length === 0 ? (
          <div className="glass squircle-lg px-4 py-10 flex flex-col items-center text-center">
            <span className="text-3xl">📡</span>
            <p className="text-sm font-bold text-white mt-2">{t("campusLoadFailed")}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="haptic-action mt-3 px-3.5 py-2 squircle-sm text-xs font-bold"
              style={{ background: "#007AFF", color: "#fff" }}
            >
              {t("refresh")}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass squircle-lg px-4 py-10 flex flex-col items-center text-center">
            <span className="text-3xl">💬</span>
            <p className="text-sm font-bold text-white mt-2">{t("chatEmpty")}</p>
            <p className="text-xs mt-1 theme-muted">{t("chatEmptyHint")}</p>
          </div>
        ) : (
          filtered.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                hapticTap();
                onOpenConversation(conversation);
              }}
              className="haptic-action glass squircle-lg w-full flex items-center gap-3 px-3.5 py-3 text-left"
            >
              <PeerAvatar name={conversation.peer.display_name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white truncate">{conversation.peer.display_name}</p>
                  <span className="ml-auto text-[10px] shrink-0 theme-muted">{listTime(conversation.last_message_at)}</span>
                </div>
                <p className="text-xs mt-0.5 truncate theme-secondary">
                  {conversation.last_message_preview || t("chatNoMessageYet")}
                </p>
              </div>
              <UnreadBadge count={conversation.unread_count} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// =====================================================================
// 会话详情
// =====================================================================

/** 每页拉多少条（往上翻历史时按这个步长递增 offset） */
const PAGE_SIZE = 30;

export function ChatDetail({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const t = useI18n();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [connection, setConnection] = useState<ChatConnectionState>("idle");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  /** 已经取到第几条（继续往上翻历史时当 offset 用） */
  const offsetRef = useRef(0);
  const lastTypingAt = useRef(0);
  /** 用户是否贴着底部（自己往上翻历史时不该被新消息强行拽回底部） */
  const stickToBottom = useRef(true);
  const kbOpen = useKeyboardOpen();

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // ---- 首屏：历史消息（服务端是倒序分页 → reverse 成正序）+ 清零未读
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const page = await listMessages(conversation.id, PAGE_SIZE, 0);
      if (cancelled) return;
      const items = (page?.items ?? []).slice().reverse();
      setMessages(items);
      offsetRef.current = items.length;
      setHasMore(Boolean(page?.has_more));
      setLoading(false);
      markConversationReadSmart(conversation.id);
      requestAnimationFrame(() => scrollToBottom());
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(typingTimer.current);
    };
  }, [conversation.id, scrollToBottom]);

  // ---- 实时：本会话的新消息 / 对方已读回执 / 对方正在输入
  useEffect(
    () =>
      subscribeChatEvents((event) => {
        if (event.type === "message") {
          const message = event.message;
          if (!message || message.conversation_id !== conversation.id) return;
          setMessages((prev) => mergeMessage(prev, message));
          if (!message.is_mine) {
            // 我正看着这个会话 → 直接标已读，对方那边会显示"已读"
            markConversationReadSmart(conversation.id);
            motorHaptic();
          }
          if (stickToBottom.current) requestAnimationFrame(() => scrollToBottom("smooth"));
          return;
        }
        if (event.type === "read" && event.conversation_id === conversation.id) {
          // 对方读完了 → 我发出的消息全部标已读（气泡下方显示"已读"）
          setMessages((prev) =>
            prev.map((m) =>
              m.is_mine && !m.read_at ? { ...m, read_at: event.at ?? new Date().toISOString() } : m,
            ),
          );
          return;
        }
        if (event.type === "typing" && event.conversation_id === conversation.id) {
          setPeerTyping(true);
          window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => setPeerTyping(false), 3500);
        }
      }),
    [conversation.id, scrollToBottom],
  );

  useEffect(() => subscribeChatConnection(setConnection), []);

  // 键盘弹出：把最新消息顶进可视区（否则输入条会盖住最后一条）
  useEffect(() => {
    if (kbOpen && stickToBottom.current) scrollToBottom("smooth");
  }, [kbOpen, scrollToBottom]);

  // ---- 往上翻历史：offset 递增，插入顶部后补偿滚动位置（视觉不跳）
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const previousHeight = el?.scrollHeight ?? 0;
    const page = await listMessages(conversation.id, PAGE_SIZE, offsetRef.current);
    const older = (page?.items ?? []).slice().reverse();
    if (older.length) {
      setMessages((prev) => [...older, ...prev]);
      offsetRef.current += older.length;
    }
    setHasMore(Boolean(page?.has_more));
    setLoadingMore(false);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - previousHeight;
    });
  };

  // ---- 相册选图 → 压缩 → 上传（失败的只提示，不阻塞发送）
  const pickImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const { images, failed } = await uploadImages(Array.from(files));
    setAttachments((prev) => [...prev, ...images.map((img) => img.url)].slice(0, MAX_UPLOAD_FILES));
    setUploading(false);
    if (failed.length) toast.push(`${failed.length} ${t("uploadFailed")}`, "error");
  };

  // ---- 发送：先插乐观气泡（带 client_id），服务端回执到达后原地替换
  const send = async () => {
    const body = draft.trim();
    if ((!body && attachments.length === 0) || sending) return;
    const clientId = createClientId();
    const optimistic: ChatMessage = {
      id: `local-${clientId}`,
      conversation_id: conversation.id,
      sender_id: "me",
      body,
      media_urls: [...attachments],
      client_id: clientId,
      read_at: null,
      is_deleted: false,
      created_at: new Date().toISOString(),
      is_mine: true,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setAttachments([]);
    setSending(true);
    stickToBottom.current = true;
    requestAnimationFrame(() => scrollToBottom("smooth"));

    const result = await sendChatMessage(conversation.id, body, optimistic.media_urls, clientId);
    if (result.message) setMessages((prev) => mergeMessage(prev, result.message as ChatMessage));
    if (result.queued) {
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...m, queued: true } : m)));
      toast.push(t("chatQueued"), "info");
    }
    setSending(false);
    motorHaptic();
  };

  /** 输入即上报"正在输入"，2.5s 内不重复发（对方顶部显示"正在输入…"） */
  const onDraftChange = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (now - lastTypingAt.current > 2500) {
      lastTypingAt.current = now;
      sendTyping(conversation.id);
    }
  };

  return (
    <div className="app-surface flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* 顶部：返回 + 对方实名（私信不匿名，与校园墙的约定刻意不同） */}
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center gap-2 pb-1.5">
          <BackButton onClick={onBack} />
          <div className="ml-auto flex items-center gap-2">
            <ConnectionPill state={connection} />
          </div>
        </div>
        <div className="flex items-center gap-2.5 pb-2.5">
          <PeerAvatar name={conversation.peer.display_name} size={34} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{conversation.peer.display_name}</p>
            <p
              className="text-[10px] truncate"
              style={{ color: peerTyping ? "#30D158" : "var(--tx-5)" }}
            >
              {peerTyping ? t("chatTyping") : (conversation.peer.department_tag ?? "")}
            </p>
          </div>
        </div>
      </div>

      {/* 消息流：贴着底部才算"跟着走"，往上翻历史时新消息不强行拉回 */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40) void loadMore();
        }}
        className="kb-pad flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-2 space-y-1.5"
      >
        {loadingMore && <p className="text-[10px] text-center theme-muted">…</p>}
        {loading ? (
          <p className="text-xs text-center py-10 theme-muted">…</p>
        ) : messages.length === 0 ? (
          <div className="glass squircle-lg px-4 py-8 text-center">
            <p className="text-sm font-bold text-white">{t("chatSayHi")}</p>
            <p className="text-xs mt-1 theme-muted">{t("chatSayHiHint")}</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              previous={index > 0 ? messages[index - 1] : undefined}
              isLast={index === messages.length - 1}
              onOpenImage={setPreview}
            />
          ))
        )}
      </div>

      {/* 待发送附件（已上传拿到 URL，发送时才挂到消息上） */}
      {attachments.length > 0 && (
        <div className="shrink-0 flex gap-2 px-4 pb-2 overflow-x-auto">
          {attachments.map((url) => (
            <span key={url} className="relative shrink-0">
              <img src={url} alt="" className="w-16 h-16 object-cover squircle-sm" />
              <button
                type="button"
                aria-label={t("removePhoto")}
                onClick={() => setAttachments((prev) => prev.filter((item) => item !== url))}
                className="haptic-action absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-bold"
                style={{ background: "#FF3B30", color: "#fff" }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {uploading && (
        <p className="shrink-0 px-4 pb-1 text-[10px]" style={{ color: "#FFB340" }}>
          {t("uploading")}
        </p>
      )}

      {/* 输入条：图片 + 文本 + 发送（.kb-bar 负责键盘弹出时上抬） */}
      <div
        className="kb-bar shrink-0 px-3 pt-2.5 flex items-end gap-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "var(--app-bg)" }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void pickImages(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label={t("addPhotos")}
          title={t("addPhotos")}
          onClick={() => {
            hapticTap();
            fileRef.current?.click();
          }}
          className="haptic-action w-9 h-9 squircle-sm flex items-center justify-center text-base shrink-0"
          style={{ background: "rgba(255,255,255,0.07)" }}
        >
          🖼
        </button>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onFocus={() => {
            stickToBottom.current = true;
            requestAnimationFrame(() => scrollToBottom("smooth"));
          }}
          onKeyDown={(e) => {
            // 回车发送（Shift+Enter 换行），与桌面端习惯一致
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={t("chatPlaceholder")}
          className="flex-1 min-w-0 outline-none text-sm text-white placeholder:text-xs px-3 py-2.5 squircle-sm resize-none leading-snug"
          style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={(!draft.trim() && attachments.length === 0) || sending}
          className="haptic-action shrink-0 px-3.5 py-2.5 squircle-sm text-xs font-bold disabled:opacity-40"
          style={{ background: "#007AFF", color: "#fff" }}
        >
          {t("send")}
        </button>
      </div>

      {/* 图片放大预览 */}
      {preview && (
        <button
          type="button"
          onClick={() => setPreview(null)}
          aria-label={t("back")}
          className="absolute inset-0 z-70 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
        >
          <img src={preview} alt="" className="max-w-full max-h-full object-contain" />
        </button>
      )}
    </div>
  );
}

/**
 * 一条消息气泡。
 *
 *  - 时间分隔只在"跨天"或"间隔 > 5 分钟"时出现（否则每行挂时间戳会非常吵）；
 *  - 自己发的：右侧蓝底白字，下方一行状态（发送中 / 已送达 / 已读 / 待补发）；
 *  - 对方发的：左侧灰底，最后一条下方显示时间；
 *  - 图片：缩略图点击放大（走全屏预览，不跳浏览器）。
 */
function MessageRow({
  message,
  previous,
  isLast,
  onOpenImage,
}: {
  message: ChatMessage;
  previous?: ChatMessage;
  isLast: boolean;
  onOpenImage: (url: string) => void;
}) {
  const t = useI18n();
  const mine = message.is_mine;
  const newDay = isNewDay(previous, message);
  const showTime = isQuietGap(previous, message);

  const status = mine
    ? message.queued
      ? t("chatWillRetry")
      : message.pending
        ? t("chatSending")
        : message.read_at
          ? t("chatRead")
          : t("chatDelivered")
    : "";

  return (
    <>
      {newDay && message.created_at && (
        <p className="text-center text-[10px] py-2 theme-muted">
          {new Date(message.created_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}
        </p>
      )}
      {showTime && !newDay && message.created_at && (
        <p className="text-center text-[10px] py-1.5 theme-muted">{clockTime(message.created_at)}</p>
      )}

      <div className={`chat-row${mine ? " is-mine" : ""}`}>
        {message.media_urls.length > 0 && (
          <div className="chat-photos">
            {message.media_urls.map((url) => (
              <button
                type="button"
                key={url}
                onClick={() => {
                  hapticTap();
                  onOpenImage(url);
                }}
                className="haptic-action"
              >
                <img src={url} alt="" loading="lazy" className="chat-photo" />
              </button>
            ))}
          </div>
        )}
        {message.body && <div className="chat-bubble">{message.body}</div>}
        {(status || (isLast && !mine && message.created_at)) && (
          <span className="chat-status">
            {status || clockTime(message.created_at)}
          </span>
        )}
      </div>
    </>
  );
}
