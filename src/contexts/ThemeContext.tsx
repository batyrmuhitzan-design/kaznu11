import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { screenFade } from "../utils/screenFade";

export type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
function getSystemTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const savedTheme = window.localStorage.getItem("theme");
  return savedTheme === "light" || savedTheme === "dark" || savedTheme === "system" ? savedTheme : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const prevThemeRef = useRef(theme);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? getSystemTheme() : theme,
  );

  /** 把主题实际应用到 <html>（同步改 class + 保存） */
  const applyTheme = () => {
    const root = window.document.documentElement;
    const systemTheme = getSystemTheme();
    const resolved = theme === "system" ? systemTheme : theme;

    setResolvedTheme(resolved);
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    localStorage.setItem("theme", theme);
  };

  /** 带过渡地应用主题：记录旧背景色 → 切主题 → 整屏蒙层淡出揭开新画面 */
  const applyThemeWithTransition = () => {
    const isInitial = prevThemeRef.current === theme;
    prevThemeRef.current = theme;

    // 切之前先抓旧的页面背景色，用作蒙层颜色（纯 CSS，任何环境都能播）
    const oldBackground = typeof window !== "undefined" ? getComputedStyle(document.body).backgroundColor : "";
    applyTheme();
    if (!isInitial) {
      screenFade(oldBackground || "#000");
    }
  };

  useEffect(() => {
    applyThemeWithTransition();
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        setResolvedTheme(systemTheme);
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(systemTheme);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => {
      if (prev === "light") return "dark";
      if (prev === "dark") return "system";
      return "light";
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
