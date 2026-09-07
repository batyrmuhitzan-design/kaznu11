import { useEffect, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { hapticSuccess, hapticError } from "../utils/haptics";
import { AnimatedNumber, AnimatedBar, useCountUp } from "../utils/motion";
import { API_URLS } from "../utils/config";
import { readSession } from "../utils/session";
import {
  isNative,
  createTranscriptPdf,
  exportPdfForSharing,
  shareNativeFile,
  downloadBase64OnWeb,
} from "../native/fileExport";

const GPA_API = API_URLS.gpa;

const TOTAL_ECTS = 240;
const EARNED_ECTS = 88;
const CUM_GPA = 3.82;
const REMAINING_SEMS = 5;

const GRAD_TARGETS = [
  { id: "pass", labelKey: "justGraduate", min: 2.0, color: "#30D158" },
  { id: "magna", labelKey: "magna", min: 3.7, color: "#409CFF" },
  { id: "summa", labelKey: "summa", min: 3.9, color: "#FF9F0A" },
] as const;
type TargetId = (typeof GRAD_TARGETS)[number]["id"];

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
      { name: "Physics II", credits: 5, grade: "B+", score: 88, prof: "Nurlanova G.S.", ects: 5 },
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
    gpa: 3.7,
    credits: 30,
    courses: [
      { name: "Discrete Math", credits: 4, grade: "B+", score: 86, prof: "Mukanov A.E.", ects: 4 },
      { name: "English B2", credits: 2, grade: "A", score: 95, prof: "Ivanova O.P.", ects: 2 },
      { name: "Introduction to CS", credits: 5, grade: "A-", score: 90, prof: "Seitkali B.M.", ects: 5 },
      { name: "Physics I", credits: 5, grade: "B", score: 84, prof: "Nurlanova G.S.", ects: 5 },
    ],
  },
];

const GPA_HISTORY = [3.55, 3.62, 3.7, 3.78, 3.82];
const SEMESTERS_LABELS = ["S1", "S2", "S3", "S4", "S5*"];

/** 反推：若要毕业时总GPA ≥ target，剩余学分平均需要拿到多少。 */
function neededFutureGpa(targetGpa: number, earned = EARNED_ECTS, total = TOTAL_ECTS, currentGpa = CUM_GPA) {
  const remaining = Math.max(1, total - earned);
  return (targetGpa * total - currentGpa * earned) / remaining;
}

function GradeChip({ grade }: { grade: string }) {
  const cls = grade.startsWith("A") ? "grade-a" : grade.startsWith("B") ? "grade-b" : grade.startsWith("C") ? "grade-c" : "grade-f";
  return (
    <span className={`${cls} px-2 py-0.5 rounded-full text-xs font-bold`} style={{ fontFamily: "JetBrains Mono" }}>
      {grade}
    </span>
  );
}

/** 0→4.0 线性量尺：随动画从低处涨到 GPA 位置。 */
function GpaMeter({ value, color: _color = "#007AFF", height = 7, showLabels = true }: { value: number; color?: string; height?: number; showLabels?: boolean }) {
  const pct = Math.min(100, Math.max(0, (value / 4) * 100));
  const w = useCountUp(pct, { duration: 1500, delay: 250 });
  // 纯色进度：随增长整根填充条 红 → 橙 → 绿
  const hue = Math.min(125, Math.max(0, w * 1.25));
  const fillColor = `hsl(${hue}, 92%, 58%)`;
  return (
    <div>
      <div className="relative w-full rounded-full overflow-hidden meter-track" style={{ height }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${w}%`,
            background: fillColor,
            boxShadow: `0 0 10px ${fillColor}`,
          }}
        />
        <div
          className="absolute top-1/2 w-1 h-1 rounded-full bg-white"
          style={{ left: `calc(${w}% - 2px)`, transform: "translateY(-50%)", boxShadow: "0 0 6px rgba(255,255,255,0.8)" }}
        />
      </div>
      {showLabels && (
        <div className="flex justify-between mt-1 px-0.5">
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className="text-[9px]" style={{ color: "rgba(235,235,245,0.4)", fontFamily: "JetBrains Mono" }}>
              {n}.0
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GPAChart({ whatIfBonus }: { whatIfBonus: number }) {
  const W = 280, H = 92;
  const data = [...GPA_HISTORY, Math.min(4.0, GPA_HISTORY[GPA_HISTORY.length - 1] + whatIfBonus)];
  const labels = [...SEMESTERS_LABELS, "Pred"];
  const minV = 3.4, maxV = 4.0;
  const toX = (i: number) => 20 + (i / (data.length - 1)) * (W - 40);
  const toY = (v: number) => H - 14 - ((v - minV) / (maxV - minV)) * (H - 30);
  const pathD = data.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
  const areaD = pathD + ` L ${toX(data.length - 1)} ${H} L ${toX(0)} ${H} Z`;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [draw, setDraw] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDraw(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
        {[3.5, 3.75, 4.0].map((v) => (
          <line key={v} x1={20} y1={toY(v)} x2={W - 20} y2={toY(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}
        <path d={areaD} fill="url(#gpa-fill)" style={{ opacity: draw ? 1 : 0, transition: "opacity .6s ease .5s" }} />
        <path
          d={pathD}
          fill="none"
          stroke="url(#gpa-stroke)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          style={{ strokeDasharray: 1, strokeDashoffset: draw ? 0 : 1, transition: "stroke-dashoffset 1.1s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
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
              style={{ cursor: "pointer", transition: "r 0.15s", opacity: draw ? 1 : 0 }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
            {hoverIdx === i && (
              <g>
                <rect x={toX(i) - 22} y={toY(v) - 27} width={44} height={19} rx={6} fill="rgba(28,28,30,0.95)" />
                <text x={toX(i)} y={toY(v) - 14} textAnchor="middle" fill="white" fontSize="10" fontWeight="600" fontFamily="JetBrains Mono">{v.toFixed(2)}</text>
              </g>
            )}
            <text x={toX(i)} y={H - 1} textAnchor="middle" fill="rgba(235,235,245,0.35)" fontSize="8.5" fontFamily="Inter">{labels[i]}</text>
          </g>
        ))}
      </svg>

    </div>
  );
}


export default function Grades({ onBack }: { onBack?: () => void }) {
  const [expanded, setExpanded] = useState<string | null>("s4");
  const [whatIf, setWhatIf] = useState(0);
  const [target, setTarget] = useState<TargetId>("magna");
  const [gpaData, setGpaData] = useState<{ gpa: number; change: number; rank: string }>({ gpa: CUM_GPA, change: 0.04, rank: "top 5%" });
  const [ects, setEcts] = useState({ earned: EARNED_ECTS, total: TOTAL_ECTS });
  const [exporting, setExporting] = useState(false);
  const t = useI18n();
  const toast = useToast();

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    toast.push("正在生成 PDF…", "info");
    try {
      // 让 Spinner 先绘制出来，再做真实 CPU 排版
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));

      const session = readSession();
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      const fileName = `KazNU_Academic_Record_${stamp}.pdf`;

      // 1) 用当前页面 GPA/荣誉/各学期成绩动态生成标准 PDF
      const base64 = createTranscriptPdf({
        studentName: session?.displayName,
        studentId: session?.studentId,
        cumulativeGpa: gpaData.gpa,
        honor: honorNow,
        rank: gpaData.rank,
        earnedEcts: ects.earned,
        totalEcts: ects.total,
        semesters: SEMESTERS.map((sem) => ({
          label: sem.label,
          gpa: sem.gpa,
          credits: sem.credits,
          courses: sem.courses.map((c) => ({
            name: c.name,
            grade: c.grade,
            score: c.score,
            ects: c.ects,
          })),
        })),
      });

      if (isNative()) {
        // 2) 原生：写入 Cache 临时目录 → 自动弹出系统 iOS Share Sheet（保存到“文件”/发送/打印）
        const saved = await exportPdfForSharing(base64, fileName);
        void hapticSuccess();
        toast.push("成绩单 PDF 已生成，选择保存位置或发送", "success");
        try {
          await shareNativeFile(saved.uri, {
            title: "KazNU Academic Record",
            text: `GPA ${gpaData.gpa.toFixed(2)} / 4.0 — generated by KazNU Helper`,
          });
          void hapticSuccess();
        } catch {
          /* 用户关闭了系统分享面板，PDF 仍保留在临时目录 */
        }
      } else {
        // Web 预览：真实浏览器下载
        downloadBase64OnWeb(base64, fileName);
        void hapticSuccess();
        toast.push(`成绩单 PDF 已导出 · ${fileName}`, "success");
      }
    } catch {
      void hapticError();
      toast.push("PDF 导出失败，请重试", "error");
    } finally {
      setExporting(false);
    }
  };

  const handleRadar = () => {
    toast.push("雷达图分析即将上线", "info");
  };

  useEffect(() => {
    fetch(GPA_API)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("gpa request failed"))))
      .then((d) => {
        if (d && typeof d.gpa === "number") {
          setGpaData({ gpa: d.gpa, change: d.change ?? 0.04, rank: d.rank ?? "top 5%" });
        }
      })
      .catch(() => undefined);
  }, []);

  const targetDef = GRAD_TARGETS.find((x) => x.id === target) ?? GRAD_TARGETS[1];
  const remaining = Math.max(0, ects.total - ects.earned);
  const needed = neededFutureGpa(targetDef.min, ects.earned, ects.total, gpaData.gpa);
  const unreachable = needed > 4.02;
  const tight = !unreachable && needed > gpaData.gpa;

  const honorNow =
    gpaData.gpa >= 3.9 ? t("summa") : gpaData.gpa >= 3.7 ? t("magna") : gpaData.gpa >= 3.5 ? "Cum Laude" : t("justGraduate");

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1">
          {onBack && (
            <button type="button" onClick={onBack} className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold mb-2">
              <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {t("back")}
            </button>
          )}
          <h1 className="text-2xl font-bold text-white mt-0.5" style={{ letterSpacing: "-0.5px" }}>{t("academicRecord")}</h1>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 animate-slide-up">

        {/* GPA Hero Card */}
        <div className="glass squircle-lg p-5 mb-3 card-shadow inner-glow-blue">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium mb-1" style={{ color: "rgba(235,235,245,0.5)" }}>{t("cumulativeGpa")}</p>
              <div className="flex items-baseline gap-2">
                <AnimatedNumber value={gpaData.gpa} decimals={2} duration={1600} className="gpa-grow text-5xl font-bold text-white" style={{ fontFamily: "JetBrains Mono", letterSpacing: "-2px" }} />
                <span className="text-lg font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>/4.0</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <div className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158" }}>
                  ▲ {gpaData.rank}
                </div>
                <span className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>{honorNow} {t("track")}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs" style={{ color: "rgba(235,235,245,0.4)" }}>{t("credits")}</p>
              <AnimatedNumber value={ects.earned} duration={1600} delay={200} className="text-2xl font-bold text-white" style={{ fontFamily: "JetBrains Mono" }} />
              <p className="text-xs" style={{ color: "rgba(235,235,245,0.35)" }}>{t("of")} {ects.total} ECTS</p>
            </div>
          </div>

          {/* 0 → GPA 的线性量尺 */}
          <div className="mt-4">
            <GpaMeter value={gpaData.gpa} />
          </div>

          <div className="mt-4">
            <GPAChart whatIfBonus={whatIf * 0.035} />
          </div>
        </div>

        {/* Graduation Plan: 按学校学分制预算 */}
        <div className="glass squircle-lg p-4 mb-3 card-shadow" style={{ border: `1px solid ${targetDef.color}33` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 15 }}>🎯</span>
              <p className="text-sm font-bold text-white">{t("degreePlan")}</p>
            </div>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: `${targetDef.color}1f`, color: targetDef.color }}>
              {ects.earned}/{ects.total} ECTS
            </span>
          </div>

          {/* 目标标准选择 */}
          <div className="flex gap-1.5 mb-4 p-1 squircle-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
            {GRAD_TARGETS.map((g) => {
              const active = target === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTarget(g.id)}
                  className="haptic-action flex-1 text-center py-2 squircle-xs text-xs font-semibold transition-all"
                  style={{
                    background: active ? g.color : "transparent",
                    color: active ? "#fff" : "rgba(235,235,245,0.6)",
                    border: `1px solid ${active ? g.color : "rgba(255,255,255,0.07)"}`,
                  }}
                >
                  {t(g.labelKey)}
                  <span className="block text-[9px] opacity-80" style={{ fontFamily: "JetBrains Mono" }}>≥ {g.min.toFixed(1)}</span>
                </button>
              );
            })}
          </div>

          {/* 反推结果 */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="px-2 py-2 squircle-sm text-center" style={{ background: `${targetDef.color}14`, border: `1px solid ${targetDef.color}26` }}>
              <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{t("targetStandard")} GPA</p>
              <p className="text-lg font-bold" style={{ color: targetDef.color, fontFamily: "JetBrains Mono" }}>{targetDef.min.toFixed(1)}</p>
            </div>
            <div className="px-2 py-2 squircle-sm text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
              <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{t("futureAvg")}</p>
              {unreachable ? (
                <p className="text-lg font-bold" style={{ color: "#FF453A", fontFamily: "JetBrains Mono" }}>—</p>
              ) : (
                <AnimatedNumber value={Math.max(0, needed)} decimals={2} duration={1500} delay={150} className="text-lg font-bold text-white" style={{ fontFamily: "JetBrains Mono" }} />
              )}
            </div>
            <div className="px-2 py-2 squircle-sm text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
              <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{t("ectsLeft")}</p>
              <p className="text-lg font-bold text-white" style={{ fontFamily: "JetBrains Mono" }}>{remaining}</p>
            </div>
          </div>

          {/* 剩余学分内需达到的 GPA 进度 */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-[10px] mb-1.5">
              <span className="font-semibold" style={{ color: "rgba(235,235,245,0.6)" }}>
                {t("needsPerfect")} · {t("avgPerSem")}
              </span>
              <span style={{ color: targetDef.color, fontFamily: "JetBrains Mono" }}>≈ {Math.max(0, Math.min(4, needed)).toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden meter-track">
              <AnimatedBar value={unreachable ? 100 : (needed / 4) * 100} duration={1500} delay={250} className="h-full" style={{ background: targetDef.color, borderRadius: 999 }} />
            </div>
          </div>

          {/* 状态提示 */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: unreachable ? "rgba(255,69,58,0.1)" : tight ? "rgba(255,159,10,0.1)" : "rgba(48,209,88,0.12)", border: `1px solid ${unreachable ? "rgba(255,69,58,0.25)" : tight ? "rgba(255,159,10,0.22)" : "rgba(48,209,88,0.22)"}` }}>
            <span style={{ fontSize: 14 }}>{unreachable ? "🚫" : tight ? "🔥" : "✅"}</span>
            <p className="text-xs font-semibold" style={{ color: unreachable ? "#FF453A" : tight ? "#FF9F0A" : "#30D158" }}>
              {unreachable ? `${t("needsPerfect")} > 4.0` : tight ? `${t("needsPerfect")} · ≥ ${needed.toFixed(2)}` : t("reachable")}
            </p>
          </div>
        </div>

        {/* What-If Simulator */}
        <div className="glass squircle-lg p-4 mb-3 card-shadow" style={{ border: "1px solid rgba(94,92,230,0.25)" }}>
          <div className="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 20 20" fill="#5E5CE6" className="w-4 h-4">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
            </svg>
            <p className="text-sm font-bold text-white">{t("whatIf")}</p>
          </div>
          <p className="text-xs mb-3" style={{ color: "rgba(235,235,245,0.45)" }}>
            {t("ifAlgorithm")} = <span className="font-semibold" style={{ color: "#5E5CE6" }}>{["B", "B+", "A-", "A", "A+"][whatIf]}</span>, {t("projectedGpa")}:{" "}
            <AnimatedNumber value={Math.min(4, gpaData.gpa + whatIf * 0.035)} decimals={2} duration={600} className="font-bold text-white" style={{ fontFamily: "JetBrains Mono" }} />
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

              <p className="text-xs font-semibold" style={{ color: "#30D158" }}>{t("onTrack")} (≥3.9)</p>
            </div>
          )}
        </div>

        {/* Semester Accordion */}
        <p className="text-sm font-semibold mb-2.5 mt-1" style={{ color: "rgba(235,235,245,0.7)" }}>{t("semesters")}</p>
        <div className="space-y-2.5">
          {SEMESTERS.map((sem) => {
            const open = expanded === sem.id;
            return (
              <div key={sem.id} className="glass squircle-lg overflow-hidden card-shadow">
                <button
                  type="button"
                  aria-expanded={open}
                  className="haptic-action w-full flex items-center justify-between px-4 py-3.5"
                  onClick={() => setExpanded(open ? null : sem.id)}
                >
                  <div className="text-left min-w-0">
                    <p className="text-sm font-bold text-white">{sem.label}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>{sem.credits} {t("credits")}</span>
                      <div className="w-16 shrink-0"><GpaMeter value={sem.gpa} height={3} showLabels={false} /></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <AnimatedNumber value={sem.gpa} decimals={2} duration={900} className="text-lg font-bold text-white" style={{ fontFamily: "JetBrains Mono" }} />
                    <svg
                      viewBox="0 0 20 20" fill="white" className="w-4 h-4"
                      style={{ opacity: 0.4, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                </button>

                <div className={`collapsible ${open ? "collapsible-open" : ""}`}>
                  <div className="collapsible-inner">
                    <div className="px-4 pb-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="pt-3 space-y-2">
                        {sem.courses.map((c, i) => (
                          <div
                            key={c.name}
                            className="course-row-in flex items-center gap-3 px-3 py-2.5 squircle-sm"
                            style={{ background: "rgba(255,255,255,0.04)", animationDelay: `${i * 55}ms` }}
                          >
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Floating Action Row */}
        <div className="flex gap-2.5 mt-4">
          <button type="button" onClick={handleExportPdf} disabled={exporting} data-action="export" data-haptic="heavy" className="haptic-action flex-1 flex items-center justify-center gap-2 py-3.5 squircle-md font-semibold text-sm transition-opacity active:opacity-70 disabled:opacity-50" style={{ background: "rgba(0,122,255,0.15)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.25)" }}>
            {exporting ? (
              <>
                <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#409CFF", borderTopColor: "transparent" }} />
                ……
              </>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
            {exporting ? "Generating…" : t("exportPdf")}
          </button>
          <button type="button" onClick={handleRadar} className="haptic-action flex-1 flex items-center justify-center gap-2 py-3.5 squircle-md font-semibold text-sm transition-opacity active:opacity-70" style={{ background: "rgba(94,92,230,0.15)", color: "#7B79F7", border: "1px solid rgba(94,92,230,0.25)" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
            {t("radarChart")}
          </button>
        </div>
      </div>
    </div>
  );
}
