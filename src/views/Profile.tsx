import { useState } from "react";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { useLanguage, useI18n, type Language } from "../contexts/LanguageContext";
import { clearSession } from "../utils/session";
import { applyCourseAlertsPreference } from "../services/CourseReminderService";
import SwipeBack from "../components/SwipeBack";
import LegalModal from "../components/LegalModal";
import { openLegalPdf } from "../native/legalPdf";
import { screenFadeOut } from "../utils/screenFade";
import { APP_VERSION } from "../utils/update";

interface ProfileProps {
  onBack: () => void;
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
      <path d="m7.5 4 5 6-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const t = useI18n();
  return (
    <button type="button" onClick={onClick} className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold">
      <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
        <path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("back")}
    </button>
  );
}

function Settings({ onBack }: { onBack: () => void }) {
  const { language, setLanguage } = useLanguage();
  const t = useI18n();
  const [showLanguages, setShowLanguages] = useState(false);
  const [newsNotifications, setNewsNotifications] = useState(() => localStorage.getItem("newsNotifications") !== "muted");
  const [classAlerts, setClassAlerts] = useState(() => localStorage.getItem("courseAlertsEnabled") !== "off");
  const languageNames: Record<Language, string> = { EN: "English", KZ: "Қазақша", RU: "Русский" };

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
        <BackButton onClick={onBack} />
        <h1 className="text-2xl font-bold text-white mt-3">{t("settings")}</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-4 animate-slide-up">

        <section>
          <p className="theme-section-title text-xs font-semibold uppercase tracking-wide mb-2 px-1">{t("appearance")}</p>
          <div className="glass squircle-md overflow-hidden">
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-white">{t("theme")}</p>
                <p className="theme-muted text-xs mt-0.5">{t("chooseTheme")}</p>
              </div>
              <ThemeSwitcher />
            </div>
          </div>
        </section>

        <section>
          <p className="theme-section-title text-xs font-semibold uppercase tracking-wide mb-2 px-1">{t("preferences")}</p>
          <div className="glass squircle-md overflow-hidden divide-y divide-white/10">
            <button type="button" aria-pressed={newsNotifications} onClick={() => { const next = !newsNotifications; setNewsNotifications(next); localStorage.setItem("newsNotifications", next ? "enabled" : "muted"); }} className="haptic-action theme-row w-full flex items-center justify-between px-4 py-4 text-left">
              <span className="text-sm font-semibold text-white">{t("newsNotifications")}</span>
              <span className={`text-xs ${newsNotifications ? "text-green-500" : "theme-muted"}`}>{newsNotifications ? t("enabled") : t("muted")}</span>
            </button>
            <button
              type="button"
              aria-pressed={classAlerts}
              onClick={() => {
                const next = !classAlerts;
                setClassAlerts(next);
                void applyCourseAlertsPreference(next);
              }}
              className="haptic-action theme-row w-full flex items-center justify-between px-4 py-4 text-left"
            >
              <div>
                <span className="text-sm font-semibold text-white">
                  {language === "KZ"
                    ? "⏰ Сабақ пен бағалар туралы ескертулер"
                    : language === "RU"
                      ? "⏰ Напоминания о занятиях и оценках"
                      : "⏰ Class & grade alerts"}
                </span>
                <p className="theme-muted text-xs mt-0.5">
                  {language === "KZ"
                    ? "T-60 / T-30 / T-0 ескертулер · әдепкі бойынша қосулы"
                    : language === "RU"
                      ? "Напоминания T-60 / T-30 / T-0 · включено по умолчанию"
                      : "T-60 / T-30 / T-0 reminders · always on by default"}
                </p>
              </div>
              <span className={`text-xs ${classAlerts ? "text-green-500" : "theme-muted"}`}>{classAlerts ? t("enabled") : t("muted")}</span>
            </button>
            <button type="button" onClick={() => setShowLanguages((open) => !open)} className="haptic-action theme-row w-full flex items-center justify-between px-4 py-4 text-left">
              <span className="text-sm font-semibold text-white">{t("language")}</span>
              <span className="theme-muted flex items-center gap-2 text-xs">{languageNames[language]} <Chevron /></span>
            </button>
            {showLanguages && (
              <div className="border-t border-white/10 p-2">
                {(["EN", "KZ", "RU"] as Language[]).map((option) => (
                  <button key={option} type="button" onClick={() => { setLanguage(option); setShowLanguages(false); }} className={`haptic-action theme-row w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ${language === option ? "bg-blue-500/15 text-blue-500" : "text-white"}`}>
                    <span>{languageNames[option]}</span>
                    {language === option && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 退出登录：清掉本地会话，下次启动要求重新验证 */}
        <button
          type="button"
          onClick={() => {
            // 先整屏淡出成底色，再清会话并回到登录页
            screenFadeOut(undefined, () => {
              clearSession();
              window.location.reload();
            });
          }}
          className="haptic-action w-full py-3.5 squircle-md text-sm font-bold"
          style={{ background: "rgba(255,69,58,0.14)", color: "#FF453A", border: "1px solid rgba(255,69,58,0.28)" }}
        >
          {t("logout")}
        </button>
      </div>
    </div>
  );
}

function About({ onBack }: { onBack: () => void }) {
  const t = useI18n();
  const { language } = useLanguage();
  const [openPolicy, setOpenPolicy] = useState<number | null>(null);
  const [showLegalTerms, setShowLegalTerms] = useState(false);

  const policyTitles: Record<string, string[]> = {
    EN: ["Disclaimer", "Privacy notice", "Terms of use", "No official affiliation"],
    KZ: ["Жауапкершіліктен бас тарту", "Құпиялылық туралы хабарлама", "Пайдалану шарттары", "Ресми қатысы жоқ"],
    RU: ["Дисклеймер", "Уведомление о конфиденциальности", "Условия использования", "Не является официальным"],
  };

  const policies: Array<{ title: string; body: string }> = [
    {
      title: "Disclaimer",
      body:
        "KazNU Helper is an independent student tool. Timetable, grades, news and campus data are provided for convenience only and may contain delays or errors. Always confirm critical academic information (exams, deadlines, registrations, fees) with official Al-Farabi Kazakh National University systems and staff. The app does not replace official academic services and is not responsible for decisions made based on its data.",
    },
    {
      title: "Privacy notice",
      body:
        "All personal data (login session, student ID, preferences) stays on your device and is never sold. Location is used only to detect whether you are near campus for campus services. Notifications are scheduled locally on your iPhone. If you later connect to third-party services (Univer, Kaspi, Telegram, WeChat, printers), their own privacy policies apply. You can disable each permission in iOS Settings or inside the app.",
    },
    {
      title: "Terms of use",
      body:
        "By using KazNU Helper you agree to use it for lawful, non-commercial, personal purposes. You may not republish, resell or scrape the content. We may change or remove features at any time. The app is provided 'as is' without warranties of any kind, express or implied, to the maximum extent permitted by law.",
    },
    {
      title: "No official affiliation",
      body:
        "KazNU Helper is NOT an official application of Al-Farabi Kazakh National University. 'KazNU' and university names/marks belong to their respective owners and are referenced only to identify the academic context. This project has no sponsorship or endorsement from the university.",
    },
  ];

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
        <BackButton onClick={onBack} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-4 animate-slide-up">
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-white text-xl font-bold" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}>AB</div>
          <h1 className="text-2xl font-bold text-white mt-4">KazNU Helper</h1>
          <p className="theme-muted text-sm mt-1">{t("university")}</p>
        </div>
        <div className="glass squircle-md p-4 space-y-3">
          <div className="flex items-center justify-between"><span className="theme-muted text-sm">{t("version")}</span><span className="text-sm font-semibold text-white">{APP_VERSION}</span></div>
          <div className="flex items-center justify-between"><span className="theme-muted text-sm">{t("university")}</span><span className="text-sm font-semibold text-white">Al-Farabi KazNU</span></div>
        </div>
        <p className="theme-muted text-xs text-center leading-relaxed px-2">{t("aboutDescription")}</p>

        {/* 条款与隐私（随时可再查看） */}
        <button
          type="button"
          onClick={() => setShowLegalTerms(true)}
          className="haptic-action glass squircle-md legal-card w-full flex items-center justify-between px-4 py-3.5 text-left"
        >
          <div>
            <p className="lm-title text-sm font-semibold">
              {language === "KZ" ? "Құқықтық ақпарат" : language === "RU" ? "Правовая информация" : "Terms of Service & Privacy Policy"}
            </p>
            <p className="lm-sub text-[11px] mt-0.5">KK · EN · RU</p>
          </div>
          <Chevron />
        </button>
        <button
          type="button"
          onClick={() => { void openLegalPdf(); }}
          className="haptic-action glass squircle-md legal-card w-full flex items-center justify-between px-4 py-3.5 text-left"
        >
          <div>
            <p className="lm-title text-sm font-semibold">
              {language === "KZ" ? "📄 Толық PDF ашу" : language === "RU" ? "📄 Открыть полный PDF" : "📄 Open Full PDF Legal Notice"}
            </p>
            <p className="lm-sub text-[11px] mt-0.5">KK · EN · RU · PDF</p>
          </div>
          <Chevron />
        </button>
        <LegalModal open={showLegalTerms} onClose={() => setShowLegalTerms(false)} />
        {/* 声明 / 隐私 / 条款 */}
        <div className="space-y-2.5">
          {policies.map((policy, index) => {
            const open = openPolicy === index;
            return (
              <div key={policy.title} className="glass squircle-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenPolicy(open ? null : index)}
                  className="haptic-action theme-row w-full flex items-center justify-between px-4 py-3.5 text-left"
                >
                  <span className="text-sm font-semibold text-white">{policyTitles[language][index]}</span>
                  <Chevron />
                </button>
                {open && (
                  <>
                    <p className="theme-secondary text-xs leading-relaxed px-4 pb-4">{policy.body}</p>
                    <p className="theme-muted text-[10px] px-4 pb-4">
                      {language === "KZ" ? "Толық мәтін: LEGAL.md (EN · KZ · RU)" : language === "RU" ? "Полный текст: LEGAL.md (EN · KZ · RU)" : "Full text: LEGAL.md (EN · KZ · RU)"}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Profile({ onBack }: ProfileProps) {
  const [subpage, setSubpage] = useState<"profile" | "settings" | "about">("profile");
  const t = useI18n();

  if (subpage === "settings") return <SwipeBack onBack={() => setSubpage("profile")}><Settings onBack={() => setSubpage("profile")} /></SwipeBack>;
  if (subpage === "about") return <SwipeBack onBack={() => setSubpage("profile")}><About onBack={() => setSubpage("profile")} /></SwipeBack>;

  return (
    <div className="app-surface h-full overflow-y-auto">
      <div className="px-4 pt-2 pb-32 space-y-4 animate-slide-up">
        <BackButton onClick={onBack} />
        <div className="flex items-center gap-4 pt-2 pb-2">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-lg font-bold" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}>AB</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Aisha Bekova</h1>
            <p className="theme-muted text-sm mt-1">{t("computerScience")} · {t("year")}</p>
            <p className="theme-muted text-xs mt-0.5">Student ID 20260001</p>
          </div>
        </div>

        <div className="glass squircle-md overflow-hidden">
          <button type="button" onClick={() => setSubpage("settings")} className="haptic-action theme-row w-full flex items-center justify-between px-4 py-4 text-left">
            <div><p className="text-sm font-semibold text-white">{t("settings")}</p><p className="theme-muted text-xs mt-0.5">{t("appearance")} · {t("preferences")}</p></div>
            <Chevron />
          </button>
          <button type="button" onClick={() => setSubpage("about")} className="haptic-action theme-row w-full flex items-center justify-between px-4 py-4 text-left border-t border-white/10">
            <div><p className="text-sm font-semibold text-white">{t("about")}</p><p className="theme-muted text-xs mt-0.5">{t("version")} and app information</p></div>
            <Chevron />
          </button>
        </div>
      </div>
    </div>
  );
}
