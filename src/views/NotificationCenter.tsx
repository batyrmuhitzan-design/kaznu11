/**
 * 通知中心 —— 真实后端数据（`GET /api/v1/notifications`）。
 *
 * 取代了此前 `views/Notifications.tsx` 里写死的 3 条假数据：那个版本红点永远算不准、
 * 点进去也跳不到真实内容，现在全部由后端驱动：
 *
 *  - 定向通知（点赞/评论/私信/官方公告）：分页列表 + 单条已读 + 全部已读；
 *  - 全校广播：单独一段（服务端用"读游标时间戳"表达，不写 N 行）；
 *  - 未读红点：与首页铃铛共用 `subscribeNotificationUnread`，两处永远一致；
 *  - 点击跳转：按 `route`（chat / post / news / campus）交给 App 顶层路由。
 *
 * 实时：服务端在私信那条 WebSocket 上也会推 notification / broadcast 帧
 * （见 `App.tsx` 的全局 WS 桥接），到达后 revision 变化 → 本页自动重取。
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { hapticTap } from "../utils/haptics";
import {
  loadNotificationCenter,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeRealtimeRevision,
  type BroadcastItem,
  type NotificationItem,
} from "../services/NotificationService";

type TFn = ReturnType<typeof useI18n>;

/** 通知 kind → 图标与配色（与后端 models 的注释一一对应）
 *  颜色全部走语义 token：浅色模式下 #409CFF / #FF9F0A 这类亮色在白底上会糊掉 */
const KIND_STYLE: Record<string, { icon: string; color: string }> = {
  like: { icon: "❤️", color: "var(--danger)" },
  comment: { icon: "💬", color: "var(--accent-soft-text)" },
  message: { icon: "✉️", color: "var(--success)" },
  official: { icon: "📢", color: "var(--warm-soft-text)" },
  system: { icon: "⚙️", color: "var(--tx-5)" },
};

/** 广播级别配色（与 Campus 顶部紧急通知栏同一套语义色） */
const LEVEL_STYLE: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: "var(--accent-soft-bg)", border: "var(--accent-soft-border)", text: "var(--accent-soft-text)", icon: "ℹ️" },
  warning: { bg: "var(--warm-soft-bg)", border: "var(--warm-soft-border)", text: "var(--warm-soft-text)", icon: "⚠️" },
  danger: { bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.36)", text: "var(--danger)", icon: "🚨" },
};

/** ISO → now / 12m / 3h / 2d / 日期 */
function timeAgo(iso: string | null): string {
  if (!iso) return "";
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

/** 通知正文：服务端只给 kind + actor，具体句式由前端拼（更本地化） */
function describe(item: NotificationItem, t: TFn): string {
  const actor = item.actor_name ?? "";
  const kindText =
    item.kind === "like"
      ? t("notifLike")
      : item.kind === "comment"
        ? t("notifComment")
        : item.kind === "message"
          ? t("notifMessage")
          : item.kind === "official"
            ? t("notifOfficial")
            : t("notifSystem");
  return actor ? `${actor} ${kindText}` : kindText;
}

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

export default function NotificationCenter({
  onBack,
  onOpenRoute,
}: {
  onBack: () => void;
  /** route = chat / post / news / campus / none，routeId 为目标对象 id */
  onOpenRoute: (route: string, routeId: string | null) => void;
}) {
  const t = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadNotificationCenter(30, 0);
    if (!data) {
      setFailed(true);
      setLoading(false);
      return;
    }
    setFailed(false);
    setItems(data.items);
    setBroadcasts(data.broadcasts);
    setUnread(data.unread_count);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  // WS 到达的 notification / broadcast 帧会让 revision +1 → 本页自动重取
  useEffect(() => subscribeRealtimeRevision(() => void refresh()), [refresh]);

  /** 点一条：先本地标已读（即时反馈），再交给顶层路由跳转 */
  const openItem = async (item: NotificationItem) => {
    hapticTap();
    if (!item.is_read) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)));
      setUnread((prev) => Math.max(0, prev - 1));
      void markNotificationRead(item.id);
    }
    onOpenRoute(item.route, item.route_id);
  };

  const readAll = async () => {
    hapticTap();
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setBroadcasts((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    const ok = await markAllNotificationsRead();
    if (ok) toast.push(t("notifAllReadDone"), "success");
  };

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 shrink-0">
        {/* ⚠️ 这一行必须允许换行：哈语 "Барлығын оқылды деп белгілеу"（28 字符）
            与俄语 "Отметить все как прочитанные" 都比英语长一倍，
            在 iPhone SE / mini 上与返回键挤成一行会把文字压扁甚至截断。
            flex-wrap 让长语言自动落到第二行并右对齐，不改语言长度也不写死宽度。 */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2.5">
          <BackButton onClick={onBack} />
          <button
            type="button"
            onClick={() => void readAll()}
            disabled={unread === 0}
            className="haptic-action notif-read-all ml-auto text-right text-xs font-semibold"
          >
            {t("markAllRead")}
          </button>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="theme-muted text-xs font-semibold uppercase tracking-wide">KazNU Helper</p>
            {/* 标题也放宽：哈语 "Хабарландырулар" / 俄语 "Уведомления" 都比 "Notifications" 长 */}
            <h1 className="text-2xl font-bold text-white mt-1 truncate">{t("notifCenter")}</h1>
          </div>
          <span className="notification-count shrink-0 text-right">
            {unread} {t("newMessages")}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-2.5 animate-slide-up">
        {/* 全校广播：有就置顶（带级别配色，与 Campus 紧急通知栏同一套语义） */}
        {broadcasts.map((item) => {
          const style = LEVEL_STYLE[item.level] ?? LEVEL_STYLE.info;
          return (
            <div
              key={item.id}
              className={`notification-row w-full flex items-start gap-3.5 p-4 rounded-2xl ${item.is_read ? "is-read" : ""}`}
              style={{ background: style.bg, border: `1px solid ${style.border}` }}
            >
              <div className="notification-icon" style={{ color: style.text, background: `${style.text}18` }}>
                {style.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: style.text }}>
                  {t("broadcastLabel")}
                </p>
                <p className="text-sm font-semibold text-white mt-0.5">{item.title}</p>
                <p className="theme-secondary text-xs mt-1 leading-relaxed">{item.message}</p>
                <p className="theme-muted text-[10px] mt-2">{timeAgo(item.created_at)}</p>
              </div>
            </div>
          );
        })}

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
        ) : items.length === 0 ? (
          <div className="glass squircle-lg px-4 py-10 flex flex-col items-center text-center">
            <span className="text-3xl">🔔</span>
            <p className="text-sm font-bold text-white mt-2">{t("notifEmpty")}</p>
            <p className="text-xs mt-1 theme-muted">{t("notifEmptyHint")}</p>
          </div>
        ) : (
          items.map((item) => {
            const style = KIND_STYLE[item.kind] ?? KIND_STYLE.system;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void openItem(item)}
                className={`haptic-action notification-row w-full flex items-start gap-3.5 p-4 rounded-2xl text-left ${item.is_read ? "is-read" : ""}`}
              >
                <div className="notification-icon" style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 10%, transparent)` }}>
                  {style.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{item.title}</p>
                  <p className="theme-secondary text-xs mt-1 leading-relaxed">{describe(item, t)}</p>
                  {item.body && <p className="theme-muted text-xs mt-1 leading-relaxed">{item.body}</p>}
                  <p className="theme-muted text-[10px] mt-2">{timeAgo(item.created_at)}</p>
                </div>
                {!item.is_read && <span className="notification-unread" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}