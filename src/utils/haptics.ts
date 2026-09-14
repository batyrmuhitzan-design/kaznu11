/**
 * 全局触感震动反馈（Taptic Engine / Haptics）。
 *
 * - 原生(iOS/Android)：走 @capacitor/haptics（iOS = UIImpactFeedbackGenerator /
 *   UINotificationFeedbackGenerator 的 Taptic Engine）；
 * - Web 预览：无原生马达 → 静默跳过，不影响交互。
 *
 * 强度约定：
 *  - hapticTap()     = Light   —— 轻触 / Tab 切换 / 开关 / 分段控件 / 返回键
 *  - hapticImpact()  = Medium  —— 核心点击 / 卡片 / Quick Access / 提交按钮
 *  - hapticHeavy()   = Heavy   —— 下载 / 导出等“重”动作
 *  - hapticSuccess() = Success —— 完成 / 保存成功（下载完、导出完）
 *  - hapticError()   = Error   —— 操作失败（登录失败等）
 */
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isConfirmedTap, type TapPress } from "./tapGesture";

export { TAP_MAX_MS, TAP_MOVE_TOLERANCE, isConfirmedTap } from "./tapGesture";

const isNative = () => Capacitor.isNativePlatform();

async function safe(fn: () => Promise<void>) {
  if (!isNative()) return;
  try {
    await fn();
  } catch {
    /* 忽略（模拟器/权限限制时安静失败） */
  }
}

export async function hapticTap() {
  await safe(() => Haptics.impact({ style: ImpactStyle.Light }));
}

export async function hapticImpact() {
  await safe(() => Haptics.impact({ style: ImpactStyle.Medium }));
}

export async function hapticHeavy() {
  await safe(() => Haptics.impact({ style: ImpactStyle.Heavy }));
}

export async function hapticSuccess() {
  await safe(() => Haptics.notification({ type: NotificationType.Success }));
}

export async function hapticWarning() {
  await safe(() => Haptics.notification({ type: NotificationType.Warning }));
}

export async function hapticError() {
  await safe(() => Haptics.notification({ type: NotificationType.Error }));
}

// ---------- 兼容旧调用点（避免全量重写历史代码） ----------

export function triggerHaptic(_pattern?: number | number[]) {
  void hapticImpact();
}

export function motorHaptic() {
  void hapticImpact();
}

export function errorHaptic() {
  void hapticError();
}

/** 命中的可点击元素（与绑定阶段用的选择器保持一致）。 */
const HIT_SELECTOR =
  '[data-haptic], button, [role="switch"], input[type="checkbox"], input[type="radio"]';

function resolveHit(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(HIT_SELECTOR);
}

/** 按元素语义选择强度（data-haptic 显式标记 > 元素语义/class）。 */
function fireHaptic(hit: HTMLElement): void {
  const inputType = hit.getAttribute("type")?.toLowerCase();
  const forced = hit.getAttribute("data-haptic");
  if (forced) {
    if (forced === "light") void hapticTap();
    else if (forced === "heavy") void hapticHeavy();
    else void hapticImpact();
    return;
  }

  // 轻触类：Tab / 图标按钮 / 开关 / 分段控件 / 通知行 / 返回
  const light =
    hit.closest(".tab-bar") !== null ||
    hit.classList.contains("icon-button") ||
    hit.classList.contains("theme-row") ||
    hit.classList.contains("notification-row") ||
    hit.getAttribute("role") === "switch" ||
    inputType === "checkbox" ||
    inputType === "radio" ||
    hit.closest(".seg, .seg-compact, [role='radiogroup']") !== null;

  // 重反馈类：下载 / 导出 / 主提交
  const heavy =
    inputType === "submit" ||
    hit.classList.contains("login-cta") ||
    hit.closest("[data-action='download'], [data-action='export']") !== null;

  if (heavy) void hapticHeavy();
  else if (light) void hapticTap();
  else void hapticImpact();
}

/**
 * 全局点击事件委托：按元素语义自动选择强度，绑定一次即可覆盖全 App。
 * 返回清理函数（供 useEffect 使用）。
 *
 * ⚠️ **触发时机是这里最容易踩的坑**：早期版本直接监听 `pointerdown`，
 *    等于「手指刚碰到就震」—— 滚动列表时手指划过按钮会连环误震。原生 App 不会这样：
 *    `UIImpactFeedbackGenerator` 是在**按钮动作回调**里调的，也就是"抬起且确认是点击"之后。
 *
 * 现在的语义等价于 RN 的 `onPress`（press-in + 抬起 + 没滑动），而不是 `onPressIn`：
 *
 *     pointerdown  → 记录候选（目标元素、坐标、时间）
 *     pointerup    → 四个条件都满足才震：
 *                      ① 抬起时命中的元素与按下时**同一个**
 *                         （左滑删/滑动后松手不会误判成点击）
 *                      ② 位移 ≤ TAP_MOVE_TOLERANCE
 *                      ③ 时长 ≤ TAP_MAX_MS
 *                      ④ 期间没有发生 pointercancel / scroll
 *     pointercancel / scroll / window.blur → 立刻作废候选（滑动期间绝不震动）
 *
 * 注：`SwipeBack` 这类"手势完成"的震动仍由它自己发（那是确认过的动作，不是误触）。
 */
export function attachHapticDelegate(): () => void {
  // 候选按下记录。hit 保留具体类型 HTMLElement（fireHaptic 需要），
  // "算不算点击"的判定整体交给纯函数 isConfirmedTap（只关心几何与元素同一性）。
  let candidate: (TapPress & { hit: HTMLElement }) | null = null;

  const discard = () => {
    candidate = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    candidate = null;
    // 鼠标只认主键；触屏/触控笔没有 button 概念（恒为 0）
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const hit = resolveHit(e.target);
    if (!hit) return;
    if (hit.hasAttribute("disabled") || hit.getAttribute("aria-disabled") === "true") return;
    candidate = { hit, x: e.clientX, y: e.clientY, at: performance.now() };
  };

  const onPointerUp = (e: PointerEvent) => {
    const pending = candidate;
    candidate = null;
    if (!pending) return;
    const hit = resolveHit(e.target);
    if (!isConfirmedTap(pending, { hit, x: e.clientX, y: e.clientY, at: performance.now() })) return;
    fireHaptic(pending.hit);
  };

  // 用 capture 才能收到内部滚动容器的 scroll（scroll 不冒泡，但能捕获）
  const options: AddEventListenerOptions = { passive: true, capture: true };
  document.addEventListener("pointerdown", onPointerDown, options);
  document.addEventListener("pointerup", onPointerUp, options);
  document.addEventListener("pointercancel", discard, options);
  document.addEventListener("scroll", discard, options);
  window.addEventListener("blur", discard);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, options);
    document.removeEventListener("pointerup", onPointerUp, options);
    document.removeEventListener("pointercancel", discard, options);
    document.removeEventListener("scroll", discard, options);
    window.removeEventListener("blur", discard);
  };
}
