import { useState, useEffect, useMemo } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useI18n } from "../contexts/LanguageContext";
import { tr } from "../utils/locale";
import { API_URLS, STUDENT_ID } from "../utils/config";
import { academicWeekOf, datesOfThisWeek, nowMinutes, todayWeekdayIndex, ACADEMIC_YEAR } from "../utils/calendar";
import { courseStatusFromTime } from "../utils/courseStatus";
import { scheduleClassReminders, type ClassLessonInput } from "../native/notifications";
import {
  scheduleUpcomingClassReminders,
  syncTimetableLiveActivity,
  registerReminderLessons,
  type CourseReminderLesson,
} from "../services/CourseReminderService";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

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

/** 把按星期分组的课表数据展开成 CourseReminderService 需要的扁平课程列表。 */
function toReminderLessons(data: Record<string, unknown>): CourseReminderLesson[] {
  const lessons: CourseReminderLesson[] = [];
  Object.entries(data ?? {}).forEach(([key, list]) => {
    const weekday = Number(key);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Array.isArray(list)) return;
    (list as Array<Partial<Course> & { id?: string }>).forEach((course, index) => {
      if (!course.name) return;
      lessons.push({
        id: course.id ?? `${key}-${index}-${course.name}`,
        name: course.name,
        short: course.short,
        type: course.type ?? "lecture",
        room: course.room ?? "",
        prof: course.prof ?? "",
        weekday,
        startH: course.startH ?? 9,
        startM: course.startM ?? 0,
        endH: course.endH ?? (course.startH ?? 9) + 1,
        endM: course.endM ?? 30,
      });
    });
  });
  return lessons;
}

const START_H = 8;
const END_H = 20;
const TOTAL_MINS = (END_H - START_H) * 60;
const PX_PER_MIN = 1.6;

const NOW_H = 11;
const NOW_M = 0;

function timeToY(h: number, m: number) {
  return ((h - START_H) * 60 + m) * PX_PER_MIN;
}

function CourseCard({
  course,
  isDark,
  isToday,
  nowH,
  nowM,
  onOpen,
}: {
  course: Course;
  isDark: boolean;
  isToday: boolean;
  nowH: number;
  nowM: number;
  onOpen: (course: Course) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useI18n();
  const s = GET_TYPE_STYLE(course.type, isDark);
  const durationMins = (course.endH - course.startH) * 60 + (course.endM - course.startM);
  const top = timeToY(course.startH, course.startM);
  const height = durationMins * PX_PER_MIN;

  // 与首页“Today / Бүгін”共用同一套状态计算：
  // 仅“今天”的课程参与判断；已结束的变淡，正在上课的高亮。
  const status = isToday
    ? courseStatusFromTime(nowH * 60 + nowM, course.startH, course.startM, course.endH, course.endM)
    : "upcoming";
  const isPastNow = status === "completed";
  const isLiveNow = status === "in-progress";

  return (
    <div
      className="absolute left-14 right-2 squircle-sm overflow-hidden transition-all duration-200"
      style={{
        top,
        height,
        background: s.bg,
        borderLeft: isLiveNow ? "3px solid #30D158" : `3px solid ${s.color}`,
        border: course.conflict ? `2px solid ${s.color}` : undefined,
        boxShadow: expanded
          ? `0 4px 20px ${s.color}30`
          : isLiveNow
            ? "0 0 0 1px rgba(48,209,88,0.35), 0 4px 16px rgba(48,209,88,0.18)"
            : undefined,
        opacity: isPastNow ? 0.45 : 1,
        cursor: "pointer",
        zIndex: expanded ? 10 : 1,
      }}
      onClick={() => {
        setExpanded((x) => !x);
        onOpen(course);
      }}
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

export default function Schedule({ onOpenReviews }: { onOpenReviews?: (professorName?: string, courseName?: string) => void }) {
  const { resolvedTheme } = useTheme();
  const t = useI18n();
  const isDark = resolvedTheme === "dark";
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [coursesByDay, setCoursesByDay] = useState<Record<number, Course[]>>({});
  const [loading, setLoading] = useState(true);
  const [detailCourse, setDetailCourse] = useState<Course | null>(null);

  // 每分钟刷新一次：让“现在线”与课程状态在跨过上下课时间节点时自动切换
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMinuteTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // 时间感知：真实时钟；自动聚焦到“今天”
  const now = new Date();
  const todayIdx = Math.min(todayWeekdayIndex(now), DAYS.length - 1);
  const weekDates = datesOfThisWeek(now);
  const academicWeek = academicWeekOf(now);
  const { h: nowH, m: nowM } = nowMinutes(now);

  useEffect(() => {
    setSelectedDay((prev) => (prev === todayIdx ? prev : todayIdx));
  }, [todayIdx]);

  const flattenLessons = (data: Record<string, unknown>): ClassLessonInput[] => {
    const lessons: ClassLessonInput[] = [];
    Object.entries(data ?? {}).forEach(([key, list]) => {
      const wd = Number(key);
      const arr = Array.isArray(list) ? list : [];
      arr.forEach((c) => {
        const course = c as { name?: string; room?: string; startH?: number; startM?: number };
        if (!course.name) return;
        lessons.push({
          weekday: Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 0,
          name: course.name,
          room: course.room,
          startH: course.startH ?? 9,
          startM: course.startM ?? 0,
        });
      });
    });
    return lessons;
  };

  useEffect(() => {
    fetch(`${API_URLS.schedule}?student_id=${STUDENT_ID}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Schedule request failed"))))
      .then((data) => {
        const raw: Record<string, unknown> =
          data && typeof data === "object" && !Array.isArray(data) && data.schedule && typeof data.schedule === "object"
            ? (data.schedule as Record<string, unknown>)
            : (data as Record<string, unknown>);
        const hasValidDays = Object.keys(raw ?? {}).some((key) => Number.isInteger(Number(key)) && Array.isArray(raw[key]));
        const schedule = hasValidDays ? (raw as Record<number, Course[]>) : MOCK_FALLBACK;
        setCoursesByDay(schedule);
        const reminderList = toReminderLessons(schedule as unknown as Record<string, unknown>);
        registerReminderLessons(reminderList);

        // 原生本地通知：每周循环提醒（提前 30 分钟，沿用 Course Radar 开关语义）
        void scheduleClassReminders(flattenLessons(schedule as unknown as Record<string, unknown>), 30);
        // 原生系统通知：T-60 “1小时后有课” + T-0 “上课提醒”（杀掉 App 也能触发）
        void scheduleUpcomingClassReminders(reminderList);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("API backend unreachable, using local fallback schedule:", err);
        setCoursesByDay(MOCK_FALLBACK);
        const reminderList = toReminderLessons(MOCK_FALLBACK as unknown as Record<string, unknown>);
        registerReminderLessons(reminderList);
        void scheduleClassReminders(flattenLessons(MOCK_FALLBACK as unknown as Record<string, unknown>), 30);
        void scheduleUpcomingClassReminders(reminderList);
        setLoading(false);
      });
  }, []);

  const courses = coursesByDay[selectedDay] || [];
  const nowY = timeToY(nowH, nowM);

  // Live Activity 看护：每分钟 + 回到前台时检查是否要启动/结束灵动岛倒计时
  const reminderLessons = useMemo(() => toReminderLessons(coursesByDay as unknown as Record<string, unknown>), [coursesByDay]);
  useEffect(() => {
    syncTimetableLiveActivity(reminderLessons, new Date());
    const interval = window.setInterval(() => syncTimetableLiveActivity(reminderLessons, new Date()), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncTimetableLiveActivity(reminderLessons, new Date());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reminderLessons]);

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
          <span className="text-xs font-semibold shrink-0 px-2 py-1 squircle-xs" style={{ background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", color: theme.hourText }}>
            {t("week")} {academicWeek} · {t("fall")} {ACADEMIC_YEAR}
          </span>

        </div>

        {/* Week Strip */}
        <div className="flex gap-1.5">
          {DAYS.map((day, i) => {
            const active = i === selectedDay;
            const isToday = i === todayIdx;
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
                <span className="text-sm font-bold mt-0.5" style={{ color: active ? "white" : isToday ? "#007AFF" : theme.weekBtnNum }}>{weekDates[i]}</span>
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
          {selectedDay === todayIdx && (
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
            courses.map((c) => (
              <CourseCard key={c.id} course={c} isDark={isDark} isToday={selectedDay === todayIdx} nowH={nowH} nowM={nowM} onOpen={setDetailCourse} />
            ))
          )}

          {!loading && courses.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="text-4xl opacity-30">🌿</div>
              <p className="text-sm font-medium" style={{ color: theme.emptyText }}>{t("noClasses")}</p>
            </div>
          )}
        </div>
      </div>

      {/* 课程详情弹窗：一键跳转 Prof Reviews 查看任课老师评分 */}
      {detailCourse && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={() => setDetailCourse(null)}>
          <div className="w-full max-w-[430px] glass squircle-lg p-5 animate-slide-up" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(94,92,230,0.18)", color: "#8E8CE9" }}>
                {detailCourse.type === "lecture" ? t("lecture") : detailCourse.type === "lab" ? t("lab") : detailCourse.type === "exam" ? t("exam") : t("seminar")}
              </span>
              <button type="button" onClick={() => setDetailCourse(null)} className="w-7 h-7 flex items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(235,235,245,0.7)" }}>✕</button>
            </div>
            <h2 className="text-xl font-bold text-white" style={{ letterSpacing: "-0.4px" }}>{detailCourse.name}</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="theme-muted">{t("calendar")}</span>
                <span className="font-semibold text-white" style={{ fontFamily: "JetBrains Mono", fontSize: 12 }}>
                  {`${detailCourse.startH.toString().padStart(2, "0")}:${detailCourse.startM.toString().padStart(2, "0")}–${detailCourse.endH.toString().padStart(2, "0")}:${detailCourse.endM.toString().padStart(2, "0")}`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="theme-muted">{t("room")}</span>
                <span className="font-semibold text-white">📍 {detailCourse.room}</span>
              </div>
              {detailCourse.prof && (
                <div className="flex items-center justify-between gap-3">
                  <span className="theme-muted">👨‍🏫</span>
                  <span className="font-semibold text-white text-right">{detailCourse.prof}</span>
                </div>
              )}
            </div>
            {detailCourse.prof && (
              <button
                type="button"
                onClick={() => {
                  const course = detailCourse;
                  setDetailCourse(null);
                  onOpenReviews?.(course.prof, course.name);
                }}
                className="haptic-action w-full mt-5 py-3.5 squircle-sm text-sm font-bold flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg,#FF9F0A,#FFD60A)", color: "#1c1c1e", boxShadow: "0 8px 22px rgba(255,159,10,0.35)" }}
              >
                ⭐ {tr("View Professor Rating", "Оқытушы бағасын қарау", "Рейтинг преподавателя")}
              </button>
            )}
            <button type="button" onClick={() => setDetailCourse(null)} className="theme-muted w-full mt-2 py-2 text-xs font-semibold">{t("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}