/**
 * 系统本地通知（@capacitor/local-notifications）。
 *
 * 覆盖两类 iOS 原生系统通知：
 *  1) 每周循环的「课前提醒」——由 Schedule / Course Radar 同步，提前 N 分钟触发；
 *  2) 实时「新闻更新 / 课前即时提醒」——调用后 1.5s 弹出真实 iOS 系统 Top Banner，
 *     前台横幅、后台横幅、锁屏与通知中心全部走系统原生渲染。
 *
 * 课表数据形状与后端 /api/schedule 一致：
 *   { weekday: "0".."6", lessons: [{ name, room, prof, type, startH, startM, endH, endM }] }
 * 约定：key 0=周一 … 6=周日；本地通知插件 Weekday 枚举是 Sunday=1。
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications, Weekday, type LocalNotificationSchema } from "@capacitor/local-notifications";

export interface ClassLessonInput {
  /** 0=周一 … 6=周日（与后端 /api/schedule 的 key 一致） */
  weekday: number;
  name: string;
  room?: string;
  startH: number;
  startM: number;
}

const native = () => Capacitor.isNativePlatform();

/** 申请通知权限（启动时可提前请求，便于以后静默排课提醒）。 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!native()) return false;
  try {
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === "granted";
  } catch {
    return false;
  }
}

/* ===================== 实时 iOS 系统横幅（立即 Banner） ===================== */

/** 立即通知的触发延迟：iOS 要求 schedule.at 必须晚于当前时刻。 */
const BANNER_DELAY_MS = 1500;

/** 立即横幅 ID 段：避开每周循环排课使用的 <10_000 区间，重复取消/重建互不影响。 */
const NEWS_BANNER_ID_BASE = 60_000;
const CLASS_BANNER_ID_BASE = 70_000;

/** 由业务种子生成稳定 id（同一课程+同一时刻重复进入只替换同一条，不叠加）。 */
function stableBannerId(seed: string, base: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return base + (hash % 9_900);
}

export interface SystemBannerOptions {
  id: number;
  /** 通知线程 ID：iOS 通知中心会按该 key 归类展示。 */
  threadId: string;
  title: string;
  body: string;
}

/**
 * 立刻发送一条真实 iOS 系统通知（Top Banner）。
 * - 原生 App：LocalNotifications.schedule(at ≈ now+1.5s) + foreground:true
 *   → 前台也强制弹出横幅；后台/锁屏由系统按用户设置展示。
 * - 纯 Web 预览：直接返回 false，由调用方决定是否退化为 Web/In-App 提示。
 */
export async function postSystemBannerNow(opts: SystemBannerOptions): Promise<boolean> {
  if (!native()) return false;
  const granted = await requestNotificationPermission();
  if (!granted) return false;
  const banner: LocalNotificationSchema = {
    id: opts.id,
    title: opts.title,
    body: opts.body,
    threadIdentifier: opts.threadId,
    // iOS 系统默认通知声（Tri-tone）：原生端由 postinstall 补丁映射到 UNNotificationSound.default
    sound: "system-default",
    // iOS 8.3.0+：App 在前台也显示横幅（background/lock screen 由系统原生接管）。
    foreground: true,
    schedule: { at: new Date(Date.now() + BANNER_DELAY_MS) },
  };
  try {
    await LocalNotifications.schedule({ notifications: [banner] });
    return true;
  } catch {
    return false;
  }
}

export interface NewsUpdateBannerInput {
  title: string;
  body?: string;
  /** 同一条新闻重复推送只弹一次/替换同 ID，避免刷屏。 */
  newsId?: string;
}

/** 「新闻更新」→ 真实系统横幅。Web 返回 false。 */
export function postNewsUpdateBannerNow(input: NewsUpdateBannerInput): Promise<boolean> {
  const seed = input.newsId ?? input.title;
  return postSystemBannerNow({
    id: stableBannerId(`news:${seed}`, NEWS_BANNER_ID_BASE),
    threadId: "kaznu.news",
    title: input.title,
    body: input.body ?? "",
  });
}

export interface ClassReminderBannerInput {
  title: string;
  body?: string;
  /** 课程 key（如 "la"） */
  courseId: string;
  /** 触发时刻标记（t30 / t5 / e1 …），相同标记+课程不会重复弹。 */
  marker: string;
}

/** 「课前即时提醒」→ 真实系统横幅。Web 返回 false。 */
export function postClassReminderBannerNow(input: ClassReminderBannerInput): Promise<boolean> {
  return postSystemBannerNow({
    id: stableBannerId(`class:${input.courseId}:${input.marker}`, CLASS_BANNER_ID_BASE),
    threadId: "kaznu.class",
    title: input.title,
    body: input.body ?? "",
  });
}

/* ===================== 每周循环的「课前提醒」排课 ===================== */

/**
 * 按“每周该时段”排整学期的上课提醒（提前 minutes 分钟）。
 * 会先清空旧的上课提醒再重建，避免重复。
 */
export async function scheduleClassReminders(lessons: ClassLessonInput[], leadMinutes = 30): Promise<void> {
  if (!native() || lessons.length === 0) return;

  // 清掉旧的排课通知，防止每次同步叠加（只清 <10_000 的每周提醒，不动即时横幅）
  try {
    const pendingResult = await LocalNotifications.getPending();
    const pendingList = (pendingResult.notifications as Array<{ id?: number }>) ?? [];
    const oldIds = pendingList.filter((n) => (n.id ?? 0) < 10_000).map((n) => n.id ?? 0);
    if (oldIds.length > 0) {
      await LocalNotifications.cancel({ notifications: oldIds.map((id) => ({ id })) as never[] });
    }
  } catch {
    /* ignore */
  }

  const granted = await requestNotificationPermission();
  if (!granted) return;

  const notifications = lessons
    .map((lesson, idx) => {
      const start = lesson.startH * 60 + lesson.startM;
      const fire = start - leadMinutes;
      if (fire < 0) return null; // 太早的课（跨零点）本次忽略
      const hour = Math.floor(fire / 60);
      const minute = fire % 60;
      // 内部索引 0=周一 … 6=周日 → 插件 Weekday（Sunday=1 … Saturday=7）
      const weekday = ((lesson.weekday + 2) % 7 || 7) as Weekday;
      return {
        id: 100 + (idx % 5000),
        title: `${lesson.name} · 上课提醒`,
        body: `还有 ${leadMinutes} 分钟开始${lesson.room ? ` · ${lesson.room}` : ""}`,
        sound: "system-default",
        schedule: { on: { weekday, hour, minute } },
      };
    })
    .filter((n) => n !== null);

  if (notifications.length === 0) return;
  try {
    await LocalNotifications.schedule({ notifications });
  } catch {
    /* ignore */
  }
}

