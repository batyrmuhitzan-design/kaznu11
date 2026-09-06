import { useState } from "react";
import { useI18n, useLanguage } from "../contexts/LanguageContext";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  target: string;
  color: string;
}

const NOTIFICATIONS: NotificationItem[] = [
  { id: "class", title: "Higher Mathematics II", body: "Your class starts in 12 min · Room 315", time: "Now", target: "schedule", color: "#007AFF" },
  { id: "news", title: "New campus announcement", body: "A new university announcement is available", time: "12 min ago", target: "news", color: "#30D158" },
  { id: "grade", title: "Academic record updated", body: "Your latest grade information is ready to view", time: "Yesterday", target: "grades", color: "#5E5CE6" },
];

function BellIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useI18n();
  return <button type="button" onClick={onClick} className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold"><svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>{t("back")}</button>;
}

export default function Notifications({ onBack, onNavigate }: { onBack: () => void; onNavigate: (target: string) => void }) {
  const t = useI18n();
  const { language } = useLanguage();
  const [readIds, setReadIds] = useState<string[]>(() => JSON.parse(localStorage.getItem("readNotificationIds") || "[]"));
  const unreadCount = NOTIFICATIONS.length - readIds.length;
  const readAllLabel = language === "EN" ? "Read all" : language === "KZ" ? "Барлығын оқу" : "Прочитать всё";
  const newMessagesLabel = language === "EN" ? "new" : language === "KZ" ? "жаңа" : "новых";

  function markAllRead() {
    const allIds = NOTIFICATIONS.map((item) => item.id);
    setReadIds(allIds);
    localStorage.setItem("readNotificationIds", JSON.stringify(allIds));
  }

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
          <div className="flex items-center justify-between mb-2.5">
            <BackButton onClick={onBack} />
            <button type="button" onClick={markAllRead} disabled={!unreadCount} className="haptic-action theme-secondary text-xs font-semibold disabled:opacity-40">{readAllLabel}</button>
          </div>
          <div className="flex items-end justify-between"><div><p className="theme-muted text-xs font-semibold uppercase tracking-wide">KazNU Helper</p><h1 className="text-2xl font-bold text-white mt-1">{t("notifications")}</h1></div><span className="notification-count">{unreadCount} {newMessagesLabel}</span></div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 animate-slide-up">
        <div className="space-y-2.5">
          {NOTIFICATIONS.map((item) => {
            const isRead = readIds.includes(item.id);
            return <button key={item.id} type="button" onClick={() => { const nextIds = readIds.includes(item.id) ? readIds : [...readIds, item.id]; setReadIds(nextIds); localStorage.setItem("readNotificationIds", JSON.stringify(nextIds)); onNavigate(item.target); }} className={`haptic-action notification-row w-full flex items-start gap-3.5 p-4 rounded-2xl text-left ${isRead ? "is-read" : ""}`}>
              <div className="notification-icon" style={{ color: item.color, background: `${item.color}18` }}><BellIcon /></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-white truncate">{item.title}</p><p className="theme-secondary text-xs mt-1 leading-relaxed">{item.body}</p><p className="theme-muted text-[10px] mt-2">{item.time}</p></div>
              {!isRead && <span className="notification-unread" />}
            </button>;
          })}
        </div>
      </div>
    </div>
  );
}
