import { useEffect } from "react";
import { useDevSim, type CountdownSim } from "../contexts/DevSimContext";

export function DevPanel() {
  const sim = useDevSim();

  useEffect(() => {
    if (!sim.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sim.open]);

  if (!sim.open) return null;

  const modeNow = sim.simulatedNow(new Date());

  const pickMode = (m: CountdownSim) => {
    sim.setMode(m);
    sim.closePanel();
  };

  return (
    <div
      className="dev-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) sim.closePanel();
      }}
    >
      <div className="dev-sheet" role="dialog" aria-label="Dev Simulation Console">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-white" style={{ letterSpacing: "-0.2px" }}>🧪 Dev Simulation Console</p>
            <p className="theme-muted text-[11px] mt-0.5">Ctrl/⌘ + Shift + D 或长按头像 0.6s 唤起</p>
          </div>
          <button type="button" onClick={sim.closePanel} aria-label="Close" className="haptic-action icon-button w-8 h-8 rounded-full flex items-center justify-center theme-muted" style={{ background: "rgba(255,255,255,0.07)" }}>
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto pr-0.5 max-h-[60vh]">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide theme-muted mb-2">⏱ 倒计时模拟</p>
            <div className="flex gap-2">
              {([
                ["off", "正常"],
                ["pre5", "临近上课 5min"],
                ["end2", "即将下课 2min"],
              ] as [CountdownSim, string][]).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => pickMode(val)}
                  className="haptic-action flex-1 py-2 rounded-lg text-[11px] font-bold transition-all"
                  style={{
                    background: sim.mode === val ? "rgba(0,122,255,0.25)" : "rgba(255,255,255,0.06)",
                    color: sim.mode === val ? "#409CFF" : "rgba(235,235,245,0.6)",
                    border: `1px solid ${sim.mode === val ? "rgba(0,122,255,0.45)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-2 theme-muted">
              模拟当前时间：{modeNow.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}（{sim.mode === "off" ? "真实时间" : sim.mode === "pre5" ? "课前 5 分钟" : "课内剩 2 分钟"}）
            </p>
          </section>

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide theme-muted mb-2">📅 周次 / 星期</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => sim.setWeekOverride(Math.max(1, (sim.weekOverride ?? 18) - 1))} className="haptic-action w-9 h-9 rounded-xl text-white" style={{ background: "rgba(255,255,255,0.07)" }}>−</button>
              <span className="flex-1 text-center text-sm font-bold text-white tabular-nums">{sim.weekOverride ? `Week ${sim.weekOverride}` : "实际周次"}</span>
              <button type="button" onClick={() => sim.setWeekOverride(Math.min(18, (sim.weekOverride ?? 0) + 1))} className="haptic-action w-9 h-9 rounded-xl text-white" style={{ background: "rgba(255,255,255,0.07)" }}>＋</button>
              <button type="button" onClick={() => sim.setWeekOverride(null)} className="haptic-action px-3 py-2 rounded-lg text-[11px] font-bold theme-muted" style={{ background: "rgba(255,255,255,0.06)" }}>自动</button>
            </div>
            <p className="text-[11px] mt-1.5 theme-muted">周次会自动同步到主页标题与 Schedule 星期高亮。</p>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={sim.simulateNews} className="haptic-action py-2.5 rounded-lg text-xs font-bold" style={{ background: "rgba(48,209,88,0.12)", color: "#30D158", border: "1px solid rgba(48,209,88,0.25)" }}>
              🔔 模拟新通知
            </button>
            <button type="button" onClick={() => sim.triggerUpdateTest("optional")} className="haptic-action py-2.5 rounded-lg text-xs font-bold" style={{ background: "rgba(0,122,255,0.12)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.25)" }}>
              🔄 可选更新
            </button>
            <button type="button" onClick={() => sim.triggerUpdateTest("forced")} className="haptic-action py-2.5 rounded-lg text-xs font-bold" style={{ background: "rgba(255,69,58,0.12)", color: "#FF453A", border: "1px solid rgba(255,69,58,0.28)" }}>
              ⛔ 强制更新
            </button>
            <button type="button" onClick={sim.resetAll} className="haptic-action py-2.5 rounded-lg text-xs font-bold theme-muted" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
              ↺ 清除模拟
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
