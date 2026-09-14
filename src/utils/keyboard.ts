/**
 * 软键盘可见性探测（iOS WKWebView 友好）—— **不引入新依赖**。
 *
 * 为什么不用 `@capacitor/keyboard`：本项目未安装该插件，且 Web 层已有足够信息：
 * iOS 拉起键盘时**布局视口不变、视觉视口变矮**（`window.visualViewport.height` 变小，
 * 若页面被顶上去则 `offsetTop` > 0），所以
 *
 *     被遮挡高度 = window.innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * 就是键盘高度，精度足以驱动 UI（原生插件同源、数值一致）。
 *
 * 结果不通过 props 传递，而是写到 `<html>` 上，让**任何**组件用 CSS 直接消费，
 * 避免逐层透传（底部 TabBar 在 App.tsx、FAB 在 Campus.tsx，两者相距很远）：
 *
 *   html.kb-open            → 键盘已弹出（底部 TabBar / FAB 自动收起）
 *   --kb-inset: <px>        → 键盘高度（输入区据此做 padding，实现"界面优雅抬升"）
 *
 * ⚠️ 键盘是**动画**展开的（~250ms），`focusin` 那一刻量到的是中间值，
 *    所以 focus/blur 之后要按时间点多次复测；另外 iOS 会顺带滚动页面 → 也要监听
 *    `visualViewport.scroll`。
 */
import { useEffect, useState } from "react";

/** 小于这个高度不算键盘（地址栏收起 / 旋转 / 系统提示条都会造成几十 px 抖动）。 */
const MIN_KEYBOARD_PX = 90;

/** 键盘动画期间需要复测的时间点（ms，相对 focus/blur）。 */
const REMEASURE_DELAYS = [80, 180, 320, 480];

export interface KeyboardState {
  open: boolean;
  /** 键盘占据的高度（px）；未弹出时为 0。 */
  inset: number;
}

let state: KeyboardState = { open: false, inset: 0 };
const subscribers = new Set<(next: KeyboardState) => void>();

function measure(): KeyboardState {
  const vv = window.visualViewport;
  if (!vv) return { open: false, inset: 0 };
  const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
  if (covered <= MIN_KEYBOARD_PX) return { open: false, inset: 0 };
  return { open: true, inset: covered };
}

function apply(next: KeyboardState): void {
  const changed = next.open !== state.open || next.inset !== state.inset;
  state = next;
  const root = document.documentElement;
  root.classList.toggle("kb-open", next.open);
  root.style.setProperty("--kb-inset", `${next.inset}px`);
  if (changed) {
    for (const fn of subscribers) fn(state);
  }
}

/** 当前键盘是否弹出（非 React 环境也可用，例如事件回调里做判断）。 */
export function isKeyboardOpen(): boolean {
  return state.open;
}

/**
 * 挂载全局监听到 `document`（在 App 根组件里调用一次），返回清理函数。
 * 幂等：React 18+ StrictMode 下会执行两次挂载/卸载，本实现无副作用残留。
 */
export function attachKeyboardWatcher(): () => void {
  if (typeof window === "undefined") return () => {};

  const vv = window.visualViewport;
  let timers: number[] = [];

  const sync = () => apply(measure());

  /** 立刻量一次，并在键盘动画期间补测几次。 */
  const syncAfterAnimation = () => {
    sync();
    for (const t of timers) window.clearTimeout(t);
    timers = REMEASURE_DELAYS.map((delay) => window.setTimeout(sync, delay));
  };

  const onFocusIn = () => syncAfterAnimation();
  const onFocusOut = () => syncAfterAnimation();

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  // iOS 视觉视口：键盘展开/收起 = resize；页面被顶上去 = scroll
  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);

  sync();

  return () => {
    for (const t of timers) window.clearTimeout(t);
    timers = [];
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("resize", sync);
    window.removeEventListener("orientationchange", sync);
    vv?.removeEventListener("resize", sync);
    vv?.removeEventListener("scroll", sync);
    apply({ open: false, inset: 0 });
  };
}

/**
 * 订阅键盘状态（需要 hook 版判断时用，例如"键盘弹出后把输入框滚进可视区"）。
 * 前提是 `attachKeyboardWatcher()` 已挂载（App 根组件会挂）。
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(state.open);
  useEffect(() => {
    setOpen(state.open);
    const fn = (next: KeyboardState) => setOpen(next.open);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return open;
}
