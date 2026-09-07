import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { hapticImpact, hapticSuccess, hapticTap } from "../utils/haptics";
import { useToast } from "./ToastContext";
import { postNewsUpdateBannerNow } from "../native/notifications";

/** 倒计时模拟：把“当前时间”拨到典型时刻来观察主页倒计时。 */
export type CountdownSim = "off" | "pre5" | "end2";

interface DevSimState {
  open: boolean;
  mode: CountdownSim;
  weekOverride: number | null;
}

export interface DevSimApi extends DevSimState {
  openPanel: () => void;
  closePanel: () => void;
  setMode: (mode: CountdownSim) => void;
  setWeekOverride: (week: number | null) => void;
  resetAll: () => void;
  simulateNews: () => void;
  triggerUpdateTest: (kind: "optional" | "forced") => void;
  simulatedNow: (real: Date) => Date;
}

export const SIM_NEWS_EVENT = "kaznu:sim-news";
export const SIM_UPDATE_EVENT = "kaznu:test-update";

const Ctx = createContext<DevSimApi | undefined>(undefined);

export function DevSimProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CountdownSim>("off");
  const [weekOverride, setWeekOverride] = useState<number | null>(null);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  // Ctrl/Cmd + Shift + D 唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const simulatedNow = useCallback(
    (real: Date): Date => {
      if (mode === "off") return real;
      // 保留真实“秒 + 毫秒”只改 小时/分钟：模拟模式同样实时倒数（04:59 → 04:58…），
      // 否则每次返回整秒固定值会把首页倒计时“卡死”在 5:00 / 2:00。
      const sec = real.getSeconds();
      const ms = real.getMilliseconds();
      const d = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 0, 0, sec, ms);
      if (mode === "pre5") {
        d.setHours(8, 55, sec, ms); // 距 9:00《线性代数》约 5 分钟
      } else {
        d.setHours(10, 28, sec, ms); // 9:00–10:30 课上约剩 2 分钟
      }
      return d;
    },
    [mode],
  );

  const simulateNews = useCallback(() => {
    const entry = {
      id: `dev-news-${Date.now()}`,
      title: "Campus Announcement (sim)",
      body: "New university announcement · simulated by Dev Console",
      time: "Just now",
      target: "news",
      color: "#30D158",
    };
    try {
      const prev = JSON.parse(localStorage.getItem("kaznu:devNews") || "[]") as unknown[];
      localStorage.setItem("kaznu:devNews", JSON.stringify([entry, ...prev]));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(SIM_NEWS_EVENT, { detail: entry }));
    void hapticSuccess();
    // 原生 iOS：直接弹真实系统 Top Banner（前台/锁屏均可见）；Web：退回 In-App Toast。
    void postNewsUpdateBannerNow({ newsId: entry.id, title: entry.title, body: entry.body }).then((sent) => {
      if (!sent) toast.push("Simulated a new campus notification 🔔", "info");
    });
  }, [toast]);

  const triggerUpdateTest = useCallback((kind: "optional" | "forced") => {
    window.dispatchEvent(new CustomEvent(SIM_UPDATE_EVENT, { detail: { kind } }));
    setOpen(false);
  }, []);

  const resetAll = useCallback(() => {
    setMode("off");
    setWeekOverride(null);
    toast.push("Simulation cleared", "info");
    void hapticTap();
  }, [toast]);

  const value: DevSimApi = {
    open,
    mode,
    weekOverride,
    openPanel,
    closePanel,
    setMode,
    setWeekOverride,
    resetAll,
    simulateNews,
    triggerUpdateTest,
    simulatedNow,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDevSim(): DevSimApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDevSim must be used within DevSimProvider");
  return ctx;
}

/** 长按助手（给 Dashboard 头像等元素调用） */
export function useLongPressOpen(): { onPointerDown: () => void; onPointerUp: () => void; onPointerLeave: () => void } {
  const { openPanel } = useDevSim();
  const [timer, setTimer] = useState<number | null>(null);

  const start = useCallback(() => {
    if (timer !== null) window.clearTimeout(timer);
    setTimer(window.setTimeout(() => {
      setTimer(null);
      void hapticImpact();
      openPanel();
    }, 600));
  }, [timer, openPanel]);

  const stop = useCallback(() => {
    if (timer !== null) {
      window.clearTimeout(timer);
      setTimer(null);
    }
  }, [timer]);

  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop };
}
