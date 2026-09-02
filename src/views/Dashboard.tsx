import { useState } from "react";

const RADIUS = 36;
const CIRC = 2 * Math.PI * RADIUS;

function CountdownRing({ pct }: { pct: number }) {
  const offset = CIRC * (1 - pct);
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="absolute right-4 top-4">
      <circle cx="44" cy="44" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
      <circle
        cx="44" cy="44" r={RADIUS} fill="none"
        stroke="#007AFF" strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={offset}
        className="progress-ring"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="44" y="41" textAnchor="middle" fill="white" fontSize="12" fontWeight="600" fontFamily="Inter">12</text>
      <text x="44" y="53" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="Inter">MIN</text>
    </svg>
  );
}

function MiniSparkline() {
  const points = [3.55, 3.62, 3.70, 3.75, 3.78, 3.82];
  const W = 96, H = 32;
  const minV = 3.4, maxV = 4.0;
  const toX = (i: number) => (i / (points.length - 1)) * W;
  const toY = (v: number) => H - ((v - minV) / (maxV - minV)) * H;
  const pathD = points.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
  const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mt-1">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#007AFF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#007AFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spark-grad)" />
      <path d={pathD} fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={toX(points.length - 1)} cy={toY(points[points.length - 1])} r="3" fill="#007AFF" />
    </svg>
  );
}

const QUICK = [
  { icon: "🎓", label: "Grades", color: "#007AFF", bg: "rgba(0,122,255,0.15)" },
  { icon: "📅", label: "Calendar", color: "#30D158", bg: "rgba(48,209,88,0.13)" },
  { icon: "🔔", label: "Univer", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { icon: "🏠", label: "Dorm", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
];

export default function Dashboard() {
  const [pressed, setPressed] = useState<string | null>(null);

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#000" }}>
      <div className="px-4 pt-2 pb-32 space-y-3 animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>
              Week 6 · Fall 2026
            </p>
            <h1 className="text-2xl font-bold text-white mt-0.5" style={{ letterSpacing: "-0.5px" }}>
              Good morning, Aisha 👋
            </h1>
          </div>
          <div className="flex items-center gap-2.5">
            <button className="relative">
              <div className="w-8 h-8 flex items-center justify-center" style={{ color: "rgba(235,235,245,0.6)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white" style={{ fontSize: 9, fontWeight: 700, background: "#FF453A" }}>3</div>
            </button>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)", fontSize: 13 }}>
              AI
            </div>
          </div>
        </div>

        {/* Live Activity Banner */}
        <div className="live-activity squircle-md px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">Higher Mathematics II</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>Room 315 · Starts in <span className="font-bold text-white">12 min</span></p>
          </div>
          <div className="animate-pulse-glow w-2 h-2 rounded-full shrink-0" style={{ background: "#30D158", boxShadow: "0 0 6px #30D158" }} />
        </div>

        {/* Main Course Card (2x2) */}
        <div className="glass squircle-lg p-5 relative overflow-hidden card-shadow" style={{ minHeight: 160 }}>
          <div className="absolute inset-0 opacity-10" style={{ background: "linear-gradient(135deg, #0033A0 0%, transparent 60%)" }} />
          <CountdownRing pct={0.75} />
          <div className="pr-24">
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(94,92,230,0.25)", color: "#7B79F7" }}>
                LECTURE
              </div>
            </div>
            <p className="text-white font-bold text-lg leading-tight" style={{ letterSpacing: "-0.3px" }}>
              Higher Mathematics II
            </p>
            <p className="text-sm mt-1" style={{ color: "rgba(235,235,245,0.55)" }}>Prof. Bekova A.K.</p>
            <p className="text-xs mt-1 font-medium" style={{ color: "#007AFF" }}>📍 Room 315, Main Building</p>
            <button className="mt-3 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-opacity active:opacity-70" style={{ background: "rgba(0,122,255,0.2)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.3)" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Navigate
            </button>
          </div>
        </div>

        {/* Row: GPA Card + DDL Card */}
        <div className="flex gap-3">
          {/* GPA Mini Card */}
          <div className="flex-1 glass squircle-lg p-4 card-shadow inner-glow-blue">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>CUM. GPA</p>
              <div className="px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158", fontSize: 10 }}>▲ TOP 5%</div>
            </div>
            <p className="text-3xl font-bold text-white mt-1" style={{ fontFamily: "JetBrains Mono", letterSpacing: "-1px" }}>
              3.82
            </p>
            <MiniSparkline />
            <p className="text-xs mt-1" style={{ color: "rgba(235,235,245,0.4)", fontFamily: "JetBrains Mono" }}>↑ 0.04 this sem</p>
          </div>

          {/* DDL Card */}
          <div className="flex-1 glass squircle-lg p-4 card-shadow" style={{ borderLeft: "1px solid rgba(255,69,58,0.2)" }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>NEXT DDL</p>
              <span className="text-xs" style={{ color: "#FF453A" }}>⚠ 4h left</span>
            </div>
            <p className="text-sm font-bold text-white leading-tight">Data Structures</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.5)" }}>Assignment 3</p>
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,69,58,0.15)" }}>
              <div className="h-full rounded-full" style={{ width: "85%", background: "linear-gradient(90deg, #FF9F0A, #FF453A)" }} />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "rgba(235,235,245,0.4)", fontFamily: "JetBrains Mono" }}>Due 23:59 today</p>
          </div>
        </div>

        {/* Quick Actions 2x2 */}
        <div>
          <p className="text-sm font-semibold text-white mb-2.5" style={{ color: "rgba(235,235,245,0.8)" }}>Quick Access</p>
          <div className="grid grid-cols-4 gap-2.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                onMouseDown={() => setPressed(q.label)}
                onMouseUp={() => setPressed(null)}
                onMouseLeave={() => setPressed(null)}
                className="flex flex-col items-center gap-2 py-3.5 squircle-md transition-transform active:scale-95"
                style={{
                  background: pressed === q.label ? "rgba(44,44,46,0.9)" : "rgba(28,28,30,0.8)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  transform: pressed === q.label ? "scale(0.94)" : "scale(1)",
                }}
              >
                <div className="w-10 h-10 squircle-sm flex items-center justify-center text-xl" style={{ background: q.bg }}>
                  {q.icon}
                </div>
                <span className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.7)", fontSize: 11 }}>{q.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Today's Schedule Preview */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-sm font-semibold" style={{ color: "rgba(235,235,245,0.8)" }}>Today</p>
            <button className="text-xs font-medium" style={{ color: "#007AFF" }}>See All</button>
          </div>
          <div className="space-y-2">
            {[
              { time: "09:00", name: "Linear Algebra", room: "204", type: "lecture", color: "#5E5CE6", done: true },
              { time: "11:00", name: "Higher Math II", room: "315", type: "lecture", color: "#5E5CE6", done: false },
              { time: "14:00", name: "Physics Lab", room: "Lab 3", type: "lab", color: "#30D158", done: false },
              { time: "16:00", name: "English Seminar", room: "108", type: "seminar", color: "#FF9F0A", done: false },
            ].map((c) => (
              <div
                key={c.time}
                className="flex items-center gap-3 px-3.5 py-3 squircle-md"
                style={{
                  background: c.done ? "rgba(28,28,30,0.4)" : "rgba(28,28,30,0.85)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  opacity: c.done ? 0.55 : 1,
                }}
              >
                <div className="text-center shrink-0">
                  <p className="text-xs font-semibold" style={{ color: c.done ? "rgba(235,235,245,0.4)" : "rgba(235,235,245,0.55)", fontFamily: "JetBrains Mono" }}>{c.time}</p>
                </div>
                <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: c.color, opacity: c.done ? 0.4 : 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate" style={{ textDecoration: c.done ? "line-through" : "none" }}>{c.name}</p>
                  <p className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>Room {c.room} · {c.type}</p>
                </div>
                {c.done && (
                  <svg viewBox="0 0 20 20" fill="#30D158" className="w-4 h-4 shrink-0">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
