/**
 * 屏幕淡入/淡出动画（主题切换、语言切换、页面过渡共用）。
 * 用真实 DOM 蒙层实现（不依赖 View Transition / 伪元素），保证任何浏览器、iframe 都能播：
 *  - screenFade()：全屏蒙层从“旧背景色”淡出，揭开下面的新画面；
 *  - screenFadeOut()：全屏蒙层淡入变实（遮住当前画面），完成后回调（用于登出等）。
 */

const FADE_MS = 460;

let veil: HTMLDivElement | null = null;
let veilTimer = 0;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function defaultBg(): string {
  if (typeof document === "undefined") return "#000";
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)" ? bg : "#000";
}

/** 生成/清理全屏蒙层元素 */
function buildVeil(color: string, startOpacity: number) {
  if (typeof document === "undefined") return null;

  if (veil) veil.remove();
  window.clearTimeout(veilTimer);

  const div = document.createElement("div");
  div.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:100vw",
    "height:100vh",
    "z-index:2147483000",
    "pointer-events:none",
    `background:${color}`,
    `opacity:${startOpacity}`,
    `transition:opacity ${FADE_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
  ].join(";");
  document.body.appendChild(div);
  veil = div;
  return div;
}

/** 旧色蒙层由实到无 → 淡入揭示新画面 */
export function screenFade(color?: string) {
  if (prefersReducedMotion()) return;
  const div = buildVeil(color && color !== "transparent" ? color : defaultBg(), 0.98);
  if (!div) return;

  // 先等一帧让蒙层以实色画出来，再开始淡出
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      div.style.opacity = "0";
    });
  });
  veilTimer = window.setTimeout(() => {
    veil?.remove();
    veil = null;
  }, FADE_MS + 120);
}

/** 当前画面淡出成纯色 → 完成后回调（登出 / 离开页面用） */
export function screenFadeOut(color?: string, onDone?: () => void) {
  const div = buildVeil(color && color !== "transparent" ? color : defaultBg(), 0);
  if (prefersReducedMotion()) {
    veil?.remove();
    veil = null;
    onDone?.();
    return;
  }
  if (!div) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      div.style.opacity = "1";
    });
  });
  veilTimer = window.setTimeout(() => {
    onDone?.();
  }, FADE_MS + 60);
  window.setTimeout(() => {
    veil?.remove();
    veil = null;
  }, FADE_MS + 220);
}

export function fadeDuration() {
  return FADE_MS;
}

