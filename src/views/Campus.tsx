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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { hapticTap, motorHaptic } from "../utils/haptics";

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

export default function CampusView() {
  const t = useI18n();
  const toast = useToast();

  const [mode, setMode] = useState<"wall" | "events">("wall");
  const [category, setCategory] = useState<CategoryFilter>("all");
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

  if (composerOpen) {
    return (
      <div className="app-surface h-full flex flex-col overflow-hidden">
        <Composer onClose={() => setComposerOpen(false)} onSubmit={handleSubmitPost} />
      </div>
    );
  }

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      {/* 顶部栏：标题 + live/demo 角标 + 发帖按钮 + 分段控件 */}
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
            {mode === "wall" && (
              <button
                type="button"
                onClick={() => {
                  hapticTap();
                  setComposerOpen(true);
                }}
                className="haptic-action px-3 py-1.5 squircle-sm text-[11px] font-bold"
                style={{ background: "#007AFF", color: "#fff" }}
              >
                ✏️ {t("writePost")}
              </button>
            )}
          </div>
        </div>

        <div className="flex rounded-full p-1 mt-2.5" style={{ background: "var(--seg-track)" }}>
          {(["wall", "events"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  hapticTap();
                  setMode(m);
                }}
                className="haptic-action flex-1 py-2 rounded-full text-[11px] font-bold transition-all"
                style={{
                  background: active ? "#007AFF" : "transparent",
                  color: active ? "#fff" : "rgba(235,235,245,0.6)",
                }}
              >
                {m === "wall" ? `🧱 ${t("campusWall")}` : `🎪 ${t("campusEvents")}`}
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
                <PostCard key={p.id} post={p} onOpen={() => setOpenPost(p)} onLike={() => void handleLike(p)} />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-28 space-y-3 animate-slide-up">
          {events.length === 0 ? (
            <EmptyState icon="🎪" title={t("noEvents")} hint={t("noEventsHint")} />
          ) : (
            events.map((e) => <EventCard key={e.id} event={e} onOpen={() => setOpenEvent(e)} />)
          )}
        </div>
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
    <div className="shrink-0 flex gap-2 overflow-x-auto px-4 pb-2.5">
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            className="haptic-action shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold"
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
}: {
  post: CampusPost;
  onOpen: () => void;
  onLike: () => void;
}) {
  const t = useI18n();
  return (
    <div className="glass squircle-lg p-4">
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
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(235,235,245,0.65)" }}>
          {categoryEmoji(post.category)} {t(CATEGORY_KEY[post.category])}
        </span>
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
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PostCategory>("general");
  const [asAnonymous, setAsAnonymous] = useState(true);
  const [mediaText, setMediaText] = useState("");
  const [sending, setSending] = useState(false);

  const mediaUrls = mediaText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line))
    .slice(0, 6);
  const canSubmit = content.trim().length > 0 && !sending;

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

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-8 space-y-3">
        <textarea
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

        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>
            {t("mediaLinks")}
          </p>
          <textarea
            value={mediaText}
            onChange={(e) => setMediaText(e.target.value)}
            rows={3}
            placeholder="https://…"
            className="w-full bg-transparent outline-none text-xs text-white placeholder:text-xs resize-none"
            style={{ fontFamily: "JetBrains Mono" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "rgba(235,235,245,0.4)" }}>
            {t("mediaLinksHint")}
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
}: {
  post: CampusPost;
  onBack: () => void;
  onLike: () => void;
  onCommentCountChange: (count: number) => void;
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
            {categoryEmoji(post.category)} {t(CATEGORY_KEY[post.category])}
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

      {/* 评论输入条（子屏位于 Tab Bar 之上，底部安全区由 Tab Bar 负责） */}
      <div
        className="shrink-0 px-4 py-2.5 flex items-center gap-2"
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
