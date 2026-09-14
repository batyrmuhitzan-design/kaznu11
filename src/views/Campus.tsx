/**
 * Campus Hub —— 校园娱乐与交流社区（底部导航第 3 个 Tab）。
 *
 * 三个核心区域（对应需求 2 的三个子板块）：
 *  1) **全局紧急通知栏**（System Push Banner）：来自 `GET /notifications/latest`，
 *     按 level 上色（info 蓝 / warning 橙 / danger 红），可关闭（按通知 id 记忆，不反复打扰）；
 *  2) **KazNU 校园墙 / 交流社区**（Campus Wall & Feed）：分类筛选、匿名发帖、
 *     图片/视频预览、点赞、评论回复；
 *  3) **社团与讲座活动通告**（Club Events）：活动海报、时间地点、社团名，
 *     点击进详情、RSVP / 报名外链跳转。
 *
 * 数据来源：`services/CampusService.ts`
 *  - 优先实时后端 https://1losion.me/api/v1；
 *  - 拉不到就回退 `data/campusDemo.ts` 的离线演示数据，并用角标标明（与 ProfReviews 一致）；
 *  - 离线时发帖 / 评论 / 点赞落到本地并标"未同步"，不丢用户输入。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import {
  CAMPUS_CATEGORIES,
  type CampusComment,
  type CampusNotificationItem,
  type CampusPost,
  type ClubEventItem,
  type PostCategory,
} from "../data/campusDemo";
import {
  loadCampus,
  loadPostComments,
  submitCampusComment,
  submitCampusPost,
  togglePostLike,
  type NewPostInput,
} from "../services/CampusService";
import { startConversation, type Conversation } from "../services/ChatService";
import { MAX_UPLOAD_FILES, uploadImages } from "../services/UploadService";
import { NewsList, NewsDetail, type NewsItem } from "./News";
import { useChatUnread } from "./Chat";
import { hapticTap, motorHaptic } from "../utils/haptics";
import { useKeyboardOpen } from "../utils/keyboard";

type TFn = ReturnType<typeof useI18n>;
type CategoryFilter = PostCategory | "all";

/** 分类 → i18n key（与后端 POST_CATEGORIES 一一对应） */
const CATEGORY_KEY: Record<
  PostCategory,
  "catCourseReview" | "catLostFound" | "catHousing" | "catHackathon" | "catClub" | "catGeneral"
> = {
  course_review: "catCourseReview",
  lost_found: "catLostFound",
  housing: "catHousing",
  hackathon: "catHackathon",
  club: "catClub",
  general: "catGeneral",
};

function categoryEmoji(id: PostCategory): string {
  return CAMPUS_CATEGORIES.find((c) => c.id === id)?.emoji ?? "💬";
}

/** 通知级别 → 颜色（背景 / 边框 / 文字），与 App 的语义色一致。 */
const LEVEL_STYLE: Record<CampusNotificationItem["level"], { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: "rgba(0,122,255,0.14)", border: "rgba(0,122,255,0.32)", text: "#409CFF", icon: "ℹ️" },
  warning: { bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.34)", text: "#FFB340", icon: "⚠️" },
  danger: { bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.36)", text: "#FF6B6B", icon: "🚨" },
};

/** ISO 时间 → 紧凑相对时间（now / 12m / 3h / 2d，超 7 天回到日期）。 */
function timeAgo(iso: string): string {
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

/** 活动时间 → "Sep 16 Tue 18:00" 这类本地化短格式。 */
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 作者展示名：匿名 → 本地化的"匿名"标签；实名 → 全局显示名。 */
function authorLabel(post: Pick<CampusPost, "is_anonymous" | "author">, t: TFn): string {
  if (post.is_anonymous) return t("anonymous");
  return post.author.name ?? "—";
}

/**
 * 打开外部链接（活动 RSVP / 帖子媒体）。
 * 与 `native/legalPdf.ts` 同一套约定：原生端走 Capacitor Browser（应用内 Safari），
 * Web 端回落 window.open。
 */
async function openExternal(url: string): Promise<void> {
  if (!url) return;
  const safe = url.trim();
  if (!/^https?:\/\//i.test(safe)) return;
  try {
    const [{ Capacitor }, { Browser }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/browser"),
    ]);
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: safe });
      return;
    }
  } catch (error) {
    console.warn("Capacitor Browser unavailable, falling back to window.open", error);
  }
  window.open(safe, "_blank", "noopener,noreferrer");
}

// =====================================================================
// 子组件
// =====================================================================

/** 已关闭的紧急通知 id（避免每次进页面都重复弹出同一条）。 */
const NOTIF_DISMISS_KEY = "kaznu:campus:dismissedNotification";

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="glass squircle-lg px-4 py-10 flex flex-col items-center text-center">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm font-bold text-white mt-2">{title}</p>
      <p className="text-xs mt-1" style={{ color: "rgba(235,235,245,0.45)" }}>
        {hint}
      </p>
    </div>
  );
}

// =====================================================================
// 主视图
// =====================================================================

export default function CampusView({
  focusPostId = null,
  onFocusHandled,
  onOpenConversation,
  onOpenChat,
}: {
  /** 从通知 / 推送点进来的帖子 id（App 传入），Feed 加载完成后自动打开该帖 */
  focusPostId?: string | null;
  onFocusHandled?: () => void;
  /** 点「私信」后把会话交给 App 打开（Campus 自己不持有私信路由） */
  onOpenConversation?: (conversation: Conversation) => void;
  /** 顶部私信入口（红点走实时未读，和会话列表同源） */
  onOpenChat?: () => void;
}) {
  const t = useI18n();
  const toast = useToast();
  const unreadMessages = useChatUnread();

  const [mode, setMode] = useState<"wall" | "events" | "news">("wall");
  const [category, setCategory] = useState<CategoryFilter>("all");
  /** 从「新闻」分段点进去的新闻详情（子屏，与帖子详情同层） */
  const [openNews, setOpenNews] = useState<NewsItem | null>(null);
  const [posts, setPosts] = useState<CampusPost[]>([]);
  const [events, setEvents] = useState<ClubEventItem[]>([]);
  const [notification, setNotification] = useState<CampusNotificationItem | null>(null);
  const [source, setSource] = useState<"live" | "demo">("demo");
  const [loading, setLoading] = useState(true);

  const [openPost, setOpenPost] = useState<CampusPost | null>(null);
  const [openEvent, setOpenEvent] = useState<ClubEventItem | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const [dismissedNotification, setDismissedNotification] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(NOTIF_DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const refresh = useCallback(async (next: CategoryFilter) => {
    setLoading(true);
    const snapshot = await loadCampus(next);
    setPosts(snapshot.posts);
    setEvents(snapshot.events);
    setNotification(snapshot.notification);
    setSource(snapshot.source);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(category);
  }, [category, refresh]);

  // 从通知 / 推送点进来的帖子：Feed 加载完成后自动打开（live / demo 数据都适用）
  useEffect(() => {
    if (!focusPostId || loading) return;
    const target = posts.find((p) => p.id === focusPostId);
    if (target) setOpenPost(target);
    // 告诉 App 标记已消费，避免切回 Campus 又弹一次
    onFocusHandled?.();
  }, [focusPostId, loading, posts, onFocusHandled]);

  /**
   * 「私信」某位帖主。
   *
   * 只对**实名帖**可用：匿名帖后端不会返回作者 id（返回了就等于匿名作废），
   * 所以这里拿不到 id 就直接提示，不静默失败。
   */
  const handleMessageAuthor = async (post: CampusPost) => {
    const peerId = post.author.id ?? undefined;
    if (!peerId) {
      toast.push(t("dmFailed"), "error");
      return;
    }
    const conversation = await startConversation({ peerId });
    if (!conversation) {
      toast.push(t("dmFailed"), "error");
      return;
    }
    motorHaptic();
    onOpenConversation?.(conversation);
  };

  const patchPost = useCallback((updated: CampusPost) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setOpenPost((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const handleLike = async (post: CampusPost) => {
    motorHaptic();
    const { post: updated } = await togglePostLike(post);
    patchPost(updated);
  };

  const handleCommentCount = (postId: string, count: number) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, comment_count: count } : p)));
    setOpenPost((prev) => (prev && prev.id === postId ? { ...prev, comment_count: count } : prev));
  };

  const handleSubmitPost = async (input: NewPostInput) => {
    const { post, synced } = await submitCampusPost(input);
    setComposerOpen(false);
    setMode("wall");
    motorHaptic();
    toast.push(
      synced ? t("postPublished") : `${t("postPublished")} · ${t("notSynced")}`,
      synced ? "success" : "info",
    );
    if (category !== "all" && category !== post.category) {
      setCategory("all"); // 触发一次刷新，新帖自然包含在内
    } else {
      setPosts((prev) => [post, ...prev]);
    }
  };

  const dismissNotification = () => {
    if (!notification) return;
    hapticTap();
    setDismissedNotification(notification.id);
    try {
      window.localStorage.setItem(NOTIF_DISMISS_KEY, notification.id);
    } catch {
      /* 忽略存储失败 */
    }
  };

  // ---- 子屏（帖子详情 / 活动详情 / 发帖）优先渲染 ----
  if (openPost) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <PostDetail
          post={openPost}
          onBack={() => setOpenPost(null)}
          onLike={() => void handleLike(openPost)}
          onCommentCountChange={(count) => handleCommentCount(openPost.id, count)}
          onMessage={() => void handleMessageAuthor(openPost)}
        />
      </div>
    );
  }

  if (openEvent) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <EventDetail event={openEvent} onBack={() => setOpenEvent(null)} />
      </div>
    );
  }

  // 新闻详情（News 已并入 Campus 的「新闻」分段，所以它也是 Campus 的子屏）
  if (openNews) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <NewsDetail item={openNews} onBack={() => setOpenNews(null)} />
      </div>
    );
  }

  if (composerOpen) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <Composer onClose={() => setComposerOpen(false)} onSubmit={handleSubmitPost} />
      </div>
    );
  }

  return (
    <div className="app-surface relative h-full flex flex-col overflow-hidden">
      {/* 顶部栏：标题 + live/demo 角标 + 紧凑分段控件（发帖入口已改为右下角悬浮圆钮 FAB） */}
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-white flex items-center gap-1.5" style={{ letterSpacing: "-0.4px" }}>
            <span>🎓</span> {t("campus")}
          </h1>
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
              style={{
                background: source === "live" ? "rgba(48,209,88,0.14)" : "rgba(255,159,10,0.14)",
                color: source === "live" ? "#30D158" : "#FF9F0A",
              }}
            >
              {source === "live" ? t("live") : t("offlineDemo")}
            </span>
            {/* 私信入口就在 Hub 页：红点来自 WebSocket 实时未读（与会话列表同源） */}
            <button
              type="button"
              aria-label={t("messages")}
              title={t("messages")}
              onClick={() => onOpenChat?.()}
              data-haptic="light"
              className="haptic-action icon-button relative"
            >
              <div className="w-8 h-8 flex items-center justify-center" style={{ color: "rgba(235,235,245,0.6)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
                  <path d="M12 3C6.99 3 3 6.36 3 10.5c0 2.16 1.05 4.1 2.73 5.44-.16 1.05-.66 2.06-1.5 2.9a.6.6 0 0 0 .5 1.02c1.9-.14 3.4-.8 4.44-1.44.9.22 1.86.34 2.83.34 5.01 0 9-3.36 9-7.5S17.01 3 12 3Z" />
                </svg>
              </div>
              {unreadMessages > 0 && (
                <span className="badge-dot">{unreadMessages > 99 ? "99+" : unreadMessages}</span>
              )}
            </button>
          </div>
        </div>

        <div className="seg-compact mt-2" role="tablist" aria-label={t("campus")}>
          {(["wall", "events", "news"] as const).map((m) => {
            const active = mode === m;
            const label = m === "wall" ? t("campusWall") : m === "events" ? t("campusEvents") : t("news");
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  hapticTap();
                  setMode(m);
                }}
                className="haptic-action"
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 全局紧急通知栏（System Push Banner） */}
      {notification && notification.id !== dismissedNotification && (
        <NotificationBanner item={notification} onDismiss={dismissNotification} />
      )}

      {mode === "wall" ? (
        <>
          <CategoryChips
            value={category}
            onChange={(next) => {
              hapticTap();
              setCategory(next);
            }}
          />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-28 space-y-3 animate-slide-up">
            {loading && posts.length === 0 ? (
              <p className="text-xs text-center py-10" style={{ color: "rgba(235,235,245,0.4)" }}>
                …
              </p>
            ) : posts.length === 0 ? (
              <EmptyState icon="🧱" title={t("noPosts")} hint={t("noPostsHint")} />
            ) : (
              posts.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  onOpen={() => setOpenPost(p)}
                  onLike={() => void handleLike(p)}
                  onMessage={() => void handleMessageAuthor(p)}
                />
              ))
            )}
          </div>
        </>
      ) : mode === "events" ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-28 space-y-3 animate-slide-up">
          {events.length === 0 ? (
            <EmptyState icon="🎪" title={t("noEvents")} hint={t("noEventsHint")} />
          ) : (
            events.map((e) => <EventCard key={e.id} event={e} onOpen={() => setOpenEvent(e)} />)
          )}
        </div>
      ) : (
        /* 新闻分段：News 已并入 Campus。NewsList 自身不带顶部栏，标题与分段由本页统一渲染 */
        <NewsList onOpenDetail={(item) => setOpenNews(item)} />
      )}

      {/* 新建动态：右下角悬浮圆钮（FAB）。
          - absolute（相对本视图根节点，见根节点的 relative）：滚动发生在内层容器里，
            所以列表怎么划它都钉在右下角；用 fixed 会以窗口为基准、跳出 430px 的 App 列。
          - z-60 高于卡片、低于 toast（z-70）与顶部吸顶栏（z-45 同级不影响，无重叠）。
          - 列表底部 pb-28 已预留空间，不遮挡最后一条内容。 */}
      {mode === "wall" && (
        <button
          type="button"
          aria-label={t("writePost")}
          onClick={() => {
            hapticTap();
            setComposerOpen(true);
          }}
          className="fab"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
    </div>
  );
}


/** 顶部全局紧急通知栏（System Push Banner）—— 按 level 上色，可关闭。 */
function NotificationBanner({
  item,
  onDismiss,
}: {
  item: CampusNotificationItem;
  onDismiss: () => void;
}) {
  const t = useI18n();
  const style = LEVEL_STYLE[item.level] ?? LEVEL_STYLE.info;
  return (
    <div className="shrink-0 px-4 pb-2.5">
      <div
        className="squircle-md px-3 py-2.5 flex items-start gap-2.5"
        style={{ background: style.bg, border: `1px solid ${style.border}` }}
      >
        <span className="text-base leading-none mt-0.5">{style.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold" style={{ color: style.text }}>
            {item.title}
          </p>
          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "rgba(235,235,245,0.78)" }}>
            {item.message}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("hide")}
          onClick={onDismiss}
          className="haptic-action shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px]"
          style={{ background: "rgba(255,255,255,0.12)", color: "rgba(235,235,245,0.75)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** 分类筛选条（All + 6 个分类）。 */
function CategoryChips({
  value,
  onChange,
}: {
  value: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
}) {
  const t = useI18n();
  const chips: { id: CategoryFilter; label: string; emoji: string }[] = [
    { id: "all", label: t("catAll"), emoji: "🌐" },
    ...CAMPUS_CATEGORIES.map((c) => ({ id: c.id as CategoryFilter, label: t(CATEGORY_KEY[c.id]), emoji: c.emoji })),
  ];
  return (
    <div className="shrink-0 flex gap-1.5 overflow-x-auto px-4 pb-2.5">
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            data-haptic="light"
            className="haptic-action pill-chip shrink-0"
            style={{
              background: active ? "#007AFF" : "rgba(255,255,255,0.07)",
              color: active ? "#fff" : "rgba(235,235,245,0.7)",
            }}
          >
            {chip.emoji} {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/** 校园墙卡片：作者（匿名/实名）、时间、分类标签、正文、媒体预览、点赞、评论数。 */
function PostCard({
  post,
  onOpen,
  onLike,
  onMessage,
}: {
  post: CampusPost;
  onOpen: () => void;
  onLike: () => void;
  /** 「私信作者」——仅实名帖会显示（匿名帖后端不返回作者 id） */
  onMessage: () => void;
}) {
  const t = useI18n();
  return (
    <div className={`glass squircle-lg p-4${post.is_official ? " post-card-official" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{
            background: post.is_anonymous ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #0033A0, #007AFF)",
            color: "#fff",
          }}
        >
          {post.is_anonymous ? "🕶️" : (post.author.name ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white truncate">
            {authorLabel(post, t)}
            {post.local_only && (
              <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.2)", color: "#FFB340" }}>
                {t("notSynced")}
              </span>
            )}
          </p>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: "rgba(235,235,245,0.45)" }}>
            {post.author.department_tag ? `${post.author.department_tag} · ` : ""}
            {timeAgo(post.created_at)}
          </p>
        </div>
        {post.is_official ? (
          <span className="official-badge shrink-0">📢 {t("officialBadge")}</span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(235,235,245,0.65)" }}>
            {categoryEmoji(post.category)} {t(CATEGORY_KEY[post.category])}
          </span>
        )}
      </div>

      <button type="button" onClick={onOpen} className="block w-full text-left mt-2.5">
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "rgba(235,235,245,0.92)" }}>
          {post.content}
        </p>
      </button>
      <MediaStrip urls={post.media_urls} />

      <div className="flex items-center gap-4 mt-3 pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          type="button"
          onClick={onLike}
          className="haptic-action flex items-center gap-1.5 text-xs font-bold"
          style={{ color: post.liked ? "#FF453A" : "rgba(235,235,245,0.55)" }}
        >
          <span>{post.liked ? "❤️" : "🤍"}</span>
          {post.likes_count}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="haptic-action flex items-center gap-1.5 text-xs font-bold"
          style={{ color: "rgba(235,235,245,0.55)" }}
        >
          <span>💬</span>
          {post.comment_count}
        </button>
        {/* 实名帖才有作者 id → 才能私信（匿名帖这个按钮不出现） */}
        {!post.is_anonymous && post.author.id && (
          <button
            type="button"
            onClick={onMessage}
            className="haptic-action ml-auto flex items-center gap-1.5 text-xs font-bold"
            style={{ color: "#409CFF" }}
          >
            <span>✉️</span>
            {t("dmAuthor")}
          </button>
        )}
      </div>
    </div>
  );
}

/** 发帖页：正文 + 分类 + 匿名开关 + 媒体外链（每行一条，最多 6 条）。 */
function Composer({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: NewPostInput) => Promise<void>;
}) {
  const t = useI18n();
  const toast = useToast();
  const kbOpen = useKeyboardOpen();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PostCategory>("general");
  const [asAnonymous, setAsAnonymous] = useState(true);
  /** 已上传成功的图片 URL（本地相册 → canvas 压缩 → POST /uploads/image） */
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  // 键盘弹出后把正文框滚进可视区：iOS 只会把聚焦元素"顶到一半"，
  // 配合滚动容器上的 .kb-pad（底部补出键盘高度）再滚一次，保证输入区完整可见。
  useEffect(() => {
    if (kbOpen) contentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [kbOpen]);

  const canSubmit = content.trim().length > 0 && !sending && !uploading;

  /**
   * 相册选图：压缩 → 上传 → 拿到可渲染 URL。
   * 上传失败的只提示，用户仍可只发文字（不能让一张超限的图把整条帖子卡死）。
   */
  const pickPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const { images, failed } = await uploadImages(Array.from(files));
    setMediaUrls((prev) => [...prev, ...images.map((img) => img.url)].slice(0, MAX_UPLOAD_FILES));
    setUploading(false);
    if (failed.length) toast.push(`${failed.length} ${t("uploadFailed")}`, "error");
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    await onSubmit({
      content: content.trim(),
      category,
      is_anonymous: asAnonymous,
      media_urls: mediaUrls,
    });
    setSending(false);
  };

  return (
    <div className="app-surface flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="haptic-action text-sm font-semibold"
            style={{ color: "rgba(235,235,245,0.6)" }}
          >
            {t("cancel")}
          </button>
          <p className="text-sm font-bold text-white">{t("writePost")}</p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="haptic-action px-3.5 py-2 squircle-sm text-xs font-bold disabled:opacity-40"
            style={{ background: "#007AFF", color: "#fff" }}
          >
            {sending ? "…" : t("publish")}
          </button>
        </div>
      </div>

      <div className="kb-pad flex-1 min-h-0 overflow-y-auto px-4 pt-3 space-y-3">
        <textarea
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={t("postPlaceholder")}
          className="w-full glass squircle-lg p-4 outline-none text-sm text-white placeholder:text-xs resize-none leading-relaxed"
        />
        <p className="text-[10px] text-right px-1" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono" }}>
          {content.length}/2000
        </p>

        <div className="flex flex-wrap gap-1.5">
          {CAMPUS_CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  hapticTap();
                  setCategory(c.id);
                }}
                className="haptic-action px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
                style={{
                  background: active ? "rgba(0,122,255,0.24)" : "rgba(255,255,255,0.07)",
                  color: active ? "#409CFF" : "rgba(235,235,245,0.7)",
                  border: active ? "1px solid rgba(0,122,255,0.55)" : "1px solid transparent",
                }}
              >
                {c.emoji} {t(CATEGORY_KEY[c.id])}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            hapticTap();
            setAsAnonymous((v) => !v);
          }}
          className="haptic-action w-full glass squircle-md px-4 py-3 flex items-center justify-between"
        >
          <span className="text-sm font-semibold text-white">🕶️ {t("postAnonymously")}</span>
          <span
            className="w-11 h-6 rounded-full relative"
            style={{ background: asAnonymous ? "#30D158" : "rgba(255,255,255,0.18)" }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
              style={{ left: asAnonymous ? 22 : 2 }}
            />
          </span>
        </button>

        {/* 相册选图（自动压缩后上传，最多 6 张）——取代了原来"手贴图片链接"的输入框 */}
        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>
            {t("addPhotos")}
          </p>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            {mediaUrls.map((url) => (
              <span key={url} className="photo-thumb">
                <img src={url} alt="" />
                <button
                  type="button"
                  aria-label={t("removePhoto")}
                  className="haptic-action photo-thumb-remove"
                  onClick={() => setMediaUrls((prev) => prev.filter((item) => item !== url))}
                >
                  ✕
                </button>
              </span>
            ))}
            {mediaUrls.length < MAX_UPLOAD_FILES && (
              <button
                type="button"
                aria-label={t("addPhotos")}
                onClick={() => {
                  hapticTap();
                  photoRef.current?.click();
                }}
                className="haptic-action photo-thumb flex items-center justify-center text-2xl"
                style={{ color: "rgba(235,235,245,0.55)" }}
              >
                {uploading ? "…" : "+"}
              </button>
            )}
          </div>
          <p className="text-[10px] mt-2" style={{ color: "rgba(235,235,245,0.4)" }}>
            {uploading ? t("uploading") : t("uploadHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 帖子详情：完整正文 + 媒体 + 点赞 + 评论区（读 / 写）。 */
function PostDetail({
  post,
  onBack,
  onLike,
  onCommentCountChange,
  onMessage,
}: {
  post: CampusPost;
  onBack: () => void;
  onLike: () => void;
  onCommentCountChange: (count: number) => void;
  onMessage: () => void;
}) {
  const t = useI18n();
  const toast = useToast();
  const [comments, setComments] = useState<CampusComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [asAnonymous, setAsAnonymous] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadPostComments(post.id).then((res) => {
      if (cancelled) return;
      setComments(res.items);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    const { comment, synced } = await submitCampusComment(post.id, {
      content,
      is_anonymous: asAnonymous,
    });
    setComments((prev) => [...prev, comment]);
    setDraft("");
    onCommentCountChange(comments.length + 1);
    setSending(false);
    motorHaptic();
    toast.push(
      synced ? t("commentPosted") : `${t("commentPosted")} · ${t("notSynced")}`,
      synced ? "success" : "info",
    );
  };

  return (
    <div className="app-surface flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold"
          >
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
              <path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("back")}
          </button>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(235,235,245,0.65)" }}>
            {post.is_official ? `📢 ${t("officialBadge")}` : `${categoryEmoji(post.category)} ${t(CATEGORY_KEY[post.category])}`}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6 space-y-3">
        <div className="glass squircle-lg p-4">
          <div className="flex items-center gap-2.5">
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{
                background: post.is_anonymous ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg, #0033A0, #007AFF)",
                color: "#fff",
              }}
            >
              {post.is_anonymous ? "🕶️" : (post.author.name ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{authorLabel(post, t)}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>
                {post.author.department_tag ? `${post.author.department_tag} · ` : ""}
                {timeAgo(post.created_at)}
              </p>
            </div>
            {/* 实名帖：直接私信帖主（匿名帖没有 author.id，不显示） */}
            {!post.is_anonymous && post.author.id && (
              <button
                type="button"
                onClick={onMessage}
                className="haptic-action ml-auto shrink-0 flex items-center gap-1.5 text-xs font-bold"
                style={{ color: "#409CFF" }}
              >
                <span>✉️</span>
                {t("dmAuthor")}
              </button>
            )}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-line mt-3" style={{ color: "rgba(235,235,245,0.92)" }}>
            {post.content}
          </p>
          <MediaStrip urls={post.media_urls} />
          <div className="flex items-center gap-4 mt-3 pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              type="button"
              onClick={onLike}
              className="haptic-action flex items-center gap-1.5 text-xs font-bold"
              style={{ color: post.liked ? "#FF453A" : "rgba(235,235,245,0.55)" }}
            >
              <span>{post.liked ? "❤️" : "🤍"}</span>
              {post.likes_count}
            </button>
            <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "rgba(235,235,245,0.55)" }}>
              💬 {comments.length}
            </span>
          </div>
        </div>

        <p className="text-xs font-bold px-1" style={{ color: "rgba(235,235,245,0.6)" }}>
          {t("comments")}
        </p>

        {loading ? (
          <p className="text-xs px-1" style={{ color: "rgba(235,235,245,0.4)" }}>…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs px-1" style={{ color: "rgba(235,235,245,0.4)" }}>{t("noComments")}</p>
        ) : (
          <div className="glass squircle-lg overflow-hidden divide-y divide-white/5">
            {comments.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-white">{authorLabel(c, t)}</span>
                  <span className="text-[10px]" style={{ color: "rgba(235,235,245,0.4)" }}>
                    {timeAgo(c.created_at)}
                  </span>
                  {c.local_only && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.2)", color: "#FFB340" }}>
                      {t("notSynced")}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed mt-1 whitespace-pre-line" style={{ color: "rgba(235,235,245,0.82)" }}>
                  {c.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 评论输入条（子屏位于 Tab Bar 之上；.kb-bar 负责键盘弹出时整体上抬） */}
      <div
        className="kb-bar shrink-0 px-4 pt-2.5 flex items-center gap-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "var(--app-bg)" }}
      >
        <button
          type="button"
          onClick={() => {
            hapticTap();
            setAsAnonymous((v) => !v);
          }}
          title={t("postAnonymously")}
          className="haptic-action w-9 h-9 squircle-sm flex items-center justify-center text-sm shrink-0"
          style={{
            background: asAnonymous ? "rgba(94,92,230,0.22)" : "rgba(255,255,255,0.07)",
            border: asAnonymous ? "1px solid rgba(94,92,230,0.5)" : "1px solid transparent",
          }}
        >
          {asAnonymous ? "🕶️" : "👤"}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder={t("addComment")}
          className="flex-1 min-w-0 outline-none text-sm text-white placeholder:text-xs px-3 py-2.5 squircle-sm"
          style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          className="haptic-action shrink-0 px-3.5 py-2.5 squircle-sm text-xs font-bold disabled:opacity-40"
          style={{ background: "#007AFF", color: "#fff" }}
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}

/** 社团活动卡片：海报 + 名称 + 时间地点 + 社团名。 */
function EventCard({ event, onOpen }: { event: ClubEventItem; onOpen: () => void }) {
  const t = useI18n();
  const [posterBroken, setPosterBroken] = useState(false);
  return (
    <button type="button" onClick={onOpen} className="haptic-action interactive-card glass squircle-lg overflow-hidden text-left w-full">
      {event.poster_url && !posterBroken ? (
        <img
          src={event.poster_url}
          alt=""
          loading="lazy"
          className="w-full object-cover"
          style={{ height: 132 }}
          onError={() => setPosterBroken(true)}
        />
      ) : (
        <div className="w-full flex items-center justify-center text-3xl" style={{ height: 96, background: "rgba(255,255,255,0.05)" }}>
          🎪
        </div>
      )}
      <div className="p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#409CFF" }}>
          {event.club_name}
        </p>
        <p className="text-sm font-bold text-white mt-1 leading-snug">{event.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]" style={{ color: "rgba(235,235,245,0.55)" }}>
          <span>🗓 {formatEventTime(event.event_time)}</span>
          {event.location && <span>📍 {event.location}</span>}
        </div>
      </div>
    </button>
  );
}

/** 活动详情：海报 + 时间地点 + 详情 + RSVP / 报名外链。 */
function EventDetail({ event, onBack }: { event: ClubEventItem; onBack: () => void }) {
  const t = useI18n();
  const [posterBroken, setPosterBroken] = useState(false);
  return (
    <div className="app-surface flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold"
        >
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
            <path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("back")}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-32 space-y-3">
        {event.poster_url && !posterBroken ? (
          <img
            src={event.poster_url}
            alt=""
            className="w-full squircle-lg object-cover"
            style={{ maxHeight: 240 }}
            onError={() => setPosterBroken(true)}
          />
        ) : (
          <div
            className="w-full squircle-lg flex items-center justify-center text-4xl"
            style={{ height: 140, background: "rgba(255,255,255,0.05)" }}
          >
            🎪
          </div>
        )}

        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#409CFF" }}>
            {event.club_name}
          </p>
          <h1 className="text-lg font-bold text-white mt-1 leading-snug">{event.title}</h1>
          <div className="mt-3 space-y-1.5 text-xs" style={{ color: "rgba(235,235,245,0.7)" }}>
            <p>🗓 {formatEventTime(event.event_time)}</p>
            {event.location && <p>📍 {event.location}</p>}
            <p>
              👥 {t("organizer")}: {event.club_name}
            </p>
          </div>
          {event.description && (
            <p
              className="text-sm leading-relaxed mt-3 pt-3 whitespace-pre-line"
              style={{ color: "rgba(235,235,245,0.85)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              {event.description}
            </p>
          )}
        </div>

        {event.register_link && (
          <button
            type="button"
            onClick={() => {
              motorHaptic();
              void openExternal(event.register_link as string);
            }}
            className="haptic-action w-full py-3.5 squircle-lg text-sm font-bold"
            style={{ background: "#007AFF", color: "#fff" }}
          >
            {t("rsvp")} ↗
          </button>
        )}
      </div>
    </div>
  );
}

function MediaStrip({ urls, compact = false }: { urls: string[]; compact?: boolean }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const visible = urls.filter((u) => u && !broken[u]);
  if (visible.length === 0) return null;
  const isVideo = (url: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
  return (
    <div className={`grid gap-1.5 mt-2 ${compact ? "grid-cols-3" : "grid-cols-2"}`}>
      {visible.slice(0, compact ? 3 : 4).map((url) => (
        <button
          key={url}
          type="button"
          onClick={() => {
            motorHaptic();
            void openExternal(url);
          }}
          className="haptic-action relative block squircle-sm overflow-hidden"
          style={{ aspectRatio: "4 / 3", background: "rgba(255,255,255,0.06)" }}
        >
          {isVideo(url) ? (
            <span className="absolute inset-0 flex items-center justify-center text-2xl">▶️</span>
          ) : (
            <img
              src={url}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              onError={() => setBroken((prev) => ({ ...prev, [url]: true }))}
            />
          )}
        </button>
      ))}
    </div>
  );
}
