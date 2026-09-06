import { useState } from "react";
import { APP_VERSION, openUpdateUrl, type UpdateInfo } from "../utils/update";
import { hapticTap } from "../utils/haptics";

export type UpdateDialogKind = "none" | "optional" | "forced";

interface UpdateDialogProps {
  kind: UpdateDialogKind;
  info: UpdateInfo | null;
  onClose: () => void;
  onDismissOptional?: () => void;
}

const COPY: Record<"en" | "ru", { title: string; subtitle: string; later: string; update: string; note: string; newVer: string }> = {
  en: {
    title: "A new version is available",
    subtitle: "Update KazNU Helper to get the latest features and fixes.",
    later: "Later",
    update: "Update now",
    note: "This update is required to continue using the app.",
    newVer: "New version",
  },
  ru: {
    title: "Доступна новая версия",
    subtitle: "Обновите KazNU Helper, чтобы получить новые функции и исправления.",
    later: "Позже",
    update: "Обновить",
    note: "Это обновление обязательно для продолжения работы.",
    newVer: "Новая версия",
  },
};

export default function UpdateDialog({ kind, info, onClose, onDismissOptional }: UpdateDialogProps) {
  const [lang] = useState<"en" | "ru">(() => (typeof window !== "undefined" && window.localStorage.getItem("language") === "RU" ? "ru" : "en"));
  if (kind === "none" || !info) return null;

  const forced = kind === "forced";
  const c = COPY[lang];
  const dismiss = () => {
    if (forced) return;
    void hapticTap();
    onDismissOptional?.();
    onClose();
  };
  const goUpdate = () => {
    void hapticTap();
    openUpdateUrl(info.update_url);
    if (!forced) onClose();
  };

  return (
    <div className="update-backdrop" role="alertdialog" aria-modal="true" aria-label={c.title}>
      <div className="update-card glass squircle-lg p-5 w-[86%] max-w-[340px]" style={{ maxWidth: 340 }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "rgba(0,122,255,0.15)" }}>🔄</div>
        <h2 className="text-lg font-bold text-white mt-3" style={{ letterSpacing: "-0.3px" }}>{c.title}</h2>
        <p className="theme-secondary text-sm mt-1.5 leading-relaxed">{forced ? c.note : c.subtitle}</p>

        {info.notes && info.notes.length > 0 && (
          <div className="mt-3 px-3 py-2.5 rounded-xl text-xs theme-muted leading-relaxed" style={{ background: "rgba(255,255,255,0.05)" }}>
            {info.notes.join(" · ")}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 text-[11px] theme-muted">
          <span>{c.newVer}: {info.latest_version}</span>
          <span>Current: {APP_VERSION}</span>
        </div>

        <div className="flex gap-2.5 mt-4">
          {!forced && (
            <button type="button" onClick={dismiss} data-haptic="light" className="haptic-action flex-1 py-3 rounded-xl text-sm font-semibold theme-secondary" style={{ background: "rgba(120,120,128,0.16)" }}>
              {c.later}
            </button>
          )}
          <button type="button" onClick={goUpdate} className="haptic-action flex-[1.6] py-3 rounded-xl text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}>
            {c.update}
          </button>
        </div>
        {forced && <p className="text-center text-[11px] theme-muted mt-3">⛔ 该版本过低，无法跳过</p>}
      </div>
    </div>
  );
}
