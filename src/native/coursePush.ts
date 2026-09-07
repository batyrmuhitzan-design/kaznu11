/**
 * Course Radar → 真正的 iOS 本地推送管理。
 *
 * 每一门课按「每周固定时间」注册多条 UNCalendarNotificationTrigger 周重复通知
 * （通过 @capacitor/local-notifications，原生即 UNCalendarNotificationTrigger），
 * 每个课程用稳定 ID 段（10_000–19_999）并可随时按 Course ID 精确移除。
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications, Weekday, type LocalNotificationSchema } from "@capacitor/local-notifications";
import { requestNotificationPermission } from "./notifications";
import { tr } from "../utils/locale";

export interface CoursePushSpec {
  id: string;
  name: string;
  /** 例如 "Wed · 09:00–10:30"；无星期时默认周一至周五 */
  when: string;
  room?: string;
  /** 提前提醒分钟（默认 30） */
  leadMinutes?: number;
}

/** 本模块独占的通知 ID 区间 */
const PUSH_ID_BASE = 10_000;
const PUSH_ID_SPAN = 10_000;
const WEEKDAY_INDEX: Record<string, number> = {
  MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6,
};

type ParsedCourse = {
  days: number[]; // 0=周一 … 6=周日
  startH: number;
  startM: number;
  endH: number;
  endM: number;
};

function parseCourse(spec: CoursePushSpec): ParsedCourse {
  const text = spec.when.toUpperCase().replace(/[–—]/g, "-");
  const matches = [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => [Number(m[1]), Number(m[2])]);

  const days = Object.keys(WEEKDAY_INDEX).filter((key) => text.includes(key)).map((key) => WEEKDAY_INDEX[key]);
  const resolvedDays = days.length > 0 ? days : [0, 1, 2, 3, 4]; // 未标星期 → 工作日

  const start = matches[0] ?? [9, 0];
  const end = matches[1] ?? [start[0] + 1, 30];
  return {
    days: resolvedDays,
    startH: start[0],
    startM: start[1],
    endH: end[0],
    endM: end[1],
  };
}

function hashId(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  return hash % (PUSH_ID_SPAN - 8);
}

/** 某门课在指定星期（0-6）对应的通知 ID（确定性） */
function notificationIdFor(spec: CoursePushSpec, weekday: number): number {
  return PUSH_ID_BASE + hashId(spec.id) + weekday;
}

function weekdayEnum(index: number): Weekday {
  // index: 0=周一 … 6=周日 → 插件 Weekday（Sunday=1 … Saturday=7）
  return (((index + 1) % 7) + 1) as Weekday;
}

function fireMinutes(parsed: ParsedCourse, leadMinutes: number): { hour: number; minute: number } | null {
  const fire = parsed.startH * 60 + parsed.startM - leadMinutes;
  if (fire < 0) return null;
  return { hour: Math.floor(fire / 60), minute: fire % 60 };
}

/**
 * 开启一门课的铃铛：为它每周的每个上课日注册「提前 leadMinutes 分钟」通知。
 * 返回是否成功（含权限已授予）。
 */
export async function enableCoursePush(spec: CoursePushSpec): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const granted = await requestNotificationPermission();
  if (!granted) return false;

  const parsed = parseCourse(spec);
  const lead = spec.leadMinutes ?? 30;
  const scheduled: Array<{ id: number; weekday: number; at: { hour: number; minute: number } }> = [];
  for (const day of parsed.days) {
    const at = fireMinutes(parsed, lead);
    if (!at) continue;
    scheduled.push({ id: notificationIdFor(spec, day), weekday: day, at });
  }
  if (scheduled.length === 0) return true;

  const notifications: LocalNotificationSchema[] = scheduled.map((item) => ({
    id: item.id,
    title: tr("🔔 Reminder: {name}", "🔔 Еске салу: {name}", "🔔 Напоминание: {name}").split("{name}").join(spec.name),
    body: tr(
      "Starts in {m} min · {room}",
      "{m} мин қалды · {room}",
      "Через {m} мин · {room}",
    )
      .split("{m}").join(String(lead))
      .split("{room}").join(spec.room ?? "—"),
    schedule: { on: { weekday: weekdayEnum(item.weekday), hour: item.at.hour, minute: item.at.minute } },
    threadIdentifier: `kaznu.course.${spec.id}`,
    extra: { courseId: spec.id },
    // 系统经典 Tri-tone 通知声
    sound: "system-default",
    // iOS 16+ 时效性提醒
    interruptionLevel: "timeSensitive",
  }));

  try {
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch {
    return false;
  }
}

/** 关闭铃铛：按 Course ID 移除它注册过的全部通知 */
export async function disableCoursePush(spec: CoursePushSpec): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const parsed = parseCourse(spec);
  const ids = parsed.days.map((day) => notificationIdFor(spec, day));
  try {
    const pending = await LocalNotifications.getPending();
    const managed = ((pending.notifications as Array<{ id?: number }>) ?? [])
      .filter((n) => (n.id ?? 0) >= PUSH_ID_BASE && (n.id ?? 0) < PUSH_ID_BASE + PUSH_ID_SPAN)
      .map((n) => n.id ?? 0);
    const toRemove = ids.filter((id) => managed.includes(id));
    if (toRemove.length > 0) await LocalNotifications.cancel({ notifications: toRemove.map((id) => ({ id })) as never[] });
  } catch {
    /* ignore */
  }
}

/** 读取系统当前 Pending 中本模块管理的课程 ID（App 启动/切回时同步界面） */
export async function listManagedCourseIds(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const pending = await LocalNotifications.getPending();
    const list = (pending.notifications as Array<{ id?: number; extra?: { courseId?: string } }>) ?? [];
    const ids = new Set<string>();
    for (const item of list) {
      if ((item.id ?? 0) >= PUSH_ID_BASE && (item.id ?? 0) < PUSH_ID_BASE + PUSH_ID_SPAN) {
        if (item.extra?.courseId) ids.add(item.extra.courseId);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

/** 查询这门课当前系统里已注册的通知 ID 数量（用于调试/校验） */
export async function countCoursePush(spec: CoursePushSpec): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  const ids = parseCourse(spec).days.map((day) => notificationIdFor(spec, day));
  try {
    const pending = await LocalNotifications.getPending();
    return ((pending.notifications as Array<{ id?: number }>) ?? []).filter((n) => ids.includes(n.id ?? 0)).length;
  } catch {
    return 0;
  }
}
