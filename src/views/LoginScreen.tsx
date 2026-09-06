import { useState, type FormEvent } from "react";
import { useI18n, useLanguage, type Language } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { saveSession, readSavedAccount, readLastUsername } from "../utils/session";
import { motorHaptic, errorHaptic } from "../utils/haptics";
import kaznuLogo from "../assets/kaznu-logo.png";

const LANGUAGES: Language[] = ["EN", "KZ", "RU"];

/** 演示用固定密码（demo 模拟后端校验） */
const DEMO_PASSWORD = "123456";

const LANGUAGE_NAMES: Record<Language, string> = {
  EN: "English",
  KZ: "Қазақша",
  RU: "Русский",
};

/* 精致线性小图标 */
const SunIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
  </svg>
);

const MoonIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M13.6 9.2A5.6 5.6 0 1 1 6.8 2.4a4.5 4.5 0 0 0 6.8 6.8z" />
  </svg>
);

const AutoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
    <path d="M6.4 14h3.2M8 11v3" />
  </svg>
);

const GlobeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.8 1.6 2.8 3.8 2.8 6.2S9.8 12.6 8 14.2C6.2 12.6 5.2 10.4 5.2 8S6.2 3.4 8 1.8z" />
  </svg>
);

const ChevronIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

/** 登录页顶栏：全局主题 + 语言切换（都存到本地，全 App 生效） */
function LoginToolbar() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const [langOpen, setLangOpen] = useState(false);

  const themeOptions = [
    { value: "light" as const, Icon: SunIcon, label: "Light theme" },
    { value: "dark" as const, Icon: MoonIcon, label: "Dark theme" },
    { value: "system" as const, Icon: AutoIcon, label: "Auto theme" },
  ];

  /** 切换语言（淡入淡出统一在 LanguageContext 里处理） */
  const switchLanguage = (code: Language) => {
    setLanguage(code);
    setLangOpen(false);
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {/* 主题：图标胶囊 */}
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex items-center p-1 rounded-full"
        style={{ background: "var(--seg-track)", border: "1px solid var(--seg-border)" }}
      >
        {themeOptions.map(({ value, Icon, label }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={label}
              onClick={() => setTheme(value)}
              className="haptic-action flex items-center justify-center w-8 h-8 rounded-full transition-colors"
              style={{
                color: active ? "var(--seg-active-fg)" : "var(--seg-inactive)",
                background: active ? "linear-gradient(135deg, #0033A0, #007AFF)" : "transparent",
                boxShadow: active ? "0 2px 8px rgba(0,122,255,0.35)" : "none",
              }}
            >
              <Icon className="w-[15px] h-[15px]" />
            </button>
          );
        })}
      </div>

      {/* 语言：地球 + 弹层 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setLangOpen((open) => !open)}
          aria-haspopup="listbox"
          aria-expanded={langOpen}
          className="haptic-action flex items-center gap-1.5 h-10 pl-3 pr-2.5 rounded-full text-xs font-bold"
          style={{
            background: "var(--seg-track)",
            border: "1px solid var(--seg-border)",
            color: "var(--app-text)",
          }}
        >
          <GlobeIcon className="w-4 h-4" />
          <span>{language}</span>
          <ChevronIcon className={`w-3 h-3 transition-transform duration-200 ${langOpen ? "rotate-180" : ""}`} />
        </button>

        {langOpen && (
          <div
            role="listbox"
            className="absolute right-0 bottom-full mb-2 z-40 min-w-[158px] rounded-2xl p-1.5"
            style={{
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "1px solid var(--seg-border)",
              boxShadow: "0 14px 36px rgba(0,0,0,0.35)",
            }}
          >
            {LANGUAGES.map((code) => {
              const active = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => switchLanguage(code)}
                  className="haptic-action w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold"
                  style={{
                    color: active ? "#007AFF" : "var(--app-text)",
                    background: active ? "rgba(0,122,255,0.14)" : "transparent",
                  }}
                >
                  <span>{LANGUAGE_NAMES[code]}</span>
                  {active && (
                    <svg viewBox="0 0 16 16" fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <path d="M3 8.5l3.2 3.2L13 4.5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const t = useI18n();

  const savedAccount = readSavedAccount();
  const returning = savedAccount !== null;
  const [username, setUsername] = useState(savedAccount?.username ?? readLastUsername() ?? "");
  const [password, setPassword] = useState(savedAccount?.password ?? "");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy && !leaving;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || leaving) return;
    setError(null);
    setBusy(true);
    // demo 模拟后端校验；之后接真实 Univer/后端登录
    const isSameUser = savedAccount?.username === username.trim();
    window.setTimeout(() => {
      // 密码错误 → 红字提示 + 卡片抖动 + 失败震感
      if (password !== DEMO_PASSWORD) {
        setBusy(false);
        setError(t("loginError"));
        setShaking(true);
        window.setTimeout(() => setShaking(false), 560);
        errorHaptic();
        return;
      }
      // 密码正确 → 保存会话，先播整页退场动画再进主界面
      saveSession(
        {
          username: username.trim(),
          password,
          displayName: isSameUser && savedAccount ? savedAccount.displayName : "Aisha Bekova",
          studentId: isSameUser && savedAccount ? savedAccount.studentId : "20260001",
        },
        remember,
      );
      motorHaptic();
      setLeaving(true);
      window.setTimeout(onSuccess, 440);
    }, 650);
  };

  return (
    <div className={`absolute inset-0 z-[120] app-surface overflow-y-auto ${leaving ? "login-leave" : ""}`}>
      <div className="min-h-full flex flex-col px-7 py-10">
        <div className="flex-1 flex flex-col justify-center">
        <div className="flex flex-col items-center mb-8">
          <img src={kaznuLogo} alt="Al-Farabi KazNU" className="w-16 h-16 rounded-2xl" style={{ objectFit: "contain", background: "#fff", padding: 8 }} />
          <p className="text-white text-sm font-semibold mt-4">Al-Farabi KazNU</p>
          <h1 className="text-2xl font-bold text-white mt-1" style={{ letterSpacing: "-0.5px" }}>KazNU Helper</h1>
        </div>

        <form onSubmit={submit} className={`glass squircle-lg p-5 ${shaking ? "animate-shake" : ""}`} onAnimationEnd={() => setShaking(false)}>
          {returning && (
            <div className="flex items-center gap-3 mb-4 rounded-xl px-3 py-2.5" style={{ background: "rgba(0,122,255,0.10)", border: "1px solid rgba(0,122,255,0.22)" }}>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}
              >
                {(savedAccount!.displayName || "U").trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{savedAccount!.displayName}</p>
                <p className="text-xs truncate" style={{ color: "#007AFF" }}>@{savedAccount!.username}</p>
              </div>
            </div>
          )}

          <label className="theme-secondary block mb-1.5 text-xs font-semibold">{t("usernameLabel")}</label>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none mb-4"
            style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
          />

          <label className="theme-secondary block mb-1.5 text-xs font-semibold">{t("passwordLabel")}</label>
          <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "var(--field-bg)", border: `1px solid ${error ? "rgba(255,69,58,0.7)" : "var(--field-border)"}` }}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              autoComplete={remember ? "current-password" : "off"}
              className="flex-1 min-w-0 px-4 py-3 pr-2 text-sm text-white outline-none bg-transparent"
            />
            <button
              type="button"
              aria-label={showPw ? (t("hide") || "Hide password") : (t("show") || "Show password")}
              onClick={() => setShowPw((open) => !open)}
              className="haptic-action shrink-0 mr-1.5 p-1.5 rounded-lg"
              style={{ color: "var(--seg-inactive)" }}
            >
              {showPw ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c4.7 0 8.6 2.7 10.2 7a11.5 11.5 0 0 1-2.6 4" />
                  <path d="M6.6 6.6A10.4 10.4 0 0 0 1.8 12c1.6 4.3 5.5 7 10.2 7 1.5 0 2.9-.3 4.2-.9" />
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M1.8 12C3.4 7.7 7.3 5 12 5s8.6 2.7 10.2 7c-1.6 4.3-5.5 7-10.2 7s-8.6-2.7-10.2-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#FF453A" }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0">
                <circle cx="8" cy="8" r="6.2" />
                <path d="M8 5v3.4M8 11h.01" />
              </svg>
              {error}
            </div>
          )}

          {/* 记住账号 → 自动登录 */}
          <button type="button" onClick={() => setRemember((on) => !on)} className="haptic-action mt-5 w-full flex items-center gap-2.5 text-left" aria-pressed={remember}>
            <span
              className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 transition-colors"
              style={{
                background: remember ? "linear-gradient(135deg, #0033A0, #007AFF)" : "var(--field-bg)",
                border: remember ? "none" : "1px solid var(--field-border)",
              }}
            >
              {remember && (
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              )}
            </span>
            <span className="text-sm font-semibold" style={{ color: "var(--app-text)" }}>{t("rememberMe")}</span>
          </button>
          {remember ? (
            <p className="theme-muted text-[11px] mt-1.5 pl-[30px] leading-relaxed">{t("autoLoginNote")}</p>
          ) : (
            <p className="text-[11px] mt-1.5 pl-[30px] leading-relaxed" style={{ color: "#FF453A", opacity: 0.92 }}>{t("reverifyHint")}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="haptic-action login-cta w-full mt-5 py-3.5 rounded-xl text-sm font-bold disabled:opacity-45 transition-opacity"
          >
            {busy ? "…" : `→ ${t("signIn")}`}
          </button>

          <p className="theme-muted text-[11px] mt-4 text-center leading-relaxed">{t("loginHint")}</p>
        </form>
        </div>

        <div className="flex justify-center pt-5 pb-1 shrink-0">
          <LoginToolbar />
        </div>
      </div>
    </div>
  );
}
