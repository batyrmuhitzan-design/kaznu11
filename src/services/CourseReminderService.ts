/**
 * 上课前提醒 + Live Activity 桥接服务（课程提醒 / 灵动岛倒计时）。
 *
 * 机制：
 *  1) 提前 1 小时：排一条系统本地通知（LocalNotifications）
 *     “⏰ 1小时后有课：《课程名》 | [教室]” —— App 被划掉也由 iOS 精准触发；
 *  2) 提前 30 分钟：watch 到进入窗口后调用 Native Bridge 启动 Live Activity，
 *     让灵动岛 / 锁屏出现 30 分钟倒计时圆圈（绿→橙→红）；
 *  3) 倒计时归零（T-0）：排一条“🔔 上课提醒”系统通知，并结束 Live Activity。
 *
 * ⚠️ 说明：被用户完全杀死后，iOS 只能保证【系统本地通知】准时触发；
 * “启动 Live Activity”需要 App 进程，因此服务会在 App 每次处于前台/被重新打开时
 * 自动补启动（只要还在 [-30min, 上课) 窗口内）。若需“杀死后仍自动启动灵动岛”，
 * 需接远程推送的 push-to-start Live Activity（付费账号 + 服务器推送），不属本文件范围。
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type LocalNotificationSchema } from "@capacitor/local-notifications";
import { requestNotificationPermission } from "../native/notifications";
import { todayWeekdayIndex } from "../utils/calendar";
import {
  buildLiveActivityPayload,
  syncLiveActivity,
  initialsOfCourse,
  type LiveActivityControl,
} from "../native/liveActivity";
import { tr, trf } from "../utils/locale";

export interface CourseReminderLesson {
  /** 课程唯一 key（如 la / c1） */
  id: string;
  name: string;
  /** 灵动岛紧凑区缩写；不传则由服务自动推导 */
  short?: string;
  type?: string;
  room?: string;
  building?: string;
  prof?: string;
  /** 0=周一 … 6=周日（与 /api/schedule key 对齐） */
  weekday: number;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}

/** 本服务专属的通知 ID 区间（避开每周排课 <10_000 与其它实时横幅段） */
const REMINDER_ID_BASE = 30_000;
const REMINDER_ID_SPAN = 10_000;

/** Live Activity 持久化 key：记录当前已经启动的倒计时，避免重复启动/漏结束 */
const LA_STORAGE_KEY = "kaznu:liveActivity";

const NAVIGATION_URL = "kaznuhelper://schedule";
function navigationPayload(): { label: string; url: string } {
  return { label: tr("Open Schedule", "Кестені ашу", "Открыть расписание"), url: NAVIGATION_URL };
}

/** 上课提醒通知 Category（Interactive Notifications）。 */
const CLASS_REMINDER_CATEGORY = "KZNU_CLASS_REMINDER";
/** Category 上的按钮动作：开启灵动岛 / Start Live Activity。 */
export const CLASS_REMINDER_ACTION_ID = "start_live_activity";

declare global {
  interface Window {
    /** Native 注入：把扁平课表同步给 BGTaskScheduler（App 被杀后也能计算下一节课）。 */
    __KAZNU_BG_REMINDER_SYNC__?: (payload: { lessons: CourseReminderLesson[] }) => void;
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/* ===================== 通知偏好（关键提醒 vs 新闻资讯） ===================== */

const COURSE_ALERTS_KEY = "courseAlertsEnabled";

/** 上课/成绩等关键提醒默认开启（只有用户显式关闭才停）。 */
export function areCourseAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(COURSE_ALERTS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** 设置页切换“关键提醒”时调用。 */
export function setCourseAlertsPreference(enabled: boolean): void {
  try {
    localStorage.setItem(COURSE_ALERTS_KEY, enabled ? "on" : "off");
  } catch {
    /* ignore */
  }
}

/**
 * 设置页应用偏好：
 *  - 开启 → 用已同步的课表重建 T-60/T-0 通知并补查 Live Activity；
 *  - 关闭 → 立即清掉已排的上课通知并收起灵动岛。
 */
export async function applyCourseAlertsPreference(enabled: boolean): Promise<void> {
  setCourseAlertsPreference(enabled);
  if (enabled) {
    if (registeredLessons.length > 0) {
      await scheduleUpcomingClassReminders(registeredLessons);
      syncTimetableLiveActivity(registeredLessons, new Date());
    }
    return;
  }
  await clearScheduledClassReminders();
  endCourseLiveActivity();
}

/* ===================== 基础工具 ===================== */

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  return hash;
}

function toHHMM(h: number, m: number): string {
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** 本周（以 ref 所在周计）weekday 对应的 hh:mm 日期。 */
function occurrenceDate(weekday: number, h: number, m: number, ref: Date): Date {
  const dayDiff = (weekday - todayWeekdayIndex(ref) + 7) % 7;
  const date = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  date.setDate(date.getDate() + dayDiff);
  date.setHours(h, m, 0, 0);
  return date;
}

/** weekday 下一次未来出现（含今天未来时间；今天已过则顺延下周）。 */
function nextOccurrence(weekday: number, h: number, m: number, ref: Date): Date {
  const date = occurrenceDate(weekday, h, m, ref);
  if (date.getTime() <= ref.getTime()) date.setDate(date.getDate() + 7);
  return date;
}

/* ===================== 系统本地通知（T-60 / T-0） ===================== */

export async function clearScheduledClassReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const list = (pending.notifications as Array<{ id?: number }>) ?? [];
    const ids = list
      .filter((n) => (n.id ?? 0) >= REMINDER_ID_BASE && (n.id ?? 0) < REMINDER_ID_BASE + REMINDER_ID_SPAN)
      .map((n) => n.id ?? 0);
    if (ids.length > 0) {
      await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) as never[] });
    }
  } catch {
    /* ignore */
  }
}

/**
 * 扫描课程表，为最近一次未来出现的每一节课排两条系统通知：
 *  - T-60：⏰ 1小时后有课
 *  - T-0 ：🔔 上课提醒（开课瞬间）
 * 幂等：每次调用先清掉上一批同区间 ID，再重建。
 */
export async function scheduleUpcomingClassReminders(
  lessons: CourseReminderLesson[],
  now: Date = new Date(),
): Promise<void> {
  if (!Capacitor.isNativePlatform() || lessons.length === 0) return;
  if (!areCourseAlertsEnabled()) return; // 用户在设置里关掉了“关键提醒”

  await ensureClassReminderActionsRegistered();
  await clearScheduledClassReminders();
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const notifications: LocalNotificationSchema[] = [];
  for (const lesson of lessons) {
    const startAt = nextOccurrence(lesson.weekday, lesson.startH, lesson.startM, now);
    const candidates: Array<{ marker: "t60" | "t0"; at: Date; title: string; body: string }> = [
      {
        marker: "t60",
        at: new Date(startAt.getTime() - HOUR_MS),
        title: trf(
          {
            en: "⏰ Class in 1 hour: {name}",
            kz: "⏰ 1 сағаттан кейін сабақ: {name}",
            ru: "⏰ Через 1 час занятие: {name}",
          },
          { name: lesson.name },
        ),
        body: trf(
          {
            en: "{room} · reminder 1 hour before",
            kz: "{room} · сабаққа 1 сағат қалды",
            ru: "{room} · напоминание за 1 час",
          },
          { room: lesson.room ?? "—" },
        ),
      },
      {
        marker: "t0",
        at: startAt,
        title: trf(
          {
            en: "🔔 Class starting: {name}",
            kz: "🔔 Сабақ басталады: {name}",
            ru: "🔔 Занятие начинается: {name}",
          },
          { name: lesson.name },
        ),
        body: trf(
          {
            en: "{room} · now",
            kz: "{room} · қазір",
            ru: "{room} · сейчас",
          },
          { room: lesson.room ?? "—" },
        ),
      },
    ];
    for (const c of candidates) {
      if (c.at.getTime() <= now.getTime()) continue; // 该提醒已过期（今天已开课）
      notifications.push({
        id: REMINDER_ID_BASE + (hashSeed(`${lesson.id}:${startAt.getTime()}:${c.marker}`) % REMINDER_ID_SPAN),
        title: c.title,
        body: c.body,
        threadIdentifier: "kaznu.class.upcoming",
        // iOS 16+：时效性通知（即使开着勿扰/专注模式也能穿透送达）
        interruptionLevel: "timeSensitive",
        // 交互式通知：按钮“开启灵动岛 / Start Live Activity”
        actionTypeId: CLASS_REMINDER_CATEGORY,
        // 用户点通知/按钮时，用 courseId 找回课程并立即启动 Live Activity
        extra: { kind: "class-upcoming", marker: c.marker, courseId: lesson.id },
        foreground: true,
        schedule: { at: c.at },
      });
    }
  }

  if (notifications.length === 0) return;
  try {
    await LocalNotifications.schedule({ notifications });
  } catch {
    /* ignore */
  }
}

/* ===================== Live Activity 桥接（T-30 启动 / T-0 结束） ===================== */

interface ActiveLiveActivity {
  key: string;
  courseId: string;
  courseName: string;
  /** 上课时刻（倒计时终点） */
  launchAtISO: string;
}

interface TimedLesson {
  lesson: CourseReminderLesson;
  /** 提前 30 分钟（倒计时起点） */
  preWindowStart: Date;
  /** 上课时刻（倒计时终点） */
  launchAt: Date;
}

function readActive(): ActiveLiveActivity | null {
  try {
    const raw = localStorage.getItem(LA_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActiveLiveActivity) : null;
  } catch {
    return null;
  }
}

function writeActive(active: ActiveLiveActivity | null) {
  try {
    if (active) localStorage.setItem(LA_STORAGE_KEY, JSON.stringify(active));
    else localStorage.removeItem(LA_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 只关心“今天”的课程，返回 [上课前 windowMinutes, 上课) 时间窗。 */
function buildTimedLesson(lesson: CourseReminderLesson, now: Date, windowMinutes = 30): TimedLesson | null {
  if (lesson.weekday !== todayWeekdayIndex(now)) return null;
  const launchAt = occurrenceDate(lesson.weekday, lesson.startH, lesson.startM, now);
  return {
    lesson,
    preWindowStart: new Date(launchAt.getTime() - windowMinutes * MINUTE_MS),
    launchAt,
  };
}

function laKey(lesson: CourseReminderLesson, launchAt: Date): string {
  return `${lesson.id}:${launchAt.toISOString()}`;
}

function dispatchCourseControl(
  timed: TimedLesson,
  now: Date,
  control: LiveActivityControl,
  remainingHint?: number,
) {
  const { lesson, preWindowStart, launchAt } = timed;
  const totalSeconds = Math.max(1, Math.round((launchAt.getTime() - preWindowStart.getTime()) / 1000));
  const remainingSeconds =
    remainingHint ?? Math.max(0, Math.round((launchAt.getTime() - now.getTime()) / 1000));
  const minutesLeft = Math.max(0, Math.ceil(remainingSeconds / 60));

  const payload = buildLiveActivityPayload({
    control,
    name: lesson.name,
    type: lesson.type ?? "lecture",
    professor: lesson.prof ?? "",
    room: lesson.room ?? "",
    building: lesson.building ?? "",
    courseShort: lesson.short ?? initialsOfCourse(lesson.name),
    startH: lesson.startH,
    startM: lesson.startM,
    endH: lesson.endH,
    endM: lesson.endM,
    remaining: remainingSeconds,
    total: totalSeconds,
    kind: "pre-class",
    statusLabel: minutesLeft > 0 ? `Starts in ${minutesLeft} min` : "Now",
    navigation: navigationPayload(),
  });
  syncLiveActivity(payload);
}

/** 立即为指定课程启动 Live Activity（仅当其正处于 [上课前 windowMinutes, 上课) 窗口）。 */
export function startCourseLiveActivity(
  lesson: CourseReminderLesson,
  now: Date = new Date(),
  windowMinutes = 30,
): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const timed = buildTimedLesson(lesson, now, windowMinutes);
  if (!timed || now < timed.preWindowStart || now >= timed.launchAt) return false;

  const active = readActive();
  // 已有其它活动的倒计时 → 先收起再开新的，避免同屏多个 Live Activity
  if (active && active.key !== laKey(lesson, timed.launchAt)) endCourseLiveActivity();

  dispatchCourseControl(timed, now, "start");
  writeActive({
    key: laKey(lesson, timed.launchAt),
    courseId: lesson.id,
    courseName: lesson.name,
    launchAtISO: timed.launchAt.toISOString(),
  });
  return true;
}

/** 结束当前 Live Activity（倒计时归零 / 课程开始后 App 重新打开时兜底）。 */
export function endCourseLiveActivity(): void {
  if (!Capacitor.isNativePlatform()) return;
  syncLiveActivity({
    control: "end",
    course: { name: "", type: "lecture", professor: "", room: "", building: "" },
    timeWindow: { start: "00:00", end: "00:00" },
    countdownSeconds: 0,
    totalSeconds: 1,
    phase: "red",
    kind: "none",
    statusLabel: "",
    shouldShowLiveActivity: false,
  });
  writeActive(null);
}

/**
 * 课程当天时间窗：[startTime, endTime)，若 weekday 不是今天返回 null。
 */
function classWindowFor(lesson: CourseReminderLesson, now: Date): { startAt: Date; endAt: Date } | null {
  if (lesson.weekday !== todayWeekdayIndex(now)) return null;
  const startAt = occurrenceDate(lesson.weekday, lesson.startH, lesson.startM, now);
  const endAt = occurrenceDate(lesson.weekday, lesson.endH, lesson.endM, now);
  if (endAt.getTime() <= startAt.getTime()) return null;
  return { startAt, endAt };
}

/** 课程已在上课时（[开始, 结束)）→ 启动“课中到下课”的 Live Activity。 */
export function startCourseLiveActivityInClass(lesson: CourseReminderLesson, now: Date = new Date()): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const window = classWindowFor(lesson, now);
  if (!window || now < window.startAt || now >= window.endAt) return false;

  const active = readActive();
  if (active && active.key !== `${lesson.id}:${window.endAt.toISOString()}`) endCourseLiveActivity();

  const totalSeconds = (window.endAt.getTime() - window.startAt.getTime()) / 1000;
  const remainingSeconds = Math.max(0, (window.endAt.getTime() - now.getTime()) / 1000);
  const minutesLeft = Math.max(0, Math.ceil(remainingSeconds / 60));

  const payload = buildLiveActivityPayload({
    control: "start",
    name: lesson.name,
    type: lesson.type ?? "lecture",
    professor: lesson.prof ?? "",
    room: lesson.room ?? "",
    building: lesson.building ?? "",
    courseShort: lesson.short ?? initialsOfCourse(lesson.name),
    startH: lesson.startH,
    startM: lesson.startM,
    endH: lesson.endH,
    endM: lesson.endM,
    remaining: remainingSeconds,
    total: totalSeconds,
    kind: "in-class",
    statusLabel: minutesLeft > 0 ? `Ends in ${minutesLeft} min` : "Class ending",
    navigation: navigationPayload(),
  });
  syncLiveActivity(payload);
  writeActive({
    key: `${lesson.id}:${window.endAt.toISOString()}`,
    courseId: lesson.id,
    courseName: lesson.name,
    launchAtISO: window.endAt.toISOString(),
  });
  return true;
}

/**
 * 课表状态看护：在服务每次被唤醒（挂载/每分钟 tick/回到前台）时调用。
 *  - 课前 [-30min, 上课) → 启动/刷新“倒计时到上课”的灵动岛；
 *  - 上课中 [上课, 下课) → 维持/补启动“倒计时到下课”的灵动岛；
 *  - 跨过终点（下课 / 上课点）→ 自动结束并交给系统本地通知。
 */
export function syncTimetableLiveActivity(lessons: CourseReminderLesson[], now: Date = new Date()): void {
  if (!Capacitor.isNativePlatform() || lessons.length === 0) return;
  if (!areCourseAlertsEnabled()) return; // 关键提醒被关闭时不启动 / 不刷新灵动岛

  const timedNow = lessons
    .map((lesson) => buildTimedLesson(lesson, now))
    .find((timed) => timed !== null && now >= timed.preWindowStart && now < timed.launchAt);

  if (timedNow) {
    const active = readActive();
    const key = laKey(timedNow.lesson, timedNow.launchAt);
    if (!active || active.key !== key) {
      startCourseLiveActivity(timedNow.lesson, now);
      return;
    }
    // 已启动 → 每分钟把最新剩余秒数推给原生（前台场景让圆环更顺滑）
    dispatchCourseControl(timedNow, now, "update");
    return;
  }

  // —— 不在课前 30 分钟窗口 ——
  // 如果正在上课：补启动“倒计时到下课”的灵动岛
  const inClass = lessons
    .map((lesson) => ({ lesson, window: classWindowFor(lesson, now) }))
    .find((item) => item.window !== null && now >= item.window.startAt && now < item.window.endAt);

  const active = readActive();
  if (active) {
    const endAt = new Date(active.launchAtISO);
    const isExpired = !Number.isNaN(endAt.getTime()) && now >= endAt;
    if (!isExpired) return; // 还有未结束的课前倒计时，不做任何事
    endCourseLiveActivity();
  }
  if (inClass) {
    startCourseLiveActivityInClass(inClass.lesson, now);
  }
}

/* ===================== 全局看护（跨页面 / 回到前台） ===================== */

/** 最近一次从课表同步进来的课程（供 App 级 watcher 使用）。 */
let registeredLessons: CourseReminderLesson[] = [];

/** Schedule 拉到课表后把扁平课程注册到模块级缓存（并同步给 Native BGTask）。 */
export function registerReminderLessons(lessons: CourseReminderLesson[]): void {
  registeredLessons = lessons;
  if (Capacitor.isNativePlatform()) {
    try {
      window.__KAZNU_BG_REMINDER_SYNC__?.({ lessons });
    } catch {
      /* 原生桥尚未注入时静默，下一次注册会再同步 */
    }
  }
}

/**
 * 在 App 入口挂载一次：每 60s + 回到前台时检查 Live Activity。
 * 即使当前停在首页而非 Schedule 页，只要课表已同步过，也能在
 * [-30min, 上课) 窗口内补启动灵动岛倒计时。返回清理函数。
 */
export function attachGlobalLiveActivityWatcher(): () => void {
  const tick = () => {
    if (registeredLessons.length === 0) return;
    syncTimetableLiveActivity(registeredLessons, new Date());
  };
  tick();
  const interval = window.setInterval(tick, 60_000);
  const onVisibility = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/* ===================== 交互式上课提醒通知（T-60） ===================== */

let actionsRegistered = false;

/** 注册 iOS UNNotificationCategory：按钮“开启灵动岛 / Start Live Activity”。 */
async function ensureClassReminderActionsRegistered(): Promise<void> {
  if (!Capacitor.isNativePlatform() || actionsRegistered) return;
  actionsRegistered = true;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: CLASS_REMINDER_CATEGORY,
          actions: [
            {
              id: CLASS_REMINDER_ACTION_ID,
              title: tr("Start Live Activity", "Live Activity қосу", "Запустить Live Activity"),
              // iOS：按下按钮就回到 App 前台处理，从而立刻调用原生启动
              foreground: true,
            },
          ],
          iosHiddenPreviewsShowTitle: true,
          iosHiddenPreviewsShowSubtitle: true,
        },
      ],
    });
  } catch {
    actionsRegistered = false; // 网络/权限问题允许重试
  }
}

let actionListenerAttached = false;

/**
 * 监听用户点击上课提醒通知 / 按下“开启灵动岛”按钮：
 * 用通知 extra.courseId 找回课程，立即以 60 分钟窗口启动 Live Activity。
 * App 生命周期内只需 enable 一次（App 入口调用）。
 */
export function enableClassReminderNotificationActions(): void {
  if (!Capacitor.isNativePlatform() || actionListenerAttached) return;
  actionListenerAttached = true;

  void LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const detail = action as unknown as {
      actionId?: string;
      notification?: { extra?: { courseId?: string; marker?: string } };
    };
    const courseId = detail.notification?.extra?.courseId;
    if (!courseId) return;
    const lesson = registeredLessons.find((item) => item.id === courseId);
    if (!lesson) return;
    // 通知里标记了 extra 才能回查；点击“上课提醒”或按钮都会走到这里
    const now = new Date();
    startCourseLiveActivity(lesson, now, 60);
  });
}

