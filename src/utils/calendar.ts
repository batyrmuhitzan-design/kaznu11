/**
 * 校历 / 时间工具：周次(Week 1–18)、星期几(0=周一 … 6=周日)、
 * “今天”的日期序列与学期标签。
 * 之后若接上真实校历后端，只需改 FALL_2026_START 或换成 fetch 的数据源。
 */

/** Fall 2026 开学日（周一）。以真实校历为准时可在此调整。 */
export const SEMESTER_START = new Date(2026, 8, 1); // 2026-09-01
export const SEMESTER_WEEKS = 18;
export const ACADEMIC_YEAR = 2026;

/** 0=周一 … 6=周日（Calendar.getDay() 是 0=周日）。 */
export function todayWeekdayIndex(date: Date = new Date()): number {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

/** 从开学日算起的教学周（1–18，越界时夹紧；寒暑假归入最近的边界）。 */
export function academicWeekOf(date: Date = new Date(), start: Date = SEMESTER_START): number {
  const startOfDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const now = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((now.getTime() - startOfDay.getTime()) / 86_400_000);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(SEMESTER_WEEKS, Math.max(1, week));
}

/** 给“本周起始日（周一）”返回 7 个日期数字，供课表星期条展示。 */
export function datesOfThisWeek(reference: Date = new Date()): number[] {
  const monday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  monday.setDate(monday.getDate() - todayWeekdayIndex(reference));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.getDate();
  });
}

export function fallSemesterLabel(week: number, year: number = ACADEMIC_YEAR): string {
  return `Week ${week} · Fall ${year}`;
}

/** 把当前时间拆成 HH:MM（分钟制），供“现在线/当前时间段”定位。 */
export function nowMinutes(date: Date = new Date()): { h: number; m: number } {
  return { h: date.getHours(), m: date.getMinutes() };
}
