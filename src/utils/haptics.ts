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

/**
 * 全局点击事件委托：按元素语义自动选择强度，绑定一次即可覆盖全 App。
 * 返回清理函数（供 useEffect 使用）。
 * 判断优先级：data-haptic 显式标记 > 元素语义/class。
 */
export function attachHapticDelegate(): () => void {
  const handler = (e: PointerEvent) => {
    if (!(e.target instanceof Element)) return;
    const hit = e.target.closest<HTMLElement>(
      '[data-haptic], button, [role="switch"], input[type="checkbox"], input[type="radio"]',
    );
    if (!hit) return;

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
      hit.closest(".seg, [role='radiogroup']") !== null;

    // 重反馈类：下载 / 导出 / 主提交
    const heavy =
      inputType === "submit" ||
      hit.classList.contains("login-cta") ||
      hit.closest("[data-action='download'], [data-action='export']") !== null;

    if (heavy) void hapticHeavy();
    else if (light) void hapticTap();
    else void hapticImpact();
  };

  document.addEventListener("pointerdown", handler, { passive: true });
  return () => document.removeEventListener("pointerdown", handler);
}
