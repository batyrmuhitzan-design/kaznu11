/**
 * "这次触摸算不算一次确认点击" 的纯判定 —— 零依赖，可单元测试。
 *
 * 单独抽出来是为了让**行为**可验证（`scripts/verify-ui-polish.cjs` 会喂各种
 * 按下/抬起/滑动组合断言结果），而不是只能靠读代码确认。
 *
 * 为什么需要它：触感震动早期绑在 `pointerdown` 上，等于"手指一碰就震"，
 * 滚动列表时手指划过按钮会连环误震。原生 App 的
 * `UIImpactFeedbackGenerator` 是在按钮**动作回调**里调的 —— 也就是
 * 「按下之后又抬起、且期间没有滑动」才震，对应 RN 的 `onPress` 而不是 `onPressIn`。
 */

/** 一次"确认点击"允许的最大手指位移（px）；超过它就算滑动，不震。 */
export const TAP_MOVE_TOLERANCE = 10;

/** 一次"确认点击"允许的最长按压时长（ms）；超过它算长按，不震。 */
export const TAP_MAX_MS = 600;

/** 按下时的现场记录。 */
export interface TapPress {
  /** 按下时命中的可点击元素（不透明引用，只用于"是否同一个元素"的一致性判断）。 */
  hit: unknown;
  x: number;
  y: number;
  /** 时间戳（`performance.now()`）。 */
  at: number;
}

/** 抬起时的现场数据。 */
export interface TapRelease {
  hit: unknown;
  x: number;
  y: number;
  at: number;
}

/**
 * 判定一次触摸是否构成"确认点击"。
 *
 * 三个条件全部满足才算（任一不满足 → 不震动）：
 *  1. 抬起时命中的元素与按下时**是同一个**（滑动后松手 / 左滑删除不会误判）；
 *  2. 位移 ≤ `TAP_MOVE_TOLERANCE`（滑动不震）；
 *  3. 时长 ≤ `TAP_MAX_MS`（长按不震）。
 *
 * 另外"期间是否发生 pointercancel / scroll"由调用方在事件流里作废候选来实现
 * （那是"事件是否发生"，不是本次触摸的几何属性，故不放进纯函数）。
 */
export function isConfirmedTap(press: TapPress | null, release: TapRelease): boolean {
  if (!press) return false;
  if (press.hit !== release.hit) return false;
  if (Math.hypot(release.x - press.x, release.y - press.y) > TAP_MOVE_TOLERANCE) return false;
  if (release.at - press.at > TAP_MAX_MS) return false;
  return true;
}
