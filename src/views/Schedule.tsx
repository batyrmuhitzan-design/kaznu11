import { useState, useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useI18n } from "../contexts/LanguageContext";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DATES = [1, 2, 3, 4, 5, 6];
const TODAY = 1; // Monday

type CourseType = "lecture" | "lab" | "exam" | "seminar";

interface Course {
  id: string;
  name: string;
  short?: string;
  room: string;
  prof: string;
  type: CourseType;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  conflict?: boolean;
}

const GET_TYPE_STYLE = (type: CourseType, isDark: boolean) => {
  const styles: Record<CourseType, { color: string; bg: string; label: string }> = {
    lecture: {
      color: isDark ? "#5E5CE6" : "#4F46E5",
      bg: isDark ? "rgba(94,92,230,0.18)" : "rgba(79,70,229,0.08)",
      label: "Lecture",
    },
    lab: {
      color: isDark ? "#30D158" : "#16A34A",
      bg: isDark ? "rgba(48,209,88,0.15)" : "rgba(22,163,74,0.08)",
      label: "Lab",
    },
    exam: {
      color: isDark ? "#FF453A" : "#DC2626",
      bg: isDark ? "rgba(255,69,58,0.15)" : "rgba(220,38,38,0.08)",
      label: "Exam",
    },
    seminar: {
      color: isDark ? "#FF9F0A" : "#D97706",
      bg: isDark ? "rgba(255,159,10,0.15)" : "rgba(217,119,6,0.08)",
      label: "Seminar",
    },
  };
  return styles[type] || styles.lecture;
};

const MOCK_FALLBACK: Record<number, Course[]> = {
  0: [
    { id: "c1", name: "Linear Algebra", short: "LinAlg", room: "204", prof: "Akhmetov N.T.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30 },
    { id: "c2", name: "Higher Math II", short: "HM2", room: "315", prof: "Bekova A.K.", type: "lecture", startH: 11, startM: 0, endH: 12, endM: 30 },
  ],
  1: [
    { id: "c5", name: "Data Structures", short: "DS", room: "301", prof: "Seitkali B.M.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30 },
  ],
};

const START_H = 8;
const END_H = 20;
const TOTAL_MINS = (END_H - START_H) * 60;
const PX_PER_MIN = 1.6;

const NOW_H = 11;
const NOW_M = 0;

function timeToY(h: number, m: number) {
  return ((h - START_H) * 60 + m) * PX_PER_MIN;
}

function CourseCard({ course, isDark }: { course: Course; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = useI18n();
  const s = GET_TYPE_STYLE(course.type, isDark);
  const durationMins = (course.endH - course.startH) * 60 + (course.endM - course.startM);
  const top = timeToY(course.startH, course.startM);
  const height = durationMins * PX_PER_MIN;

  return (
    <div
      className="absolute left-14 right-2 squircle-sm overflow-hidden transition-all duration-200"
      style={{
        top,
        height,
        background: s.bg,
        borderLeft: `3px solid ${s.color}`,
        border: course.conflict ? `2px solid ${s.color}` : undefined,
        boxShadow: expanded ? `0 4px 20px ${s.color}30` : undefined,
        cursor: "pointer",
        zIndex: expanded ? 10 : 1,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="px-2.5 py-1.5 h-full flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-1">
            <p className={`text-xs font-bold leading-tight truncate ${isDark ? "text-white" : "text-slate-900"}`}>
              {course.name}
            </p>
            <span className="text-xs font-semibold shrink-0" style={{ color: s.color, fontSize: 9 }}>
              {course.type === "lecture" ? t("lecture") : course.type === "lab" ? t("lab") : course.type === "exam" ? t("exam") : t("seminar")}
            </span>
          </div>
          {height > 50 && (
            <p className={`text-xs mt-0.5 truncate ${isDark ? "text-slate-400" : "text-slate-500"}`} style={{ fontSize: 10 }}>
              {course.room} · {course.prof ? course.prof.split(" ")[0] : ""}
            </p>
          )}
        </div>
        {height > 70 && (
          <div className="flex items-center justify-between">
            <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`} style={{ fontFamily: "JetBrains Mono", fontSize: 9 }}>
              {`${course.startH.toString().padStart(2, "0")}:${course.startM.toString().padStart(2, "0")}–${course.endH.toString().padStart(2, "0")}:${course.endM.toString().padStart(2, "0")}`}
            </p>
            <div className="px-1.5 py-0.5 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: "rgba(48,209,88,0.15)", color: isDark ? "#30D158" : "#16A34A", fontSize: 9 }}>
              ✓ {t("present")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Schedule() {
  const { resolvedTheme } = useTheme();
  const t = useI18n();
  const isDark = resolvedTheme === "dark";
  const [selectedDay, setSelectedDay] = useState(0);
  const [coursesByDay, setCoursesByDay] = useState<Record<number, Course[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/v1/schedule?student_id=20260001")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === "object" && !Array.isArray(data) && data.schedule) {
          setCoursesByDay(data);
        } else if (data && typeof data === "object" && !Array.isArray(data)) {
          setCoursesByDay(data);
        } else {
          setCoursesByDay(MOCK_FALLBACK);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn("未连接到 API 后端，使用本地备用课表:", err);
        setCoursesByDay(MOCK_FALLBACK);
        setLoading(false);
      });
  }, []);

  const courses = coursesByDay[selectedDay] || [];
  const nowY = timeToY(NOW_H, NOW_M);

  const theme = {
    bg: isDark ? "#000000" : "#F2F2F7",
    headerText: isDark ? "text-white" : "text-slate-900",
    weekBtnBg: isDark ? "rgba(28,28,30,0.8)" : "rgba(255,255,255,0.8)",
    weekBtnBorder: isDark ? "transparent" : "rgba(0,0,0,0.05)",
    weekBtnText: isDark ? "rgba(235,235,245,0.45)" : "rgba(60,60,67,0.6)",
    weekBtnNum: isDark ? "rgba(235,235,245,0.7)" : "rgba(60,60,67,0.9)",
    gridLine: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)",
    hourText: isDark ? "rgba(235,235,245,0.28)" : "#8E8E93",
    emptyText: isDark ? "rgba(235,235,245,0.35)" : "rgba(60,60,67,0.45)",
  };

  return (
    <div className="h-full flex flex-col overflow-hidden transition-colors duration-300" style={{ background: theme.bg }}>
      {/* Header */}
      <div className="px-4 pt-2 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className={`text-2xl font-bold ${theme.headerText}`} style={{ letterSpacing: "-0.5px" }}>
            {t("schedule")}
          </h1>

        </div>

        {/* Week Strip */}
        <div className="flex gap-1.5">
          {DAYS.map((day, i) => {
            const active = i === selectedDay;
            const isToday = i === TODAY;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(i)}
                className="haptic-action flex-1 flex flex-col items-center py-2 squircle-sm transition-all duration-200"
                style={{
                  background: active ? "#007AFF" : theme.weekBtnBg,
                  border: isToday && !active ? "1px solid #007AFF" : `1px solid ${theme.weekBtnBorder}`,
                  boxShadow: !isDark && !active ? "0 2px 8px rgba(0,0,0,0.04)" : "none",
                }}
              >
                <span className="text-xs font-medium" style={{ color: active ? "rgba(255,255,255,0.8)" : theme.weekBtnText, fontSize: 10 }}>{t(day)}</span>
                <span className="text-sm font-bold mt-0.5" style={{ color: active ? "white" : isToday ? "#007AFF" : theme.weekBtnNum }}>{DATES[i]}</span>
                {(coursesByDay[i]?.length || 0) > 0 && (
                  <div className="mt-1 w-1 h-1 rounded-full" style={{ background: active ? "rgba(255,255,255,0.8)" : "#007AFF" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        <div className="relative" style={{ height: TOTAL_MINS * PX_PER_MIN + 32, margin: "0 16px" }}>
          {/* Hour labels & lines */}
          {Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i).map((h) => (
            <div key={h} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: timeToY(h, 0) }}>
              <span className="text-xs w-11 text-right shrink-0 font-mono" style={{ color: theme.hourText, fontSize: 10 }}>
                {h.toString().padStart(2, "0")}:00
              </span>
              <div className="flex-1 h-px" style={{ background: theme.gridLine }} />
            </div>
          ))}

          {/* Current time needle */}
          {selectedDay === TODAY && (
            <div className="absolute left-0 right-0 flex items-center gap-2 z-20" style={{ top: nowY }}>
              <span className="text-xs w-11 text-right shrink-0 font-semibold" style={{ color: "#FF453A", fontFamily: "JetBrains Mono", fontSize: 10 }}>NOW</span>
              <div className="flex-1 h-0.5 bg-red-500" />
              <div className="w-2 h-2 rounded-full shrink-0 bg-red-500 shadow-md" />
            </div>
          )}

          {/* Course Cards */}
          {loading ? (
            <div className={`absolute inset-0 flex items-center justify-center text-xs ${theme.emptyText}`}>
              {t("syncing")}
            </div>
          ) : (
            courses.map((c) => <CourseCard key={c.id} course={c} isDark={isDark} />)
          )}

          {!loading && courses.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="text-4xl opacity-30">🌿</div>
              <p className="text-sm font-medium" style={{ color: theme.emptyText }}>{t("noClasses")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}