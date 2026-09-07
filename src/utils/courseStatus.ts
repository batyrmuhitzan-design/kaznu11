/**
 * 课程状态计算（Schedule / Dashboard “Today / Бүгін” 共用）。
 *
 * 以系统当前时间对比每门课的 startTime / endTime（例如 09:00 → 09:50）：
 *  - upcoming     ：当前时间 < 开课时间 → 正常卡片，绝不能划线/打勾
 *  - in-progress  ：startTime ≤ 当前时间 ≤ endTime → 高亮卡片，显示 “In progress”
 *  - completed    ：当前时间 > endTime → 才允许变灰 / 打勾 / 划线
 */

export type CourseStatus = "upcoming" | "in-progress" | "completed";

/** HH:MM → 当天分钟数（09:00 → 540）。 */
export function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** 由“当天分钟制”计算课程状态（含边界：正好开始或正好下课都算 in-progress）。 */
export function courseStatusFromTime(
  currentMinutes: number,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
): CourseStatus {
  const current = Math.max(0, Math.round(currentMinutes));
  const start = toMinutes(startH, startM);
  const end = toMinutes(endH, endM);

  if (current < start) return "upcoming";
  if (current <= end) return "in-progress";
  return "completed";
}

/** 由真实/模拟的 Date 计算课程状态。 */
export function courseStatusFromDate(
  now: Date,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
): CourseStatus {
  return courseStatusFromTime(now.getHours() * 60 + now.getMinutes(), startH, startM, endH, endM);
}

export interface CourseTimeWindow {
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}

export function courseStatus(now: Date, course: CourseTimeWindow): CourseStatus {
  return courseStatusFromDate(now, course.startH, course.startM, course.endH, course.endM);
}

export const courseStatusCompleted = (status: CourseStatus) => status === "completed";
export const courseStatusLive = (status: CourseStatus) => status === "in-progress";
