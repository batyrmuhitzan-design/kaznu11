import { useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATES = [1, 2, 3, 4, 5, 6];
const TODAY = 1; // Monday

type CourseType = "lecture" | "lab" | "exam" | "seminar";

interface Course {
  id: string;
  name: string;
  short: string;
  room: string;
  prof: string;
  type: CourseType;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  conflict?: boolean;
}

const TYPE_STYLE: Record<CourseType, { color: string; bg: string; label: string }> = {
  lecture: { color: "#5E5CE6", bg: "rgba(94,92,230,0.14)", label: "Lecture" },
  lab: { color: "#30D158", bg: "rgba(48,209,88,0.12)", label: "Lab" },
  exam: { color: "#FF453A", bg: "rgba(255,69,58,0.12)", label: "Exam" },
  seminar: { color: "#FF9F0A", bg: "rgba(255,159,10,0.12)", label: "Seminar" },
};

const COURSES_BY_DAY: Record<number, Course[]> = {
  0: [
    { id: "c1", name: "Linear Algebra", short: "LinAlg", room: "204", prof: "Akhmetov N.T.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30 },
    { id: "c2", name: "Higher Math II", short: "HM2", room: "315", prof: "Bekova A.K.", type: "lecture", startH: 11, startM: 0, endH: 12, endM: 30 },
    { id: "c3", name: "Physics Lab", short: "PhysLab", room: "Lab 3", prof: "Nurlanова G.S.", type: "lab", startH: 14, startM: 0, endH: 15, endM: 30 },
    { id: "c4", name: "English Seminar", short: "ENG", room: "108", prof: "Ivanova O.P.", type: "seminar", startH: 16, startM: 0, endH: 17, endM: 30 },
  ],
  1: [
    { id: "c5", name: "Data Structures", short: "DS", room: "301", prof: "Seitkali B.M.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30 },
    { id: "c6", name: "Algorithms Lab", short: "AlgLab", room: "Lab 2", prof: "Seitkali B.M.", type: "lab", startH: 11, startM: 0, endH: 12, endM: 30 },
  ],
  2: [
    { id: "c7", name: "Linear Algebra", short: "LinAlg", room: "204", prof: "Akhmetov N.T.", type: "lecture", startH: 10, startM: 0, endH: 11, endM: 30 },
    { id: "c8", name: "Midterm Exam", short: "EXAM", room: "Aud A", prof: "Bekova A.K.", type: "exam", startH: 13, startM: 0, endH: 15, endM: 0 },
  ],
  3: [
    { id: "c9", name: "Higher Math II", short: "HM2", room: "315", prof: "Bekova A.K.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30 },
    { id: "c10", name: "Physics", short: "Phys", room: "209", prof: "Nurlanова G.S.", type: "lecture", startH: 11, startM: 0, endH: 12, endM: 30 },
  ],
  4: [
    { id: "c11", name: "Data Structures", short: "DS", room: "301", prof: "Seitkali B.M.", type: "seminar", startH: 14, startM: 0, endH: 15, endM: 30 },
  ],
  5: [],
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

function CourseCard({ course }: { course: Course }) {
  const [expanded, setExpanded] = useState(false);
  const s = TYPE_STYLE[course.type];
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
            <p className="text-xs font-bold leading-tight text-white truncate">{course.name}</p>
            <span className="text-xs font-semibold shrink-0" style={{ color: s.color, fontSize: 9 }}>{s.label}</span>
          </div>
          {height > 50 && (
            <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(235,235,245,0.5)", fontSize: 10 }}>
              {course.room} · {course.prof.split(" ")[0]}
            </p>
          )}
        </div>
        {height > 70 && (
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono", fontSize: 9 }}>
              {`${course.startH.toString().padStart(2,"0")}:${course.startM.toString().padStart(2,"0")}–${course.endH.toString().padStart(2,"0")}:${course.endM.toString().padStart(2,"0")}`}
            </p>
            <div className="px-1.5 py-0.5 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158", fontSize: 9 }}>
              ✓ Present
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Schedule() {
  const [selectedDay, setSelectedDay] = useState(0);
  const courses = COURSES_BY_DAY[selectedDay] || [];
  const nowY = timeToY(NOW_H, NOW_M);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#000" }}>
      {/* Header */}
      <div className="px-4 pt-2 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white" style={{ letterSpacing: "-0.5px" }}>Schedule</h1>
          <button className="flex items-center gap-1.5 px-3 py-1.5 squircle-sm text-xs font-semibold" style={{ background: "rgba(0,122,255,0.15)", color: "#407AFF", border: "1px solid rgba(0,122,255,0.25)" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            Add to Calendar
          </button>
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
                className="flex-1 flex flex-col items-center py-2 squircle-sm transition-all duration-200"
                style={{
                  background: active ? "#007AFF" : "rgba(28,28,30,0.8)",
                  border: isToday && !active ? "1px solid rgba(0,122,255,0.4)" : "1px solid transparent",
                }}
              >
                <span className="text-xs font-medium" style={{ color: active ? "rgba(255,255,255,0.7)" : "rgba(235,235,245,0.45)", fontSize: 10 }}>{day}</span>
                <span className="text-sm font-bold mt-0.5" style={{ color: active ? "white" : isToday ? "#007AFF" : "rgba(235,235,245,0.7)" }}>{DATES[i]}</span>
                {(COURSES_BY_DAY[i]?.length || 0) > 0 && (
                  <div className="mt-1 w-1 h-1 rounded-full" style={{ background: active ? "rgba(255,255,255,0.6)" : "#007AFF" }} />
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
              <span className="text-xs w-11 text-right shrink-0" style={{ color: "rgba(235,235,245,0.28)", fontFamily: "JetBrains Mono", fontSize: 10 }}>
                {h.toString().padStart(2, "0")}:00
              </span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
          ))}

          {/* Current time needle */}
          {selectedDay === TODAY && (
            <div className="absolute left-0 right-0 flex items-center gap-2 z-20" style={{ top: nowY }}>
              <span className="text-xs w-11 text-right shrink-0" style={{ color: "#FF453A", fontFamily: "JetBrains Mono", fontSize: 10, fontWeight: 600 }}>NOW</span>
              <div className="flex-1 time-needle" />
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#FF453A", boxShadow: "0 0 6px #FF453A" }} />
            </div>
          )}

          {/* Course Cards */}
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}

          {courses.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="text-4xl opacity-30">🌿</div>
              <p className="text-sm font-medium" style={{ color: "rgba(235,235,245,0.35)" }}>No classes scheduled</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
