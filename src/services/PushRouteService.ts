/**
 * 推送点击 → App 内路由（deep link 解析）。
 *
 * 完整链路
 * --------
 * ```
 * APNs 横幅被点击
 *   → 原生 AppDelegate 从 userInfo 取出 kaznu.route / kaznu.route_id
 *   → 存进 UserDefaults，并通过 KaznuLiveActivity 插件发 `pushRouteOpened` 事件
 *     （App 没运行时则等下次启动，由 getPendingRoute 取出）
 *   → 本模块把 route 解析成 Tab 目标
 *   → App.tsx 切 Tab（私信还会直接打开对应会话）
 * ```
 *
 * 为什么路由表放在 Web 层：Tab 名、会话 id 的用法都只存在于前端。
 * 原生层只负责把 payload 原样透传，避免两边各维护一份路由规则（迟早不一致）。
 */
export interface PendingPushRoute {
  route: string;
  routeId: string | null;
  at: number;
}

/** 解析后的 Tab 目标 */
export interface PushTarget {
  /** dashboard | news | campus | chat | notif */
  tab: string;
  /** chat = 会话 id；post = 帖子 id；news = 新闻 id；其余为 null */
  id: string | null;
}

const PENDING_KEY = "kaznu:pendingPushRoute";

/** 原生插件代理（未打包原生环境时为 undefined，所有调用都必须容错）。 */
type NativePluginProxy = {
  addListener?: (name: string, cb: (data: unknown) => void) => Promise<{ remove: () => void }>;
  getPendingRoute?: () => Promise<{ route?: string; routeId?: string | null } | null>;
};

function nativeProxy(): NativePluginProxy | undefined {
  const capacitor = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = capacitor?.Plugins?.["KaznuLiveActivity"] as NativePluginProxy | undefined;
  return plugin ?? undefined;
}

/** 暂存一条待处理路由（Apple 通知中心冷启动、或原生事件先于 React 挂载到达时用）。 */
export function stagePushRoute(route: string, routeId: string | null): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ route, routeId, at: Date.now() }));
  } catch {
    /* 存储不可用：本次点击就丢了，不影响其它功能 */
  }
}

/** 读取并清除待处理路由（App 启动时调用一次）。 */
export function consumePushRoute(): PendingPushRoute | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as PendingPushRoute;
    if (!parsed?.route) return null;
    // 超过 5 分钟的陈旧点击不再跳转（用户早就忘了）
    if (Date.now() - (parsed.at ?? 0) > 5 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 从原生层取"App 未运行时点的那条推送"。 */
export async function readNativePushRoute(): Promise<PendingPushRoute | null> {
  try {
    const proxy = nativeProxy();
    if (!proxy?.getPendingRoute) return null;
    const result = await proxy.getPendingRoute();
    if (!result?.route) return null;
    return {
      route: String(result.route),
      routeId: result.routeId ? String(result.routeId) : null,
      at: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * 把服务端给的 route 翻译成 App 的 Tab 目标。
 *
 * 服务端 route 取值（见 schemas.NotificationOut 注释）：
 * ``chat`` 私信会话 / ``post`` 校园墙帖子 / ``news`` 新闻 / ``campus`` 校园墙 / ``none`` 不跳。
 */
export function applyPushRoute(route: string, routeId: string | null): PushTarget | null {
  switch ((route || "").toLowerCase()) {
    case "chat":
      return { tab: "chat", id: routeId };
    case "post":
      return { tab: "campus", id: routeId };
    case "news":
      return { tab: "news", id: routeId };
    case "campus":
      return { tab: "campus", id: null };
    default:
      return null;
  }
}

/**
 * 挂上原生推送点击监听（返回卸载函数）。
 * 事件名 `pushRouteOpened` 与 iOS 侧 KaznuLiveActivityPlugin 约定一致。
 */
export function attachPushRouteListener(cb: (route: PendingPushRoute) => void): () => void {
  let removeListener: (() => void) | undefined;
  const proxy = nativeProxy();
  if (proxy?.addListener) {
    void proxy
      .addListener("pushRouteOpened", (data) => {
        const payload = (data ?? {}) as { route?: string; routeId?: string | null };
        if (!payload.route) return;
        cb({
          route: String(payload.route),
          routeId: payload.routeId ? String(payload.routeId) : null,
          at: Date.now(),
        });
      })
      .then((listener) => {
        removeListener = () => listener.remove();
      })
      .catch(() => undefined);
  }
  return () => removeListener?.();
}