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

export interface LiveActivityPayload {
  course: {
    name: string;
    type: string;
    professor: string;
    room: string;
    building: string;
  };
  timeWindow: { start: string; end: string };
  countdownSeconds: number;
  totalSeconds: number;
  phase: LiveActivityPhase;
  kind: LiveActivityKind;
  statusLabel: string;
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
}

export function buildLiveActivityPayload(input: LiveActivityInput): LiveActivityPayload {
  const pct = input.total > 0 ? input.remaining / input.total : 0;
  return {
    course: {
      name: input.name,
      type: input.type,
      professor: input.professor,
      room: input.room,
      building: input.building,
    },
    timeWindow: { start: toHHMM(input.startH, input.startM), end: toHHMM(input.endH, input.endM) },
    countdownSeconds: Math.max(0, Math.round(input.remaining)),
    totalSeconds: Math.max(0, Math.round(input.total)),
    phase: phaseOf(pct),
    kind: input.kind,
    statusLabel: input.statusLabel,
    shouldShowLiveActivity: input.kind !== "none",
  };
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
