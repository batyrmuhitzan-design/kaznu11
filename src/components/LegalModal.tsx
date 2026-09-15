import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  open: openProp,
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

  // 语言同步：必须放在 effect 里。
  // 以前写成 render 期间 `if (initialLanguage !== lang) setLang(...)` ——
  // 那是"渲染中改状态"，React 会立刻重渲染，一旦父组件每次渲染都传新对象/新值，
  // 就会陷入 "Too many re-renders" 直接白屏（用户遇到的"免责声明白屏/卡死"）。
  useEffect(() => {
    if (typeof initialLanguage === "string" && initialLanguage !== lang) {
      setLang(initialLanguage);
    }
  }, [initialLanguage]);

  const open = Boolean(openProp);

  // 打开期间锁住背景滚动：否则弹层后面的页面会跟着手指滑，
  // 关掉后位置全乱（"往下滚一段就白屏"的观感来源之一）。
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;
  const doc = LEGAL_DATA[lang];

  const content = (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end" onClick={onClose}>
      {/* 遮罩：跟随主题（深色 dark scrim / 浅色 light scrim），不再写死 rgba(0,0,0,.22) */}
      <div className="modal-scrim absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={doc.docTitle}
        className="legal-modal-sheet sheet-surface relative flex flex-col w-full overflow-hidden"
        style={{
          // dvh 而不是 vh：iOS 地址栏/键盘出现时 vh 不会收缩，会顶出屏幕
          height: "min(92dvh, 92vh)",
          borderRadius: "28px 28px 0 0",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
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

        {/* 底部（含 Home Indicator 安全区） */}
        <div className="lms-divider shrink-0 px-4 pt-3 flex gap-2.5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}>
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

  // Portal 到 body：渲染在页面结构之外，彻底摆脱父级
  // overflow / transform / z-index 层叠上下文的影响。
  // 以前直接内联在 About 页面的滚动容器里，任何祖先只要带 transform 或
  // overflow:hidden，fixed 就会被"关"在那个容器里 —— 表现为弹层只盖住半屏、
  // 或者干脆看不见（用户报的"白屏/卡死"之一）。
  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
