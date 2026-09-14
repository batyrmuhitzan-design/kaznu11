/**
 * Live Activity 远程推送（APNs）—— Web 侧的上报与课表同步。
 *
 * 分工（重要）：
 *   Swift 只负责「拿 token」：device token / **push-to-start token** / 每个 Activity 的 push token；
 *   上报放到 Web 层做 —— 登录态（Bearer token）在 Web 层，原生端不保存凭据更安全，
 *   也省得在 Swift 里再写一套鉴权。
 *
 * 上报时机：登录后启动、回到前台、原生 token 变化事件、课表同步之后。
 * 服务器拿到 push-to-start token 后，才能在 **App 完全没运行**时
 * 于课前 15 分钟把倒计时卡片推到锁屏 / 灵动岛。
 */
import { fetchLiveActivityPushTokens } from "../native/liveActivity";
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { currentLocale } from "../utils/locale";
import { rmpEnsureToken } from "./ProfReviewsService";

const API = `${API_BASE_URL}/api/v1`;
const WEB_DEVICE_ID_KEY = "kaznu:liveActivity:deviceId";

/**
 * APNs 环境。**上线到 TestFlight / App Store 时改成 "production"**，
 * 否则服务器会往 sandbox 网关发（真机装正式包时收不到）。
 */
export const APNS_ENVIRONMENT: "sandbox" | "production" = "sandbox";

/** 课表条目（与 `CourseReminderLesson` / Swift `KaznuLesson` 字段对齐） */
export interface ServerLesson {
  id: string;
  name: string;
  short?: string;
  room?: string;
  prof?: string;
  weekday: number;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}

/** Web 预览 / 原生不可用时的设备标识（仅用于联调，不影响真机链路） */
function fallbackDeviceId(): string {
  try {
    const saved = window.localStorage.getItem(WEB_DEVICE_ID_KEY);
    if (saved) return saved;
    const fresh = `web-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    window.localStorage.setItem(WEB_DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return "web-unknown";
  }
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response | null> {
  const url = `${API}${path}`;
  if (blockInsecureRequest(url)) return null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    window.clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

async function authedPost(path: string, body: unknown): Promise<Response | null> {
  const token = await rmpEnsureToken();
  if (!token) return null;
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/**
 * 把原生采集到的推送 token 上报后端。
 *
 * @returns 是否全部上报成功（未登录 / 网络不可用时 false，调用方无需报错）
 */
export async function registerLiveActivityPush(): Promise<boolean> {
  const tokens = await fetchLiveActivityPushTokens();
  const payload = {
    device_id: tokens?.deviceId || fallbackDeviceId(),
    device_token: tokens?.deviceToken || null,
    // 关键字段：服务器拿它才能"App 没运行也拉起卡片"
    push_to_start_token: tokens?.pushToStartToken || null,
    environment: APNS_ENVIRONMENT,
    timezone:
      tokens?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Almaty",
    locale: currentLocale(),
    alerts_enabled: true,
  };

  const res = await authedPost("/live-activity/registration", payload);
  const registrationOk = res !== null && res.ok;

  // 逐条上报正在跑的 Activity 的 push token（服务器用它做课中 update / 下课 end）
  const activities = tokens?.activities ?? {};
  let sessionsOk = true;
  for (const [activityId, pushToken] of Object.entries(activities)) {
    const sessionRes = await authedPost("/live-activity/session", {
      activity_id: activityId,
      push_token: pushToken,
      phase: "preClass",
      environment: APNS_ENVIRONMENT,
      started_by: "local",
    });
    if (sessionRes === null || !sessionRes.ok) sessionsOk = false;
  }

  return registrationOk && sessionsOk;
}

/** 把课表同步给服务器（服务器据此计算"课前 15 分钟"）。 */
export async function syncTimetableToServer(
  lessons: ServerLesson[],
  alertsEnabled = true,
): Promise<boolean> {
  const res = await authedPost("/lessons/sync", {
    alerts_enabled: alertsEnabled,
    lessons: lessons.map((lesson) => ({
      course_key: lesson.id,
      name: lesson.name,
      short: lesson.short ?? null,
      room: lesson.room ?? null,
      teacher: lesson.prof ?? null,
      weekday: lesson.weekday,
      start_h: lesson.startH,
      start_m: lesson.startM,
      end_h: lesson.endH,
      end_m: lesson.endM,
    })),
  });
  return res !== null && res.ok;
}

/** 自检：后端看到的注册 / 在跑的卡片 / APNs 服务端状态（调试面板用）。 */
export async function fetchLiveActivityStatus(): Promise<Record<string, unknown> | null> {
  const token = await rmpEnsureToken();
  if (!token) return null;
  const res = await apiFetch("/live-activity/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 挂上自动同步：
 *  - 回前台（token 可能在这期间变化）；
 *  - 原生 `pushTokensChanged` 事件（token 一到位立刻上报，不用等下次启动）；
 *  - 启动后的两次延迟补报（系统下发 push-to-start token 有几秒延迟）。
 *
 * @returns 卸载函数
 */
export function attachLiveActivityPushSync(): () => void {
  const run = () => {
    void registerLiveActivityPush();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", onVisible);

  // 原生 token 变化事件（KaznuLiveActivityPlugin.notifyListeners）
  let removeListener: (() => void) | undefined;
  try {
    const proxy = (
      window as unknown as {
        Capacitor?: {
          Plugins?: Record<
            string,
            { addListener?: (name: string, cb: () => void) => Promise<{ remove: () => void }> }
          >;
        };
      }
    ).Capacitor?.Plugins?.["KaznuLiveActivity"];
    if (proxy?.addListener) {
      void proxy.addListener("pushTokensChanged", run).then((listener) => {
        removeListener = () => listener.remove();
      });
    }
  } catch {
    /* 原生不可用：只靠前台同步 */
  }

  const timers = [2500, 8000].map((delay) => window.setTimeout(run, delay));
  run();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    timers.forEach((timer) => window.clearTimeout(timer));
    removeListener?.();
  };
}
