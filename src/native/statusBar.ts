/**
 * 原生状态栏同步（只在 Capacitor 原生壳里生效，浏览器直接跳过）。
 *
 * @capacitor/status-bar 的命名比较反直觉，务必对照：
 *  - Style.Dark  = "DARK"  → 原生 UIStatusBarStyle.lightContent → 浅色(白)文字，给深色背景用；
 *  - Style.Light = "LIGHT" → 原生 UIStatusBarStyle.darkContent  → 深色(黑)文字，给浅色背景用。
 *
 * 所以：深色主题传 Style.Dark，浅色主题传 Style.Light。
 */
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type ResolvedTheme = 'light' | 'dark';

export async function syncNativeStatusBar(theme: ResolvedTheme): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // 始终保持覆盖模式：让状态栏悬浮在 WebView 上，顶距交给 CSS safe-area。
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark });
  } catch {
    /* 非原生/插件不可用时忽略，不影响 Web 版 */
  }
}
