import { useState, type ReactNode } from "react";
import legalContent from "../locales/legal_content.json";
import { openLegalPdf } from "../native/legalPdf";

export type LegalLang = "kk" | "en" | "ru";

type LegalDoc = {
  docTitle: string;
  updated: string;
  sections: Array<{ title: string; body: string[] }>;
};

const LEGAL_DATA = legalContent as Record<LegalLang, LegalDoc>;

const LANG_TABS: Array<{ code: LegalLang; label: string }> = [
  { code: "kk", label: "Қазақша" },
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

function toLegalLang(code: string | null | undefined): LegalLang {
  if (code === "KZ") return "kk";
  if (code === "RU") return "ru";
  return "en";
}

/** 持久化 key：用户是否已同意条款与隐私政策 */
export const TERMS_ACCEPTED_KEY = "hasAcceptedTerms";

export function hasAcceptedTerms(): boolean {
  try {
    return window.localStorage.getItem(TERMS_ACCEPTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistTermsAccepted(): void {
  try {
    window.localStorage.setItem(TERMS_ACCEPTED_KEY, "true");
  } catch {
    /* ignore */
  }
}

export default function LegalModal({
  open,
  onClose,
  initialLanguage,
}: {
  open: boolean;
  onClose: () => void;
  initialLanguage?: LegalLang;
}) {
  const [lang, setLang] = useState<LegalLang>(() =>
    typeof window === "undefined" ? "en" : toLegalLang(window.localStorage.getItem("language")),
  );
  if (typeof initialLanguage === "string" && initialLanguage !== lang) setLang(initialLanguage);

  if (!open) return null;
  const doc = LEGAL_DATA[lang];

  return (
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)", color: "#FFFFFF" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={doc.docTitle}
        className="relative legal-modal-sheet w-full max-w-[560px] h-[82vh] max-h-[760px] flex flex-col squircle-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 + 语言切换 */}
        <div className="lms-divider shrink-0 p-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <p className="lms-title text-sm font-bold leading-snug" style={{ letterSpacing: "-0.2px" }}>
              {doc.docTitle}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="haptic-action lms-close shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            >
              ✕
            </button>
          </div>
          <p className="lms-meta text-[10px] mt-1">KazNU Helper · Legal · {doc.updated}</p>

          <div role="tablist" aria-label="Language" className="flex gap-1.5 mt-3">
            {LANG_TABS.map(({ code, label }) => {
              const active = lang === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLang(code)}
                  className={`haptic-action flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${active ? "lms-tab-active" : "lms-tab"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 条款正文（可滚动） */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {doc.sections.map((section, index) => (
            <section key={`${lang}-${index}`}>
              <h3 className="lms-section-title text-[13px] font-bold mb-2">{section.title}</h3>
              <div className="space-y-2">
                {section.body.map((paragraph, pi) => (
                  <p key={pi} className="lms-body text-xs leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 底部 */}
        <div className="lms-divider shrink-0 p-4 pt-3 flex gap-2.5">
          <button
            type="button"
            onClick={() => { void openLegalPdf(); }}
            className="haptic-action lms-btn-ghost flex-1 py-3 rounded-xl text-sm font-bold"
          >
            📄 {lang === "kk" ? "Толық PDF-ті ашу" : lang === "ru" ? "Открыть PDF" : "Open Full PDF"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="haptic-action lms-btn-primary flex-1 py-3 rounded-xl text-sm font-bold"
          >
            {lang === "kk" ? "Жабу" : lang === "ru" ? "Закрыть" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
