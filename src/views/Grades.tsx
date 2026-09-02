import { useState } from "react";

const SEMESTERS = [
  {
    id: "s4",
    label: "2025–2026 · Fall",
    gpa: 3.82,
    credits: 30,
    courses: [
      { name: "Higher Mathematics II", credits: 5, grade: "A", score: 95, prof: "Bekova A.K.", ects: 5 },
      { name: "Data Structures", credits: 4, grade: "A-", score: 91, prof: "Seitkali B.M.", ects: 4 },
      { name: "Linear Algebra", credits: 4, grade: "B+", score: 87, prof: "Akhmetov N.T.", ects: 4 },
      { name: "Physics II", credits: 5, grade: "B+", score: 88, prof: "Nurlanова G.S.", ects: 5 },
      { name: "English C1", credits: 2, grade: "A", score: 97, prof: "Ivanova O.P.", ects: 2 },
    ],
  },
  {
    id: "s3",
    label: "2024–2025 · Spring",
    gpa: 3.78,
    credits: 28,
    courses: [
      { name: "Calculus", credits: 5, grade: "A", score: 94, prof: "Bekova A.K.", ects: 5 },
      { name: "Programming I", credits: 5, grade: "A+", score: 99, prof: "Seitkali B.M.", ects: 5 },
      { name: "Chemistry", credits: 4, grade: "B", score: 83, prof: "Omarov D.R.", ects: 4 },
      { name: "History of Kazakhstan", credits: 2, grade: "A", score: 96, prof: "Bekzhanova S.A.", ects: 2 },
    ],
  },
  {
    id: "s2",
    label: "2024–2025 · Fall",
    gpa: 3.70,
    credits: 30,
    courses: [
      { name: "Discrete Math", credits: 4, grade: "B+", score: 86, prof: "Mukanov A.E.", ects: 4 },
      { name: "English B2", credits: 2, grade: "A", score: 95, prof: "Ivanova O.P.", ects: 2 },
      { name: "Introduction to CS", credits: 5, grade: "A-", score: 90, prof: "Seitkali B.M.", ects: 5 },
      { name: "Physics I", credits: 5, grade: "B", score: 84, prof: "Nurlanова G.S.", ects: 5 },
    ],
  },
];

const GPA_HISTORY = [3.55, 3.62, 3.70, 3.78, 3.82];
const SEMESTERS_LABELS = ["S1", "S2", "S3", "S4", "S5*"];

function GradeChip({ grade }: { grade: string }) {
  const cls = grade.startsWith("A") ? "grade-a" : grade.startsWith("B") ? "grade-b" : grade.startsWith("C") ? "grade-c" : "grade-f";
  return (
    <span className={`${cls} px-2 py-0.5 rounded-full text-xs font-bold`} style={{ fontFamily: "JetBrains Mono" }}>
      {grade}
    </span>
  );
}

function GPAChart({ whatIfBonus }: { whatIfBonus: number }) {
  const W = 280, H = 100;
  const data = [...GPA_HISTORY, Math.min(4.0, GPA_HISTORY[GPA_HISTORY.length - 1] + whatIfBonus)];
  const labels = [...SEMESTERS_LABELS, "Pred"];
  const minV = 3.4, maxV = 4.0;
  const toX = (i: number) => 20 + (i / (data.length - 1)) * (W - 40);
  const toY = (v: number) => H - 16 - ((v - minV) / (maxV - minV)) * (H - 32);
  const pathD = data.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
  const areaD = pathD + ` L ${toX(data.length - 1)} ${H} L ${toX(0)} ${H} Z`;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="gpa-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#007AFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#007AFF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gpa-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0033A0" />
            <stop offset="80%" stopColor="#007AFF" />
            <stop offset="100%" stopColor="#30D158" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[3.5, 3.75, 4.0].map((v) => (
          <line key={v} x1={20} y1={toY(v)} x2={W - 20} y2={toY(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}
        <path d={areaD} fill="url(#gpa-fill)" />
        <path d={pathD} fill="none" stroke="url(#gpa-stroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Predicted dashed segment */}
        <line
          x1={toX(data.length - 2)} y1={toY(data[data.length - 2])}
          x2={toX(data.length - 1)} y2={toY(data[data.length - 1])}
          stroke="#30D158" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round"
        />
        {data.map((v, i) => (
          <g key={i}>
            <circle
              cx={toX(i)} cy={toY(v)} r={hoverIdx === i ? 6 : 4}
              fill={i === data.length - 1 ? "#30D158" : "#007AFF"}
              stroke="#000" strokeWidth="2"
              style={{ cursor: "pointer", transition: "r 0.15s" }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
            {hoverIdx === i && (
              <g>
                <rect x={toX(i) - 22} y={toY(v) - 28} width={44} height={20} rx={6} fill="rgba(28,28,30,0.95)" />
                <text x={toX(i)} y={toY(v) - 14} textAnchor="middle" fill="white" fontSize="10" fontWeight="600" fontFamily="JetBrains Mono">{v.toFixed(2)}</text>
              </g>
            )}
            <text x={toX(i)} y={H - 2} textAnchor="middle" fill="rgba(235,235,245,0.35)" fontSize="8.5" fontFamily="Inter">{labels[i]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function Grades() {
  const [expanded, setExpanded] = useState<string | null>("s4");
  const [whatIf, setWhatIf] = useState(0);

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#000" }}>
      <div className="px-4 pt-2 pb-32 animate-slide-up">

        {/* Header */}
        <h1 className="text-2xl font-bold text-white mb-4" style={{ letterSpacing: "-0.5px" }}>Academic Record</h1>

        {/* GPA Hero Card */}
        <div className="glass squircle-lg p-5 mb-3 card-shadow inner-glow-blue">
          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "rgba(235,235,245,0.5)" }}>CUMULATIVE GPA</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-white" style={{ fontFamily: "JetBrains Mono", letterSpacing: "-2px" }}>3.82</span>
                <span className="text-lg font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>/4.0</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158" }}>
                  ▲ Top 5%
                </div>
                <span className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>Magna Cum Laude track</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{ color: "rgba(235,235,245,0.4)" }}>Credits</p>
              <p className="text-2xl font-bold text-white" style={{ fontFamily: "JetBrains Mono" }}>88</p>
              <p className="text-xs" style={{ color: "rgba(235,235,245,0.35)" }}>of 240 ECTS</p>
            </div>
          </div>
          <GPAChart whatIfBonus={whatIf * 0.035} />
        </div>

        {/* What-If Simulator */}
        <div className="glass squircle-lg p-4 mb-3 card-shadow" style={{ border: "1px solid rgba(94,92,230,0.25)" }}>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 20 20" fill="#5E5CE6" className="w-4 h-4">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
            </svg>
            <p className="text-sm font-bold text-white">What-If GPA Simulator</p>
          </div>
          <p className="text-xs mb-3" style={{ color: "rgba(235,235,245,0.45)" }}>
            If Algorithm Analysis = <span className="font-semibold" style={{ color: "#5E5CE6" }}>{["B", "B+", "A-", "A", "A+"][whatIf]}</span>, projected GPA: <span className="font-bold text-white" style={{ fontFamily: "JetBrains Mono" }}>{(3.82 + whatIf * 0.035).toFixed(2)}</span>
          </p>
          <input
            type="range" min={0} max={4} value={whatIf}
            onChange={(e) => setWhatIf(Number(e.target.value))}
            className="w-full h-1.5 rounded-full outline-none cursor-pointer"
            style={{ accentColor: "#5E5CE6" }}
          />
          <div className="flex justify-between mt-1.5">
            {["B", "B+", "A-", "A", "A+"].map((g) => (
              <span key={g} className="text-xs" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono" }}>{g}</span>
            ))}
          </div>
          {whatIf >= 3 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.2)" }}>
              <span style={{ fontSize: 14 }}>🎓</span>
              <p className="text-xs font-semibold" style={{ color: "#30D158" }}>On track for Summa Cum Laude (≥3.9)</p>
            </div>
          )}
        </div>

        {/* Semester Accordion */}
        <p className="text-sm font-semibold mb-2.5" style={{ color: "rgba(235,235,245,0.7)" }}>Semesters</p>
        <div className="space-y-2.5">
          {SEMESTERS.map((sem) => (
            <div key={sem.id} className="glass squircle-lg overflow-hidden card-shadow">
              <button
                className="w-full flex items-center justify-between px-4 py-3.5"
                onClick={() => setExpanded(expanded === sem.id ? null : sem.id)}
              >
                <div className="text-left">
                  <p className="text-sm font-bold text-white">{sem.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{sem.credits} credits</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white" style={{ fontFamily: "JetBrains Mono" }}>{sem.gpa}</span>
                  <svg
                    viewBox="0 0 20 20" fill="white" className="w-4 h-4 transition-transform duration-200"
                    style={{ opacity: 0.4, transform: expanded === sem.id ? "rotate(180deg)" : "rotate(0)" }}
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </button>

              {expanded === sem.id && (
                <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="pt-3 space-y-2">
                    {sem.courses.map((c) => (
                      <div key={c.name} className="flex items-center gap-3 px-3 py-2.5 squircle-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.4)" }}>{c.prof} · {c.ects} ECTS</p>
                        </div>
                        <div className="text-right shrink-0">
                          <GradeChip grade={c.grade} />
                          <p className="text-xs mt-1" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono" }}>{c.score}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Floating Action Row */}
        <div className="flex gap-2.5 mt-4">
          <button className="flex-1 flex items-center justify-center gap-2 py-3.5 squircle-md font-semibold text-sm transition-opacity active:opacity-70" style={{ background: "rgba(0,122,255,0.15)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.25)" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Export PDF
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 py-3.5 squircle-md font-semibold text-sm transition-opacity active:opacity-70" style={{ background: "rgba(94,92,230,0.15)", color: "#7B79F7", border: "1px solid rgba(94,92,230,0.25)" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
            Radar Chart
          </button>
        </div>
      </div>
    </div>
  );
}
