import { useEffect, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import realNews from "../data/realNews.json";
import { API_URLS } from "../utils/config";

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  published_at: string;
  category: string;
  accent: string;
}

/** 真实新闻回退数据（来自 univer.kaznu.kz 新闻页抓取；API 不可用时使用） */
const FALLBACK_NEWS: NewsItem[] = realNews as NewsItem[];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function Arrow() {
  return <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true"><path d="m7 4 5 6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useI18n();
  return <button type="button" onClick={onClick} className="theme-secondary flex items-center gap-1 text-sm font-semibold"><svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>{t("back")}</button>;
}

export function NewsDetail({ item, onBack }: { item: NewsItem; onBack: () => void }) {
  const t = useI18n();
  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
        <BackButton onClick={onBack} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 animate-slide-up">
        <article className="news-article mt-6">
          <div className="p-1">
            <h1 className="text-2xl font-bold text-white mt-2 leading-tight">{item.title}</h1>
            <p className="theme-muted text-xs mt-2">{t("published")} · {formatDate(item.published_at)}</p>
            <div className="news-body theme-secondary mt-6 space-y-4 text-[15px] leading-7">
              <p className="font-semibold text-white">{item.summary}</p>
              <p>{item.body}</p>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

export default function News({ onOpenDetail }: { onOpenDetail: (item: NewsItem) => void }) {
  const t = useI18n();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let initialized = false;
    const notificationsEnabled = () => localStorage.getItem("newsNotifications") !== "muted";

    if (notificationsEnabled() && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }

    const loadNews = () => {
      fetch(API_URLS.news)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("News request failed")))
        .then((data) => {
          const nextItems = Array.isArray(data) ? data as NewsItem[] : FALLBACK_NEWS;
          setItems(nextItems);
          const seenIds = JSON.parse(localStorage.getItem("seenNewsIds") || "[]") as string[];
          const newItems = initialized ? nextItems.filter((item) => !seenIds.includes(item.id)) : [];
          if (notificationsEnabled() && "Notification" in window && Notification.permission === "granted") {
            newItems.forEach((item) => new Notification(item.title, { body: item.summary, tag: item.id }));
          }
          localStorage.setItem("seenNewsIds", JSON.stringify(nextItems.map((item) => item.id)));
          initialized = true;
        })
        .catch(() => setItems((currentItems) => currentItems.length ? currentItems : FALLBACK_NEWS))
        .finally(() => setLoading(false));
    };

    loadNews();
    const refreshTimer = window.setInterval(loadNews, 5 * 60 * 1000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
        <h1 className="text-2xl font-bold text-white">{t("news")}</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 animate-slide-up">
        <div className="space-y-2.5">
          {loading ? <div className="glass squircle-md p-5 theme-muted text-sm">{t("loadingNews")}</div> : items.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenDetail(item)} className="haptic-action news-card glass w-full text-left flex items-center gap-3.5 px-4 py-4">
              <div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold text-white truncate">{item.title}</h2><p className="theme-muted text-xs mt-1">{formatDate(item.published_at)}</p></div>
              <span className="theme-muted shrink-0"><Arrow /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
