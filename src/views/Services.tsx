import { useState } from "react";

const SERVICES = [
  { icon: "📚", label: "Library", sub: "3 books checked out", color: "#007AFF", bg: "rgba(0,122,255,0.14)" },
  { icon: "🏠", label: "Dorm", sub: "Block B, Room 214", color: "#30D158", bg: "rgba(48,209,88,0.13)" },
  { icon: "💳", label: "Unicard", sub: "Balance: ₸4,200", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { icon: "🎓", label: "Scholarship", sub: "Next: Nov 5", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
  { icon: "🍽️", label: "Cafeteria", sub: "Today: Beshbarmak", color: "#FF453A", bg: "rgba(255,69,58,0.12)" },
  { icon: "⚕️", label: "Medical", sub: "No appointments", color: "#30D158", bg: "rgba(48,209,88,0.12)" },
];

const MONITORED_COURSES = [
  { name: "Machine Learning", dept: "CS", spots: 0, total: 30, watching: true },
  { name: "Big Data Analytics", dept: "CS", spots: 3, total: 25, watching: false },
  { name: "Computer Vision", dept: "CS", spots: 0, total: 20, watching: true },
];

export default function Services() {
  const [univerStatus] = useState<"ok" | "slow" | "down">("slow");
  const [barcode, setBarcode] = useState(false);
  const [watching, setWatching] = useState<Record<string, boolean>>({ "Machine Learning": true, "Computer Vision": true });

  const statusInfo = {
    ok: { color: "#30D158", label: "All systems operational", bg: "rgba(48,209,88,0.12)" },
    slow: { color: "#FF9F0A", label: "Degraded — using cache", bg: "rgba(255,159,10,0.12)" },
    down: { color: "#FF453A", label: "Offline — local cache active", bg: "rgba(255,69,58,0.12)" },
  }[univerStatus];

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#000" }}>
      <div className="px-4 pt-2 pb-32 space-y-4 animate-slide-up">

        <h1 className="text-2xl font-bold text-white" style={{ letterSpacing: "-0.5px" }}>Campus Hub</h1>

        {/* Univer Status */}
        <div className="glass squircle-lg p-4 card-shadow" style={{ border: `1px solid ${statusInfo.color}30` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="animate-pulse-glow status-dot" style={{ background: statusInfo.color, color: statusInfo.color }} />
              <div>
                <p className="text-sm font-bold text-white">Univer System</p>
                <p className="text-xs mt-0.5" style={{ color: statusInfo.color }}>{statusInfo.label}</p>
              </div>
            </div>
            <button className="px-3 py-1.5 squircle-sm text-xs font-semibold" style={{ background: "rgba(0,122,255,0.15)", color: "#407AFF" }}>
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {[
              { label: "Schedule", ok: true },
              { label: "Grades", ok: true },
              { label: "Registration", ok: false },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-1.5 py-2 squircle-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.ok ? "#30D158" : "#FF9F0A", boxShadow: `0 0 4px ${item.ok ? "#30D158" : "#FF9F0A"}` }} />
                <p className="text-xs" style={{ color: "rgba(235,235,245,0.6)" }}>{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Library Barcode Card */}
        <div className="glass squircle-lg overflow-hidden card-shadow">
          <button
            className="w-full flex items-center justify-between px-4 py-4"
            onClick={() => setBarcode(!barcode)}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 squircle-sm flex items-center justify-center text-xl" style={{ background: "rgba(0,122,255,0.15)" }}>
                📚
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">Library Card</p>
                <p className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>Tap to show barcode</p>
              </div>
            </div>
            <div className="px-2 py-1 squircle-xs text-xs font-semibold" style={{ background: "rgba(0,122,255,0.15)", color: "#407AFF" }}>
              {barcode ? "Hide" : "Show"}
            </div>
          </button>

          {barcode && (
            <div className="px-4 pb-5 flex flex-col items-center">
              <div className="w-full py-4 squircle-md flex flex-col items-center gap-2" style={{ background: "white" }}>
                <div className="flex gap-0.5 h-14">
                  {Array.from({ length: 56 }, (_, i) => (
                    <div key={i} className="rounded-sm" style={{ width: Math.random() > 0.5 ? 3 : 2, background: "#000", opacity: Math.random() > 0.3 ? 1 : 0.3 }} />
                  ))}
                </div>
                <p className="text-xs font-bold text-black" style={{ fontFamily: "JetBrains Mono", letterSpacing: "0.2em" }}>
                  KZ-2024-058-7821
                </p>
              </div>
              <p className="text-xs mt-2.5 text-center" style={{ color: "rgba(235,235,245,0.4)" }}>
                Aisha Bekova · Faculty of Computer Science
              </p>
            </div>
          )}
        </div>

        {/* Dorm Utilities */}
        <div className="glass squircle-lg p-4 card-shadow">
          <p className="text-sm font-bold text-white mb-3">Dorm Utilities — Block B, Rm 214</p>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { icon: "⚡", label: "Electricity", value: "₸840", sub: "balance", color: "#FF9F0A" },
              { icon: "💧", label: "Water", value: "OK", sub: "no issues", color: "#007AFF" },
              { icon: "🌐", label: "Internet", value: "98%", sub: "uptime", color: "#30D158" },
            ].map((u) => (
              <div key={u.label} className="flex flex-col items-center gap-1.5 py-3 squircle-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 22 }}>{u.icon}</span>
                <p className="text-sm font-bold" style={{ color: u.color, fontFamily: "JetBrains Mono" }}>{u.value}</p>
                <p className="text-xs" style={{ color: "rgba(235,235,245,0.4)" }}>{u.sub}</p>
              </div>
            ))}
          </div>
          <button className="w-full mt-3 py-2.5 squircle-sm text-sm font-semibold" style={{ background: "rgba(255,159,10,0.12)", color: "#FF9F0A", border: "1px solid rgba(255,159,10,0.2)" }}>
            Top Up Electricity →
          </button>
        </div>

        {/* Course Radar */}
        <div className="glass squircle-lg p-4 card-shadow">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-white">Course Radar</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>Live spot monitoring</p>
            </div>
            <div className="px-2 py-1 squircle-xs flex items-center gap-1.5" style={{ background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.2)" }}>
              <div className="animate-pulse-glow w-1.5 h-1.5 rounded-full" style={{ background: "#30D158" }} />
              <span className="text-xs font-semibold" style={{ color: "#30D158" }}>Watching</span>
            </div>
          </div>

          <div className="space-y-2">
            {MONITORED_COURSES.map((c) => {
              const isWatching = watching[c.name];
              return (
                <div key={c.name} className="flex items-center gap-3 px-3 py-2.5 squircle-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs" style={{ color: c.spots === 0 ? "#FF453A" : "#30D158", fontFamily: "JetBrains Mono" }}>
                        {c.spots === 0 ? "Full" : `${c.spots} spots`}
                      </span>
                      <span className="text-xs" style={{ color: "rgba(235,235,245,0.35)" }}>of {c.total}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setWatching((w) => ({ ...w, [c.name]: !w[c.name] }))}
                    className="px-2.5 py-1 squircle-xs text-xs font-semibold transition-all"
                    style={{
                      background: isWatching ? "rgba(0,122,255,0.2)" : "rgba(255,255,255,0.08)",
                      color: isWatching ? "#407AFF" : "rgba(235,235,245,0.5)",
                      border: `1px solid ${isWatching ? "rgba(0,122,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    {isWatching ? "🔔 On" : "🔕 Off"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Services Grid */}
        <div>
          <p className="text-sm font-semibold mb-2.5" style={{ color: "rgba(235,235,245,0.7)" }}>All Services</p>
          <div className="grid grid-cols-3 gap-2.5">
            {SERVICES.map((s) => (
              <button key={s.label} className="flex flex-col items-center gap-2 py-4 squircle-md transition-transform active:scale-95" style={{ background: "rgba(28,28,30,0.85)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="w-11 h-11 squircle-md flex items-center justify-center text-2xl" style={{ background: s.bg }}>
                  {s.icon}
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-white">{s.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.4)", fontSize: 10 }}>{s.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
