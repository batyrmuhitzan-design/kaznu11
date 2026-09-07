/**
 * iOS 主屏 3D Touch / 长按图标 快捷操作（Home Screen Quick Actions）。
 *
 * 原生端（SceneDelegate/AppDelegate → KaznuQuickActions）把快捷操作 type 注入
 * WKWebView 的 `kaznu:shortcut` CustomEvent；这里负责监听并映射成 App 路由目标。
 * 同时把处理结果写回 window.__kaznuShortcutAck，供原生端轮询确认、避免冷启动丢事件。
 * 纯 Web 预览没有任何触发源，天然跳过。
 */

export const QUICK_SHORTCUT_EVENT = "kaznu:shortcut";

/** 与 ios/App/App/Info.plist → UIApplicationShortcutItems 中的 type 保持一致。 */
export type QuickActionType =
  | "com.kaznu.helper.shortcut.schedule"
  | "com.kaznu.helper.shortcut.student-id"
  | "com.kaznu.helper.shortcut.dev-console";

/** 路由目标：schedule=今日课表；profile=电子学生证；dev=开发者控制台。 */
export type QuickActionTarget = "schedule" | "profile" | "dev";

declare global {
  interface Window {
    /** 原生端用来确认快捷操作已被 Web 侧接收。 */
    __kaznuShortcutAck?: string;
  }
}

export function toQuickActionTarget(type: string): QuickActionTarget | null {
  switch (type) {
    case "com.kaznu.helper.shortcut.schedule":
      return "schedule";
    case "com.kaznu.helper.shortcut.student-id":
      return "profile";
    case "com.kaznu.helper.shortcut.dev-console":
      return "dev";
    default:
      return null;
  }
}

/**
 * 监听原生快捷操作事件，返回取消订阅函数。
 * handler 只会在能识别出目标页/动作时被调用。
 */
export function installQuickActionListener(handler: (target: QuickActionTarget) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ type?: string }>).detail;
    const type = detail?.type ?? "";
    if (!type) return;
    // 回执：任何收到的事件都确认，原生端据此决定是否补发。
    window.__kaznuShortcutAck = type;
    const target = toQuickActionTarget(type);
    if (target) handler(target);
  };
  window.addEventListener(QUICK_SHORTCUT_EVENT, onEvent);
  return () => window.removeEventListener(QUICK_SHORTCUT_EVENT, onEvent);
}
