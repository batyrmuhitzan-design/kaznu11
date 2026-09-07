import { useState, type ReactNode } from "react";
import legalContent from "../locales/legal_content.json";

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
  const [showPdf, setShowPdf] = useState(false);
  const PDF_URL = "/KazNU_Helper_Legal_Notice_3Lang.pdf";
  if (typeof initialLanguage === "string" && initialLanguage !== lang) setLang(initialLanguage);

  if (!open) return null;
  const doc = LEGAL_DATA[lang];

  return (
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={doc.docTitle}
        className="relative w-full max-w-[560px] h-[82vh] max-h-[760px] flex flex-col squircle-lg overflow-hidden"
        style={{ background: "rgba(18,18,24,1)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 完整 PDF 预览（WebView 内联查看） */}
        {showPdf && (
          <div className="absolute inset-0 z-20 flex flex-col p-3 gap-2" style={{ background: "#0b0b10" }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white">📄 Legal Notice · PDF</p>
              <button type="button" aria-label="Close PDF" onClick={() => setShowPdf(false)} className="haptic-action w-8 h-8 rounded-full flex items-center justify-center text-white/80" style={{ background: "rgba(255,255,255,0.1)" }}>✕</button>
            </div>
            <iframe title="KazNU Legal Notice PDF" src={PDF_URL} className="flex-1 w-full rounded-lg" style={{ border: "none", background: "#fff" }} />
          </div>
        )}

        {/* 标题 + 语言切换 */}
        <div className="shrink-0 p-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-white leading-snug" style={{ letterSpacing: "-0.2px" }}>
              {doc.docTitle}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="haptic-action shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white/60"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              ✕
            </button>
          </div>
          <p className="text-[10px] mt-1" style={{ color: "rgba(235,235,245,0.65)" }}>KazNU Helper · Legal · {doc.updated}</p>

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
                  className="haptic-action flex-1 py-2 rounded-lg text-xs font-bold transition-colors"
                  style={{
                    color: active ? "#fff" : "rgba(235,235,245,0.55)",
                    background: active ? "linear-gradient(135deg, #0033A0, #007AFF)" : "rgba(255,255,255,0.06)",
                  }}
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
              <h3 className="text-[13px] font-bold text-white mb-2">{section.title}</h3>
              <div className="space-y-2">
                {section.body.map((paragraph, pi) => (
                  <p key={pi} className="text-xs leading-relaxed" style={{ color: "rgba(235,235,245,0.82)" }}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 底部 */}
        <div className="shrink-0 p-4 pt-3 flex gap-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            type="button"
            onClick={() => setShowPdf(true)}
            className="haptic-action flex-1 py-3 rounded-xl text-sm font-bold"
            style={{ background: "rgba(255,255,255,0.10)", color: "#fff" }}
          >
            📄 {lang === "kk" ? "Толық PDF-ті ашу" : lang === "ru" ? "Открыть PDF" : "Open Full PDF"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="haptic-action flex-1 py-3 rounded-xl text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)", color: "#fff" }}
          >
            {lang === "kk" ? "Жабу" : lang === "ru" ? "Закрыть" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
