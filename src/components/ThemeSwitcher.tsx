import { useTheme, type Theme } from "../contexts/ThemeContext";

interface ThemeOption {
  value: Theme;
  label: string;
  title: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "浅色", title: "切换到浅色模式" },
  { value: "dark", label: "深色", title: "切换到深色模式" },
  { value: "system", label: "系统", title: "跟随系统设置" },
];

// SVG Icons - Minimalist iOS Style Line Icons
const SunIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    className={className}
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Sun core */}
    <circle cx="8" cy="8" r="3" />
    {/* Sun rays */}
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.34 3.34l.71.71M11.95 11.95l.71.71M3.34 12.66l.71-.71M11.95 4.05l.71-.71" />
  </svg>
);

const MoonIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    className={className}
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Crescent moon shape */}
    <path d="M13.5 9a5.5 5.5 0 11-6.5-6.5 4.5 4.5 0 006.5 6.5z" />
  </svg>
);

const DesktopIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    className={className}
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* Monitor screen */}
    <rect x="2" y="2.5" width="12" height="8" rx="1.5" />
    {/* Monitor stand */}
    <path d="M6.5 12.5h3M8 10.5v2" />
  </svg>
);

const THEME_ICONS: Record<Theme, React.FC<{ className?: string }>> = {
  light: SunIcon,
  dark: MoonIcon,
  system: DesktopIcon,
};

// iOS easing function
const IOS_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const activeIndex = THEME_OPTIONS.findIndex((opt) => opt.value === theme);

  return (
    <div
      className="relative inline-flex p-1 rounded-xl"
      style={{
        backgroundColor: "var(--seg-track)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid var(--seg-border)",
      }}
      role="radiogroup"
      aria-label="主题切换"
    >
      {/* iOS Segmented Control Active Background */}
      <div
        className="absolute top-1 bottom-1 rounded-lg shadow-sm"
        style={{
          width: "calc((100% - 8px) / 3)",
          left: `calc(4px + ${activeIndex} * ((100% - 8px) / 3))`,
          background: "linear-gradient(135deg, #0033A0, #007AFF)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15), 0 0.5px 0 rgba(0, 0, 0, 0.05)",
          transition: `transform 250ms ${IOS_EASE}, left 250ms ${IOS_EASE}, background-color 200ms ease`,
        }}
      />

      {/* Theme Options */}
      {THEME_OPTIONS.map((option, index) => {
        const Icon = THEME_ICONS[option.value];
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={option.title}
            onClick={() => setTheme(option.value)}
            className="haptic-action relative z-10 flex items-center justify-center w-10 h-8 rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            style={{
              transform: "scale(1)",
              transition: `transform 150ms ${IOS_EASE}, color 200ms ease`,
            }}
            onMouseDown={(e) => {
              // iOS press feedback
              const target = e.currentTarget;
              target.style.transform = "scale(0.92)";
              setTimeout(() => {
                target.style.transform = "scale(1)";
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setTheme(option.value);
              }
            }}
          >
            <span
              style={{
                color: isActive ? "#ffffff" : "var(--seg-inactive)",
                opacity: isActive ? 1 : 0.8,
                transform: isActive ? "scale(1.05)" : "scale(1)",
                transition: "color 200ms ease, opacity 200ms ease, transform 200ms ease",
              }}
            >
              <Icon className="w-[14px] h-[14px] transition-all duration-200" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
