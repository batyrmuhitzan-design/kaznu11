import React, { useCallback, useEffect, useRef, useState } from "react";
import Dashboard from "./views/Dashboard";
import Grades from "./views/Grades";
import Materials from "./views/Materials";
import Schedule from "./views/Schedule";
import Services from "./views/Services";
import Profile from "./views/Profile";
import { useI18n } from "./contexts/LanguageContext";
import News, { NewsDetail, type NewsItem } from "./views/News";
import Notifications from "./views/Notifications";
import { isSessionValid, touchSession } from "./utils/session";
import LoginScreen from "./views/LoginScreen";
import { useTheme } from "./contexts/ThemeContext";
import { syncNativeStatusBar } from "./native/statusBar";
import { attachHapticDelegate } from "./utils/haptics";
import UpdateDialog, { type UpdateDialogKind } from "./components/UpdateDialog";
import { DevPanel } from "./components/DevPanel";
import { SIM_UPDATE_EVENT, useDevSim } from "./contexts/DevSimContext";
import { installQuickActionListener, type QuickActionTarget } from "./native/quickActions";
import { APP_VERSION, classifyUpdate, fetchUpdateInfo, isOptionalSkipped, skipOptional, type UpdateInfo } from "./utils/update";
import { captureDeviceContext } from "./native/device";
import { requestNotificationPermission } from "./native/notifications";
import { attachGlobalLiveActivityWatcher, enableClassReminderNotificationActions } from "./services/CourseReminderService";

const TABS = [
  { id: "dashboard", label: "Home", icon: "house.fill" },
  { id: "news", label: "News", icon: "newspaper.fill" },
  { id: "materials", label: "Materials", icon: "book.closed.fill" },
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
  };
  return icons[icon] || null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [authed, setAuthed] = useState(() => isSessionValid());
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const { resolvedTheme } = useTheme();
  const t = useI18n();
  const tabLabels = { dashboard: t("home"), news: t("news"), materials: t("materials"), schedule: t("schedule"), services: t("services") };
  const sim = useDevSim();

  const [updateState, setUpdateState] = useState<{ kind: Exclude<UpdateDialogKind, "none">; info: UpdateInfo } | null>(null);

  const closeUpdateDialog = () => setUpdateState(null);

  // 3D Touch / 长按图标快捷操作：路由跳转（未登录先缓存，登录后补跳）
  const pendingShortcutRef = useRef<QuickActionTarget | null>(null);
  const authedRef = useRef(authed);
  authedRef.current = authed;
  const routeQuickAction = useCallback(
    (target: QuickActionTarget) => {
      if (target === "dev") {
        sim.openPanel();
        return;
      }
      setActiveTab(target); // "schedule" | "profile"
    },
    [sim],
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
  // 全局 Live Activity 看护：课表同步过之后，每 60s / 回到前台检查 T-30 灵动岛
  useEffect(() => attachGlobalLiveActivityWatcher(), []);
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

  // Dev Console：手动触发“可选更新 / 强制更新”弹窗
  useEffect(() => {
    const onTest = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: "optional" | "forced" }>).detail;
      const kind = detail?.kind === "forced" ? "forced" : "optional";
      const info: UpdateInfo = {
        latest_version: "2.0.0",
        min_supported_version: kind === "forced" ? "2.0.0" : "1.0.0",
        update_url: "https://github.com/batyrmuhitzan-design/kaznu11/releases",
        notes: ["Dev Console 测试更新", "用于验证更新弹窗交互"],
      };
      setUpdateState({ kind, info });
    };
    window.addEventListener(SIM_UPDATE_EVENT, onTest);
    return () => window.removeEventListener(SIM_UPDATE_EVENT, onTest);
  }, []);

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
        {activeTab === "dashboard" && <Dashboard onOpenProfile={() => setActiveTab("profile")} onNavigate={setActiveTab} />}
        {activeTab === "notifications" && <Notifications onBack={() => setActiveTab("dashboard")} onNavigate={setActiveTab} />}
        {activeTab === "grades" && <Grades onBack={() => setActiveTab("dashboard")} />}
        {activeTab === "materials" && <Materials />}
        {activeTab === "schedule" && <Schedule />}
        {activeTab === "services" && <Services />}
        {activeTab === "profile" && <Profile onBack={() => setActiveTab("dashboard")} />}
        {activeTab === "news" && <News onOpenDetail={(item) => { setSelectedNews(item); setActiveTab("news-detail"); }} />}
        {activeTab === "news-detail" && selectedNews && <NewsDetail item={selectedNews} onBack={() => setActiveTab("news")} />}
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

      {/* 自动更新弹窗（可选/强制）与后台状态模拟面板 */}
      <UpdateDialog
        kind={updateState?.kind ?? "none"}
        info={updateState?.info ?? null}
        onClose={closeUpdateDialog}
        onDismissOptional={updateState?.info ? () => skipOptional(updateState!.info!.latest_version) : undefined}
      />
      <DevPanel />
    </div>
  );
}
