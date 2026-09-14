/**
 * 普通通知的设备注册（APNs device token 上报 / 注销）。
 *
 * 与 Live Activity 的分工
 * -----------------------
 * 两者**共用同一个物理 token**（App Delegate 拿到的 device token），但服务器端是两张表：
 *
 *  | 用途            | 接口                          | topic                                        |
 *  |-----------------|-------------------------------|----------------------------------------------|
 *  | 普通通知横幅    | POST /notifications/devices   | com.kaznu.helper（campus/alerts 共用）        |
 *  | 灵动岛/锁屏卡片 | POST /live-activity/registration | com.kaznu.helper.push-type.liveactivity  |
 *
 * topic 一旦串用，APNs 会直接返回 `TopicDisallowed`（卡片弹不出来 / 横幅收不到），
 * 所以两条链路各自注册、互不覆盖。
 *
 * device_id 特意和 Live Activity 复用同一个 localStorage key：
 * 同一台设备在两套表里的 device_id 保持一致，服务端排查"这台设备为什么收不到"时能对上。
 */
import { fetchLiveActivityPushTokens } from "../native/liveActivity";
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { currentLocale } from "../utils/locale";
import { APNS_ENVIRONMENT } from "./LiveActivityPushService";
import { rmpEnsureToken } from "./ProfReviewsService";

const API = `${API_BASE_URL}/api/v1`;
/** ⚠️ 刻意与 LiveActivityPushService 使用同一个 key（见文件头注释） */
const DEVICE_ID_KEY = "kaznu:liveActivity:deviceId";

/** 设备标识：优先用原生采集的 identifierForVendor，Web 预览回落到持久化随机串。 */
export function ensureDeviceId(): string {
  try {
    const saved = window.localStorage.getItem(DEVICE_ID_KEY);
    if (saved) return saved;
    const fresh = `web-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return "web-unknown";
  }
}

export interface AlertDevicePayload {
  device_id: string;
  token: string;
  platform: "ios";
  environment: "sandbox" | "production";
  locale: string;
  alerts_enabled: boolean;
}

/**
 * 上报（或更新）本机的推送设备。
 *
 * 注意后端 ``DeviceTokenIn.locale`` 只接受 EN/KZ/RU —— 传 zh/其它会被 422 拒掉，
 * 所以这里用 ``currentLocale()``（App 的语言开关，取值就是 EN/KZ/RU）。
 *
 * @returns 是否注册成功（未登录 / 无 token / 网络失败 → false，调用方无需报错）
 */
export async function registerNotificationDevice(alertsEnabled = true): Promise<boolean> {
  const tokens = await fetchLiveActivityPushTokens();
  const deviceToken = tokens?.deviceToken;
  // 没有 token 说明：模拟器 / 未授权通知 / 还没等到 didRegisterForRemoteNotifications
  if (!deviceToken) return false;

  const authToken = await rmpEnsureToken();
  if (!authToken) return false;

  const body: AlertDevicePayload = {
    device_id: tokens?.deviceId || ensureDeviceId(),
    token: deviceToken,
    platform: "ios",
    environment: APNS_ENVIRONMENT,
    locale: currentLocale(),
    alerts_enabled: alertsEnabled,
  };
  const url = `${API}/notifications/devices`;
  if (blockInsecureRequest(url)) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 注销本机设备（用户关掉推送、或退出登录时调用）——否则会继续收到别人的通知。 */
export async function unregisterNotificationDevice(): Promise<boolean> {
  const authToken = await rmpEnsureToken();
  if (!authToken) return false;
  const deviceId = encodeURIComponent(ensureDeviceId());
  const url = `${API}/notifications/devices/${deviceId}`;
  if (blockInsecureRequest(url)) return false;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 挂上自动注册：启动、回前台、原生 token 变化时都重报一次。
 * （iOS 的 device token 会在重装/恢复备份后变化，必须跟着更新。）
 *
 * @returns 卸载函数
 */
export function attachPushRegistration(): () => void {
  const run = () => {
    void registerNotificationDevice();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", onVisible);

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

  const timers = [3000, 9000].map((delay) => window.setTimeout(run, delay));
  run();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    timers.forEach((timer) => window.clearTimeout(timer));
    removeListener?.();
  };
}