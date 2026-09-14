import React, { useCallback, useEffect, useRef, useState } from "react";
import Dashboard from "./views/Dashboard";
import Grades from "./views/Grades";
import Materials from "./views/Materials";
import Campus from "./views/Campus";
import Schedule from "./views/Schedule";
import Services from "./views/Services";
import Profile from "./views/Profile";
import ProfReviews, { type RmpDeepLink } from "./views/ProfReviews";
import { useI18n } from "./contexts/LanguageContext";
import News, { NewsDetail, type NewsItem } from "./views/News";
import NotificationCenter from "./views/NotificationCenter";
import ChatList, { ChatDetail } from "./views/Chat";
import {
  attachChatRealtime,
  listConversations,
  subscribeChatEvents,
  type Conversation,
} from "./services/ChatService";
import {
  fetchNotificationUnread,
  handleRealtimeNotificationEvent,
  notifyRealtimeChange,
  subscribeBanner,
  type InAppBanner,
} from "./services/NotificationService";
import { attachPushRegistration } from "./services/PushRegistrationService";
import { applyPushRoute, attachPushRouteListener, consumePushRoute, readNativePushRoute } from "./services/PushRouteService";
import { isSessionValid, touchSession } from "./utils/session";
import LoginScreen from "./views/LoginScreen";
import { useTheme } from "./contexts/ThemeContext";
import { syncNativeStatusBar } from "./native/statusBar";
import { attachHapticDelegate } from "./utils/haptics";
import { attachKeyboardWatcher } from "./utils/keyboard";
import UpdateDialog, { type UpdateDialogKind } from "./components/UpdateDialog";
import SwipeBack from "./components/SwipeBack";
import { installQuickActionListener, type QuickActionTarget } from "./native/quickActions";
import { APP_VERSION, classifyUpdate, fetchUpdateInfo, isOptionalSkipped, skipOptional, type UpdateInfo } from "./utils/update";
import { captureDeviceContext } from "./native/device";
import { requestNotificationPermission } from "./native/notifications";
import { attachGlobalLiveActivityWatcher, enableClassReminderNotificationActions } from "./services/CourseReminderService";
import { attachLiveActivityPushSync } from "./services/LiveActivityPushService";

const TABS = [
  { id: "dashboard", label: "Home", icon: "house.fill" },
  { id: "news", label: "News", icon: "newspaper.fill" },
  // 第 3 个 Tab 由 Materials 换成 Campus Hub（校园娱乐与交流社区）；
  // Materials 改为从首页「NEXT DEADLINE」卡片进入（见 Dashboard 的 DDL 卡片）。
  { id: "campus", label: "Campus", icon: "sparkles" },
  { id: "schedule", label: "Schedule", icon: "calendar" },
  { id: "services", label: "Services", icon: "square.grid.2x2.fill" },
];

function TabIcon({ icon, active }: { icon: string; active: boolean }) {
  const icons: Record<string, React.ReactElement> = {
    "house.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
    "chart.bar.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M3 12v7h4v-7H3zm0-2h4V7H3v3zm6 9h4V7H9v12zm0-14h4V3H9v2zm6 14h4V3h-4v18z" />
      </svg>
    ),
    "newspaper.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M4 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h1v2H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h13V5H4V3zm4 4h8v2H8V7zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" />
      </svg>
    ),
    "calendar": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M8 2v2H5a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-3V2h-2v2H9V2H8zm-3 7h14v9H5V9z" />
      </svg>
    ),
    "square.grid.2x2.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
      </svg>
    ),
    "book.closed.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M4 3h15a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h15V5H4zm2.5 2.5h9v1.5h-9V7.5zm0 3.5h9v1.5h-9V11zm0 3.5h5v1.5h-5v-1.5z" />
      </svg>
    ),
    // Campus Hub：社区/公告语义的 sparkles 图标（大星 + 两颗小星）
    "sparkles": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M12 2.2l1.7 4.4 4.4 1.7-4.4 1.7L12 14.4l-1.7-4.4L5.9 8.3l4.4-1.7L12 2.2z" />
        <path d="M18.6 13.4l.95 2.45 2.45.95-2.45.95-.95 2.45-.95-2.45-2.45-.95 2.45-.95.95-2.45z" />
        <path d="M5.6 14.6l.75 1.95 1.95.75-1.95.75-.75 1.95-.75-1.95-1.95-.75 1.95-.75.75-1.95z" />
      </svg>
    ),
  };
  return icons[icon] || null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [authed, setAuthed] = useState(() => isSessionValid());
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  /** 私信：正在打开的会话（null = 显示会话列表）。进入详情前的 Tab 由 chatsReturnRef 记住 */
  const [openConversation, setOpenConversation] = useState<Conversation | null>(null);
  const chatsReturnRef = useRef("dashboard");
  /** 全局应用内 Banner（全校广播 / 新通知），任意 Tab 都可见 */
  const [banner, setBanner] = useState<InAppBanner | null>(null);
  /** 从通知点进来的帖子 id：Campus 加载完 Feed 后自动打开该帖 */
  const [campusFocusPostId, setCampusFocusPostId] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const t = useI18n();
  const tabLabels = { dashboard: t("home"), news: t("news"), campus: t("campus"), schedule: t("schedule"), services: t("services") };

  // Prof Reviews 路由：从 Home Quick Access / Services 卡片 / 课表深链进入。
  const [rmpDeepLink, setRmpDeepLink] = useState<RmpDeepLink | null>(null);
  const reviewsReturnRef = useRef("dashboard");
  const openReviews = useCallback(
    (professorName?: string, courseName?: string) => {
      reviewsReturnRef.current = activeTab === "prof-reviews" ? reviewsReturnRef.current : activeTab;
      setRmpDeepLink(professorName ? { professorName } : courseName ? { courseName } : null);
      setActiveTab("prof-reviews");
    },
    [activeTab],
  );

  const [updateState, setUpdateState] = useState<{ kind: Exclude<UpdateDialogKind, "none">; info: UpdateInfo } | null>(null);

  const closeUpdateDialog = () => setUpdateState(null);

  // 3D Touch / 长按图标快捷操作：路由跳转（未登录先缓存，登录后补跳）
  const pendingShortcutRef = useRef<QuickActionTarget | null>(null);
  const authedRef = useRef(authed);
  authedRef.current = authed;
  const routeQuickAction = useCallback(
    (target: QuickActionTarget) => {
      // “developer console” 在生产版本中不再开放，其它入口照常跳转
      if (target === "dev") return;
      setActiveTab(target); // "schedule" | "profile"
    },
    [],
  );
  useEffect(() => {
    return installQuickActionListener((target) => {
      if (!authedRef.current) {
        pendingShortcutRef.current = target;
        return;
      }
      routeQuickAction(target);
    });
  }, [routeQuickAction]);
  useEffect(() => {
    if (!authed) return;
    const pending = pendingShortcutRef.current;
    if (!pending) return;
    pendingShortcutRef.current = null;
    routeQuickAction(pending);
  }, [authed, routeQuickAction]);

  useEffect(() => attachHapticDelegate(), []);
  // 软键盘看护：键盘弹出时给 <html> 挂 `.kb-open` 与 `--kb-inset`。
  // 底部 TabBar / FAB 的收起、输入区的抬升都由 index.css 里的这几条规则自动完成，
  // 不需要在各页面之间透传状态（TabBar 在 App.tsx、FAB 在 Campus.tsx）。
  useEffect(() => attachKeyboardWatcher(), []);
  // 全局 Live Activity 看护：课表同步过之后，每 60s / 回到前台检查 T-30 灵动岛
  useEffect(() => attachGlobalLiveActivityWatcher(), []);
  // Live Activity 远程推送：把原生采集的 push token（含 push-to-start）上报后端。
  // 登录后才做（要带鉴权），并在回前台 / 原生 token 变化时自动重报。
  useEffect(() => {
    if (!authed) return;
    return attachLiveActivityPushSync();
  }, [authed]);

  // ===================================================================
  // 社交模块（本轮补齐）：私信实时通道 / 推送设备注册 / 事件桥 / 点击路由
  // ===================================================================

  // 私信实时通道：登录后建连（断线自动重连、回前台补未读、离线消息自动补发）
  useEffect(() => {
    if (!authed) return;
    return attachChatRealtime();
  }, [authed]);

  // 普通通知的设备注册：把 APNs device token 上报后端（topic 与 Live Activity 分开）
  useEffect(() => {
    if (!authed) return;
    return attachPushRegistration();
  }, [authed]);

  // 全局 WebSocket 事件桥：同一条连接同时喂"私信"与"通知"两个模块。
  // 通知帧 → NotificationService（红点 +1 + 应用内 Banner）；私信帧 → 让会话列表重取。
  useEffect(() => {
    if (!authed) return;
    void fetchNotificationUnread();
    return subscribeChatEvents((event) => {
      if (handleRealtimeNotificationEvent(event)) return;
      if (event.type === "message" || event.type === "read" || event.type === "read-ack") {
        notifyRealtimeChange();
      }
    });
  }, [authed]);

  // 应用内 Banner：订阅 + 6 秒后自动收起（用户点 × 走 dismissBanner）
  useEffect(() => subscribeBanner(setBanner), []);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 6000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  // 用会话 id 打开私信：推送点击只带 id，对端信息要从会话列表里取
  const openConversationById = useCallback(async (conversationId: string) => {
    const page = await listConversations(50, 0);
    const found = page?.items.find((item) => item.id === conversationId);
    if (found) setOpenConversation(found);
  }, []);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  /** 推送 / 通知点击 → 页内路由（切 Tab，私信还会直接打开对应会话） */
  const routePush = useCallback(
    (route: string, routeId: string | null) => {
      const target = applyPushRoute(route, routeId);
      if (!target) return;
      if (target.tab === "chat") {
        chatsReturnRef.current =
          activeTabRef.current === "chat" ? chatsReturnRef.current : activeTabRef.current;
        setOpenConversation(null);
        setActiveTab("chat");
        if (target.id) void openConversationById(target.id);
        return;
      }
      if (target.tab === "campus" && target.id) setCampusFocusPostId(target.id);
      setActiveTab(target.tab);
    },
    [openConversationById],
  );

  // 启动时消费"App 没运行时点的那条推送"；运行中由原生事件实时触发
  useEffect(() => {
    const pending = consumePushRoute();
    if (pending) routePush(pending.route, pending.routeId);
    void readNativePushRoute().then((route) => {
      if (route) routePush(route.route, route.routeId);
    });
  }, [routePush]);
  useEffect(() => attachPushRouteListener((route) => routePush(route.route, route.routeId)), [routePush]);
  // 点击 T-60 通知或“开启灵动岛”按钮 → 立即启动 Live Activity
  useEffect(() => {
    enableClassReminderNotificationActions();
  }, []);

  // 已登录状态下每次打开 App 都刷新“最近活跃”，15 天内回来就不用重新验证
  useEffect(() => {
    if (authed) touchSession();
  }, [authed]);

  // 原生状态栏：保持覆盖模式，文字颜色跟随深浅主题（浏览器环境自动跳过）
  useEffect(() => {
    void syncNativeStatusBar(resolvedTheme);
  }, [resolvedTheme]);

  // 自动更新检查（登录后执行一次）：可选更新可“暂不更新”（仅本次启动不再提示）
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void (async () => {
      const info = await fetchUpdateInfo();
      if (cancelled || !info) return;
      const kind = classifyUpdate(APP_VERSION, info);
      if (kind === "none") return;
      if (kind === "optional" && isOptionalSkipped(info.latest_version)) return;
      setUpdateState({ kind, info });
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  // 启动时采集定位/时区 + 提前申请本地通知权限（失败都不阻塞）
  useEffect(() => {
    if (!authed) return;
    void captureDeviceContext();
    void requestNotificationPermission();
  }, [authed]);

  return (
    <div
      className="app-root relative w-full h-full flex flex-col overflow-hidden"
      style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 430, margin: "0 auto" }}
    >
      {/* 首次启动 / 会话过期：先登录一次 */}
      {!authed && <LoginScreen onSuccess={() => setAuthed(true)} />}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === "dashboard" && (
          <Dashboard
            onOpenProfile={() => setActiveTab("profile")}
            onNavigate={setActiveTab}
            onOpenReviews={openReviews}
            onOpenChat={() => {
              chatsReturnRef.current = "dashboard";
              setOpenConversation(null);
              setActiveTab("chat");
            }}
          />
        )}
        {activeTab === "notifications" && (
          <SwipeBack onBack={() => setActiveTab("dashboard")}>
            <NotificationCenter
              onBack={() => setActiveTab("dashboard")}
              onOpenRoute={(route, routeId) => routePush(route, routeId)}
            />
          </SwipeBack>
        )}
        {/* 私信：列表 ↔ 会话详情都由本层路由（从通知/推送点进来也能直达具体会话） */}
        {activeTab === "chat" && !openConversation && (
          <SwipeBack onBack={() => setActiveTab(chatsReturnRef.current)}>
            <ChatList
              onBack={() => setActiveTab(chatsReturnRef.current)}
              onOpenConversation={(conversation) => setOpenConversation(conversation)}
            />
          </SwipeBack>
        )}
        {activeTab === "chat" && openConversation && (
          <SwipeBack onBack={() => setOpenConversation(null)}>
            <ChatDetail conversation={openConversation} onBack={() => setOpenConversation(null)} />
          </SwipeBack>
        )}
        {activeTab === "grades" && (
          <SwipeBack onBack={() => setActiveTab("dashboard")}>
            <Grades onBack={() => setActiveTab("dashboard")} />
          </SwipeBack>
        )}
        {/* Materials 已从底部 Tab 移除，改由首页 NEXT DEADLINE 卡片进入 */}
        {activeTab === "materials" && <Materials onBack={() => setActiveTab("dashboard")} />}
        {activeTab === "schedule" && <Schedule onOpenReviews={openReviews} />}
        {activeTab === "campus" && (
          <Campus
            focusPostId={campusFocusPostId}
            onFocusHandled={() => setCampusFocusPostId(null)}
            onOpenConversation={(conversation) => {
              // 从帖子点「私信」→ 记住来路是 Campus，返回时回到校园墙
              chatsReturnRef.current = "campus";
              setOpenConversation(conversation);
              setActiveTab("chat");
            }}
          />
        )}
        {activeTab === "services" && <Services onOpenReviews={openReviews} />}
        {activeTab === "prof-reviews" && <ProfReviews onBack={() => setActiveTab(reviewsReturnRef.current)} deepLink={rmpDeepLink} />}
        {activeTab === "profile" && (
          <SwipeBack onBack={() => setActiveTab("dashboard")}>
            <Profile onBack={() => setActiveTab("dashboard")} />
          </SwipeBack>
        )}
        {activeTab === "news" && <News onOpenDetail={(item) => { setSelectedNews(item); setActiveTab("news-detail"); }} />}
        {activeTab === "news-detail" && selectedNews && (
          <SwipeBack onBack={() => setActiveTab("news")}>
            <NewsDetail item={selectedNews} onBack={() => setActiveTab("news")} />
          </SwipeBack>
        )}
      </div>

      {/* Tab Bar */}
      <div className="tab-bar shrink-0 flex items-start justify-around pt-2 pb-5 px-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="haptic-action flex flex-col items-center gap-1 px-2 py-1 transition-all duration-200"
              style={{ minWidth: 60 }}
            >
              <span style={{ color: active ? "#007AFF" : "rgba(235,235,245,0.45)", transition: "color 0.2s" }}>
                <TabIcon icon={tab.icon} active={active} />
              </span>
              <span
                className="text-xs font-medium"
                style={{ color: active ? "#007AFF" : "rgba(235,235,245,0.45)", fontSize: 10, transition: "color 0.2s" }}
              >
                {tabLabels[tab.id as keyof typeof tabLabels]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 应用内 Banner：全校广播 / 新通知到达时的全局浮层（任意 Tab 都可见） */}
      {banner && (
        <div className={`app-banner app-banner-${banner.level}`} role="status" aria-live="polite">
          <span className="app-banner-icon">
            {banner.level === "danger"
              ? "🚨"
              : banner.level === "warning"
                ? "⚠️"
                : banner.origin === "broadcast"
                  ? "📣"
                  : "🔔"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="app-banner-title">{banner.title}</p>
            {banner.message && <p className="app-banner-text">{banner.message}</p>}
          </div>
          <button
            type="button"
            aria-label={t("hide")}
            onClick={() => setBanner(null)}
            className="app-banner-close"
          >
            ✕
          </button>
        </div>
      )}

      {/* 自动更新弹窗（可选/强制）与后台状态模拟面板 */}
      <UpdateDialog
        kind={updateState?.kind ?? "none"}
        info={updateState?.info ?? null}
        onClose={closeUpdateDialog}
        onDismissOptional={updateState?.info ? () => skipOptional(updateState!.info!.latest_version) : undefined}
      />
    </div>
  );
}
