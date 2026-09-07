/**
 * iOS 原生适配层（Live Activity / 灵动岛 / 锁屏）。
 *
 * ⚠️ 设计约定：
 *  - App 前台：不渲染任何“灵动岛/锁屏小组件”，只显示正常课程卡。
 *  - 只有 App 切到后台 / 锁定屏幕时，原生端才会驱动灵动岛。
 *
 * 网页原型阶段：本文件只负责把倒计时“数据”整理成标准 payload。
 * 以后包成 iOS App 时，把 `syncLiveActivity` 接到 ActivityKit：
 *   1) 用 payload 创建 Activity（进入课前/课中）；
 *   2) 每秒 update；
 *   3) 课程结束 pushState 为 finished / 调用 end。
 * 无需改动 Web 侧 UI 代码。
 */

export type LiveActivityPhase = "green" | "orange" | "red";
export type LiveActivityKind = "pre-class" | "in-class" | "none";
/** 原生端动作：start=启动灵动岛；update=刷新剩余秒数/颜色；end=结束并收起。 */
export type LiveActivityControl = "start" | "update" | "end";

export interface LiveActivityNavigation {
  label: string;
  url: string;
}

export interface LiveActivityPayload {
  /** 原生端动作；缺省视为 update（用于 App 后台前已有的倒计时刷新）。 */
  control?: LiveActivityControl;
  course: {
    name: string;
    type: string;
    professor: string;
    room: string;
    building: string;
  };
  /** 灵动岛紧凑区显示的课程缩写（如 LA / HM2）；缺省由原生取首字母。 */
  courseShort?: string;
  timeWindow: { start: string; end: string };
  countdownSeconds: number;
  totalSeconds: number;
  phase: LiveActivityPhase;
  kind: LiveActivityKind;
  statusLabel: string;
  /** 展开视图里的 Navigation 按钮（如“打开课表”） */
  navigation?: LiveActivityNavigation;
  /** iOS 原生端用于决定是否要展示灵动岛：只有 kind!=none 且 App 在后台时才展示。 */
  shouldShowLiveActivity: boolean;
}

function toHHMM(h: number, m: number) {
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function phaseOf(pct: number): LiveActivityPhase {
  if (pct > 0.5) return "green";
  if (pct > 0.25) return "orange";
  return "red";
}

export interface LiveActivityInput {
  name: string;
  type: string;
  professor: string;
  room: string;
  building: string;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  remaining: number;
  total: number;
  kind: LiveActivityKind;
  statusLabel: string;
  /** 需要主动 start/update/end 时传 control；缺省则按“update 同步”语义。 */
  control?: LiveActivityControl;
  /** 灵动岛紧凑区缩写；缺省由原生从 name 推导。 */
  courseShort?: string;
  /** 展开视图 Navigation 按钮。 */
  navigation?: LiveActivityNavigation;
}

export function buildLiveActivityPayload(input: LiveActivityInput): LiveActivityPayload {
  const pct = input.total > 0 ? input.remaining / input.total : 0;
  return {
    ...(input.control ? { control: input.control } : {}),
    course: {
      name: input.name,
      type: input.type,
      professor: input.professor,
      room: input.room,
      building: input.building,
    },
    ...(input.courseShort ? { courseShort: input.courseShort } : {}),
    timeWindow: { start: toHHMM(input.startH, input.startM), end: toHHMM(input.endH, input.endM) },
    countdownSeconds: Math.max(0, Math.round(input.remaining)),
    totalSeconds: Math.max(0, Math.round(input.total)),
    phase: phaseOf(pct),
    kind: input.kind,
    statusLabel: input.statusLabel,
    ...(input.navigation ? { navigation: input.navigation } : {}),
    shouldShowLiveActivity: input.kind !== "none",
  };
}

/** 便捷：课程缩写（LA / HM2 / ENG…），供灵动岛紧凑区与 Service 使用。 */
export function initialsOfCourse(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((word) => word.length > 0 && /^[A-Za-z]/.test(word))
    .slice(0, 2);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

declare global {
  interface Window {
    __KAZNU_LIVE_ACTIVITY_BRIDGE__?: (payload: LiveActivityPayload) => void;
  }
}

/**
 * 同步到原生桥。
 * - 原生包（WKWebView/ActivityKit）会注入 window.__KAZNU_LIVE_ACTIVITY_BRIDGE__。
 * - 纯 Web 预览里这里什么都不做 —— App 内不显示任何悬浮小部件。
 */
export function syncLiveActivity(payload: LiveActivityPayload) {
  if (typeof window !== "undefined" && typeof window.__KAZNU_LIVE_ACTIVITY_BRIDGE__ === "function") {
    window.__KAZNU_LIVE_ACTIVITY_BRIDGE__(payload);
  }
}
