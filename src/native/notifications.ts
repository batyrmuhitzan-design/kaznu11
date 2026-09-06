/**
 * 上课提醒（@capacitor/local-notifications）。
 *
 * 课表数据形状与后端 /api/schedule 一致：
 *   { weekday: "0".."6", lessons: [{ name, room, prof, type, startH, startM, endH, endM }] }
 * 约定：key 0=周一 … 6=周日；本地通知插件 Weekday 枚举是 Sunday=1。
 */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications, Weekday } from "@capacitor/local-notifications";

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

/**
 * 按“每周该时段”排整学期的上课提醒（提前 minutes 分钟）。
 * 会先清空旧的上课提醒再重建，避免重复。
 */
export async function scheduleClassReminders(lessons: ClassLessonInput[], leadMinutes = 30): Promise<void> {
  if (!native() || lessons.length === 0) return;

  // 清掉旧的排课通知，防止每次同步叠加
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
