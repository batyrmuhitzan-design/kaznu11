import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { API_URLS } from "../utils/config";
import { Capacitor } from "@capacitor/core";
import { buildLiveActivityPayload, syncLiveActivity } from "../native/liveActivity";
import { postClassReminderBannerNow } from "../native/notifications";
import { motorHaptic } from "../utils/haptics";
import { playAlarmSound } from "../utils/alarm";
import { useDevSim, useLongPressOpen, SIM_NEWS_EVENT } from "../contexts/DevSimContext";
import { academicWeekOf, ACADEMIC_YEAR } from "../utils/calendar";
import { courseStatusFromDate } from "../utils/courseStatus";

const RADIUS = 36;
const CIRC = 2 * Math.PI * RADIUS;

// 课前/课间倒计时窗口（分钟）：每节课开始前 30 分钟进入倒计时
const PRE_CLASS_WINDOW_MIN = 30;

/** 倒计时颜色：progress = remaining/total → >0.5 绿 #34C759；>0.2 橙 #FF9500；其余红 #FF3B30 */
function countdownTone(pct: number) {
  if (pct > 0.5) return "#34C759";
  if (pct > 0.2) return "#FF9500";
  return "#FF3B30";
}

type CourseType = "lecture" | "lab" | "seminar";

interface TodayCourse {
  id: string;
  name: string;
  room: string;
  building: string;
  prof: string;
  type: CourseType;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
  color: string;
}

// 今日课程表（真实时间基准，用于课前/课中/课间状态判断）
const TODAY_COURSES: TodayCourse[] = [
  { id: "la", name: "Linear Algebra", room: "204", building: "Main Building", prof: "Akhmetov N.T.", type: "lecture", startH: 9, startM: 0, endH: 10, endM: 30, color: "#5E5CE6" },
  { id: "hm2", name: "Higher Mathematics II", room: "315", building: "Main Building", prof: "Bekova A.K.", type: "lecture", startH: 11, startM: 0, endH: 12, endM: 30, color: "#5E5CE6" },
  { id: "phys", name: "Physics Lab", room: "Lab 3", building: "Physics Block", prof: "Serikova G.M.", type: "lab", startH: 14, startM: 0, endH: 15, endM: 30, color: "#30D158" },
  { id: "eng", name: "English Seminar", room: "108", building: "Main Building", prof: "Omarova D.S.", type: "seminar", startH: 16, startM: 0, endH: 17, endM: 30, color: "#FF9F0A" },
];

const TYPE_META: Record<CourseType, { color: string; bg: string; labelKey: "lecture" | "lab" | "seminar" }> = {
  lecture: { color: "#7B79F7", bg: "rgba(94,92,230,0.25)", labelKey: "lecture" },
  lab: { color: "#30D158", bg: "rgba(48,209,88,0.18)", labelKey: "lab" },
  seminar: { color: "#FF9F0A", bg: "rgba(255,159,10,0.18)", labelKey: "seminar" },
};

type CountdownState =
  | { mode: "in-class"; course: TodayCourse; remaining: number; total: number }
  | { mode: "pre-class"; course: TodayCourse; remaining: number; total: number; shortBreak: boolean }
  | { mode: "idle"; next: TodayCourse | null };

const toMin = (h: number, m: number) => h * 60 + m;

/**
 * 根据当前真实时间计算首页倒计时应处于哪种状态。
 * - 课中 → 距下课倒计时（total=整节课时长，圆环随上课慢慢消耗）
 * - 下课后的"短课间/课前 15 分钟预告"→ 距上课倒计时
 *   · 若与上一节的间隔 ≤15 分钟（短课间）：整个课间都在倒计时（total=课间时长）
 *   · 若间隔 >15 分钟：只在开课前 15 分钟出现倒计时（total=15 分钟）
 * - 今天已无课 → idle（不再去倒计时明天的课）
 */
function computeCountdown(courses: TodayCourse[], now: Date): CountdownState {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  // 课中：距下课
  for (const c of courses) {
    const s = toMin(c.startH, c.startM);
    const e = toMin(c.endH, c.endM);
    if (nowMin >= s && nowMin < e) {
      return { mode: "in-class", course: c, remaining: (e - nowMin) * 60, total: (e - s) * 60 };
    }
  }

  // 下一节课（仅限今天）
  const next = courses
    .map((c) => ({ c, s: toMin(c.startH, c.startM), e: toMin(c.endH, c.endM) }))
    .filter((x) => x.s > nowMin)
    .sort((a, b) => a.s - b.s)[0];
  if (!next) return { mode: "idle", next: null };

  // 距下一节课开始 ≤15 分钟（含 10–15 分钟的短课间）才显示倒计时
  if (next.s - nowMin <= PRE_CLASS_WINDOW_MIN) {
    const prev = courses
      .map((c) => ({ c, e: toMin(c.endH, c.endM) }))
      .filter((x) => x.e <= nowMin && x.e >= next.s - PRE_CLASS_WINDOW_MIN)
      .sort((a, b) => b.e - a.e)[0];
    const gapMin = prev ? next.s - prev.e : PRE_CLASS_WINDOW_MIN;
    const shortBreak = !!prev && gapMin <= PRE_CLASS_WINDOW_MIN;
    return {
      mode: "pre-class",
      course: next.c,
      remaining: (next.s - nowMin) * 60,
      total: Math.min(PRE_CLASS_WINDOW_MIN, gapMin) * 60,
      shortBreak,
    };
  }

  return { mode: "idle", next: next.c };
}

/** 每秒刷新当前时间。 */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 数字从 0 涨到目标值（挂载时动画，后续目标变化直接跟随）。 */
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      let raf: number;
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(target * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    setValue(target);
  }, [target, duration]);

  return value;
}

function AnimatedNumber({ value, decimals = 0, duration = 1200, className, style }: { value: number; decimals?: number; duration?: number; className?: string; style?: CSSProperties }) {
  const display = useCountUp(value, duration);
  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {display.toFixed(decimals)}
    </span>
  );
}

function AnimatedProgress({ value, duration = 1200, style }: { value: number; duration?: number; style?: CSSProperties }) {
  const w = useCountUp(value, duration);
  return <div className="h-full rounded-full" style={{ width: `${w}%`, ...style }} />;
}

function AnimatedSparkline({ data, width = 96, height = 32 }: { data: number[]; width?: number; height?: number }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const minV = Math.min(...data) - 0.15;
  const maxV = Math.max(...data) + 0.15;
  const toX = (i: number) => (i / (data.length - 1)) * width;
  const toY = (v: number) => height - ((v - minV) / (maxV - minV)) * height;
  const pathD = data.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
  const areaD = pathD + ` L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mt-1">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#007AFF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#007AFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spark-grad)" style={{ opacity: entered ? 1 : 0, transition: "opacity 0.8s ease 0.3s" }} />
      <path
        d={pathD}
        fill="none"
        stroke="#007AFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: entered ? 0 : 1, transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)" }}
      />
      <circle cx={toX(data.length - 1)} cy={toY(data[data.length - 1])} r="3" fill="#007AFF" style={{ opacity: entered ? 1 : 0, transition: "opacity 0.4s ease 1.1s" }} />
    </svg>
  );
}

function ProgressRing({ pct, size, strokeWidth = 3, color = "#30D158", children }: { pct: number; size: number; strokeWidth?: number; color?: string; children?: ReactNode }) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const offset = c * (1 - (entered ? pct : 0));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function ClockIcon({ size = 16, angle = 0 }: { size?: number; angle?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#fff" }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="12" x2="12" y2="7" transform={`rotate(${angle} 12 12)`} />
      <line x1="12" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** 大卡片右上角的倒计时环：外环消耗 + 中心时钟（指针随秒旋转）+ 时间数字。 */
function CountdownRing({ remaining, total, ringColor }: { remaining: number; total: number; ringColor?: string }) {
  const pct = total > 0 ? remaining / total : 0;
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 未显式传色时，跟随三档阈值变色（与首页课程卡一致）
  const color = ringColor ?? countdownTone(pct);
  const offset = CIRC * (1 - (entered ? pct : 0));
  const angle = ((remaining % 60) / 60) * 360;

  return (
    <svg width="116" height="116" viewBox="0 0 88 88" className="absolute right-3 top-3">
      <circle cx="44" cy="44" r={RADIUS} fill="none" strokeWidth="8" className="ring-track" />
      <circle
        cx="44"
        cy="44"
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={offset}
        className="progress-ring"
        style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s ease" }}
      />
      {/* 中间放大显示剩余时间 */}
      <text x="44" y="47" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="Inter" className="ring-time" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" }}>
        {formatCountdown(remaining)}
      </text>
      <text x="44" y="60" textAnchor="middle" fill={color} fontSize="7.5" fontWeight="700" fontFamily="Inter" style={{ letterSpacing: "1.2px" }}>
        {pct <= 0.2 ? "· LAST" : pct <= 0.5 ? "· HALF" : "· LIVE"}
      </text>
    </svg>
  );
}

/** 宿舍 2GIS 导航短链（去 go.2gis 直达） */
const DORM_NAV_URL = "https://go.2gis.com/9d1D2";

/**
 * 楼栋 → 2GIS 地址（先写死模拟；之后改成从 Univer/学校官网抓取的教室地址，
 * 存进课程数据里，跳转时动态组装即可）
 */
const BUILDING_2GIS_ADDRESS: Record<string, string> = {
  "Main Building": "Алматы, Әл-Фараби даңғылы, 71",
  "Physics Block": "Алматы, Әл-Фараби даңғылы, 71/9",
  "IT Block": "Алматы, Әл-Фараби даңғылы, 71/5",
};

/** 打开外部链接：优先新窗口，若被浏览器拦截则当前页打开（真机/原生会唤起 2GIS） */
function openExternal(url: string) {
  try {
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.href = url;
  } catch {
    window.location.href = url;
  }
}

/** 打开 2GIS 并自动搜索教室所在楼栋地址（类似抓包里 catalog.api.2gis.ru 的 q 参数） */
function open2gisClassroom(building: string, room: string) {
  const address = BUILDING_2GIS_ADDRESS[building] ?? `${building} ${room}`;
  const query = address;
  openExternal(`https://2gis.kz/search/${encodeURIComponent(query)}`);
}

const QUICK = [
  { icon: "📚", label: "Materials", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
  { icon: "📅", label: "Calendar", color: "#30D158", bg: "rgba(48,209,88,0.13)" },
  { icon: "🔔", label: "Univer", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { icon: "🏠", label: "Dorm", color: "#007AFF", bg: "rgba(0,122,255,0.15)" },
];

/** GPA 卡片：从后端 /api/gpa 拉取，再触发数字与折线入场动画。 */
/** GPA 0→4.0 线性量尺：随挂载从低(0)涨到数据库里的 GPA 值。 */

function GpaScale({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 4) * 100));
  const w = useCountUp(pct, 1400);
  // 纯色进度：整根填充条随“从 0 → GPA”的增长，颜色同步 红 → 橙 → 绿
  const hue = Math.min(125, Math.max(0, w * 1.25));
  const fillColor = `hsl(${hue}, 92%, 58%)`;
  return (
    <div className="mt-2.5">
      <div className="relative h-1.5 rounded-full overflow-hidden meter-track">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: fillColor, boxShadow: `0 0 8px ${fillColor}` }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px]" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono" }}>0.0</span>
        <span className="text-[8px]" style={{ color: "rgba(235,235,245,0.35)", fontFamily: "JetBrains Mono" }}>4.0</span>
      </div>
    </div>
  );
}

/** 空闲/待机圆环：无实时倒计时时卡片右侧仍保留圆环，环中显示下一节开始时间或完成记号。 */
function IdleRing({ label, color = "rgba(255,255,255,0.45)", fontSize = 16 }: { label: string; color?: string; fontSize?: number }) {
  return (
    <svg width="116" height="116" viewBox="0 0 88 88" className="absolute right-3 top-3">
      <circle cx="44" cy="44" r={RADIUS} fill="none" strokeWidth="8" className="ring-track" />
      <circle cx="44" cy="44" r={RADIUS} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={0} opacity={0.85} />
      <text x="44" y={fontSize > 20 ? 51 : 49} textAnchor="middle" fontSize={fontSize} fontWeight="800" fontFamily="Inter" className="ring-time" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" }}>
        {label}
      </text>
    </svg>
  );
}

function GpaCard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const t = useI18n();
  const [data, setData] = useState<{ gpa: number; change: number; rank: string; history: number[] } | null>(null);

  useEffect(() => {
    fetch(API_URLS.gpa)
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(() => setData({ gpa: 3.82, change: 0.04, rank: "top 5%", history: [3.55, 3.62, 3.7, 3.75, 3.78, 3.82] }));
  }, []);

  return (
    <button type="button" onClick={() => onNavigate("grades")} className="haptic-action interactive-card flex-1 glass squircle-lg p-4 card-shadow inner-glow-blue text-left">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>{t("cumulativeGpa")}</p>
        <div className="px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158", fontSize: 10 }}>▲ {t("top")} 5%</div>
      </div>
      {data ? (
        <>
          <div className="mt-1">
            <AnimatedNumber value={data.gpa} decimals={2} duration={1400} className="gpa-grow text-3xl font-bold text-white" style={{ fontFamily: "JetBrains Mono", letterSpacing: "-1px" }} />
          </div>
          <GpaScale value={data.gpa} />
          <p className="text-xs mt-1.5" style={{ color: "rgba(235,235,245,0.4)", fontFamily: "JetBrains Mono" }}>
            ↑ <AnimatedNumber value={data.change} decimals={2} duration={1400} /> {t("thisSemester")}
          </p>
        </>
      ) : (
        <div className="mt-1">
          <p className="text-3xl font-bold text-white" style={{ fontFamily: "JetBrains Mono", letterSpacing: "-1px", opacity: 0.3 }}>…</p>
        </div>
      )}
    </button>
  );
}

export default function Dashboard({ onOpenProfile, onNavigate }: { onOpenProfile: () => void; onNavigate: (tab: string) => void }) {
  const [pressed, setPressed] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(() => Math.max(0, 3 - (JSON.parse(localStorage.getItem("readNotificationIds") || "[]") as string[]).length));
  const t = useI18n();
  const sim = useDevSim();
  const longPress = useLongPressOpen();
  const realNow = useNow(1000);
  const now = sim.simulatedNow(realNow);
  const week = sim.weekOverride ?? academicWeekOf(now);
  const countdown = computeCountdown(TODAY_COURSES, now);

  // Dev 模拟新通知 → 铃铛红点 +1
  useEffect(() => {
    const inc = () => setUnreadNotifications((n) => n + 1);
    window.addEventListener(SIM_NEWS_EVENT, inc);
    return () => window.removeEventListener(SIM_NEWS_EVENT, inc);
  }, []);

  const hasCountdown = countdown.mode !== "idle";
  const noMoreToday = countdown.mode === "idle" && !countdown.next;
  const lastToday = TODAY_COURSES[TODAY_COURSES.length - 1];
  const activeCourse = hasCountdown ? countdown.course : countdown.next ?? lastToday;
  const countdownPct = hasCountdown && countdown.total > 0 ? countdown.remaining / countdown.total : 0;
  const ringColor = !hasCountdown ? "rgba(255,255,255,0.5)" : countdownTone(countdownPct);
  const hhmm = (h: number, m: number) => `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  // “Today / Бүгін” 课程行状态：由系统当前时间动态算出（每 1s 刷新，跨过开始/结束节点自动切换）
  const todayRows = TODAY_COURSES.map((course) => ({
    ...course,
    status: courseStatusFromDate(now, course.startH, course.startM, course.endH, course.endM),
  }));
  const countdownStatus = hasCountdown
    ? countdown.mode === "in-class"
      ? t("endsIn")
      : countdown.shortBreak
        ? `${t("breakLabel")} · ${t("startsIn")}`
        : t("startsIn")
    : t("nextLabel");
  const lastSyncRef = useRef(-1);
  const notifiedRef = useRef(new Set<string>());

  // 上课闹钟：只有在 Course Radar 里开了铃铛的课程才提醒；
  // 提前 30 分钟触发“真实 iOS 系统横幅通知”（前台/后台/锁屏均可展示）+ 马达震动 + 铃声。
  useEffect(() => {
    if (countdown.mode === "idle") return;
    let alarmIds: Set<string> = new Set();
    try {
      const arr = JSON.parse(localStorage.getItem("courseAlarms") || "[]") as string[];
      alarmIds = new Set(Array.isArray(arr) ? arr : []);
    } catch {
      alarmIds = new Set();
    }
    const { course, remaining } = countdown;
    if (!alarmIds.has(course.id)) return;
    if (remaining <= 0 || remaining > 30 * 60) return;
    const fire = (key: string, title: string, body: string, opts?: { alarm?: boolean }) => {
      const nk = `${course.id}:${key}`;
      if (notifiedRef.current.has(nk)) return;
      notifiedRef.current.add(nk);
      if (opts?.alarm) {
        motorHaptic();
        // 原生端系统通知自带提示音，不叠加 WebAudio；Web 预览才播铃声。
        if (!Capacitor.isNativePlatform()) playAlarmSound();
      }
      // 原生：@capacitor/local-notifications → 真实系统 Top Banner；
      // Web：退回浏览器 Notification（仅已授权时）。
      void postClassReminderBannerNow({ courseId: course.id, marker: key, title, body }).then((sent) => {
        if (sent) return;
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: nk, requireInteraction: true });
          } catch {
            /* 忽略通知错误 */
          }
        }
      });
    };
    const mins = remaining / 60;
    const room = `${t("room")} ${course.room}`;
    if (countdown.mode === "pre-class") {
      if (mins <= 30 && mins > 29.8) {
        fire("t30", `${course.name} · ${t("startsIn")} 30 ${t("minutes")}`, room, { alarm: true });
      } else if (mins <= 15 && mins > 14.8) fire("t15", `${course.name} · ${t("startsIn")} 15 ${t("minutes")}`, room);
      else if (mins <= 5 && mins > 4.8) fire("t5", `${course.name} · ${t("startsIn")} 5 ${t("minutes")}`, room);
      else if (mins <= 1 && mins > 0.8) fire("t1", `${course.name} · ${t("startsIn")} 1 ${t("minutes")}`, room);
    } else if (countdown.mode === "in-class") {
      if (mins <= 15 && mins > 14.8) fire("e15", `${course.name} · ${t("endsIn")} 15 ${t("minutes")}`, room);
      else if (mins <= 5 && mins > 4.8) fire("e5", `${course.name} · ${t("endsIn")} 5 ${t("minutes")}`, room);
      else if (mins <= 1 && mins > 0.8) fire("e1", `${course.name} · ${t("endsIn")} 1 ${t("minutes")}`, room);
    }
  }, [countdown, hasCountdown, t]);

  // 后台/锁屏数据出口：前台不渲染任何小部件，只把倒计时数据同步给未来 iOS 原生桥。
  useEffect(() => {
    if (hasCountdown) {
      const sec = Math.round(countdown.remaining);
      if (lastSyncRef.current === sec) return;
      lastSyncRef.current = sec;
      const kind = countdown.mode === "in-class" ? "in-class" : "pre-class";
      syncLiveActivity(
        buildLiveActivityPayload({
          name: countdown.course.name,
          type: TYPE_META[countdown.course.type].labelKey,
          professor: countdown.course.prof,
          room: countdown.course.room,
          building: countdown.course.building,
          startH: countdown.course.startH,
          startM: countdown.course.startM,
          endH: countdown.course.endH,
          endM: countdown.course.endM,
          remaining: countdown.remaining,
          total: countdown.total,
          kind,
          statusLabel: countdownStatus,
        }),
      );
    } else if (lastSyncRef.current !== 0) {
      lastSyncRef.current = 0;
      syncLiveActivity(
        buildLiveActivityPayload({
          name: activeCourse.name,
          type: TYPE_META[activeCourse.type].labelKey,
          professor: activeCourse.prof,
          room: activeCourse.room,
          building: activeCourse.building,
          startH: activeCourse.startH,
          startM: activeCourse.startM,
          endH: activeCourse.endH,
          endM: activeCourse.endM,
          remaining: 0,
          total: 0,
          kind: "none",
          statusLabel: countdownStatus,
        }),
      );
    }
  }, [countdown, hasCountdown, activeCourse, countdownStatus]);

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
        {/* Header — 固定顶栏，列表在下方独立滚动 */}
        <div className="screen-pin px-4 pt-1">
          <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>
              {t("week")} {week} · {t("fall")} {ACADEMIC_YEAR}
            </p>
            <h1 className="text-2xl font-bold text-white mt-0.5" style={{ letterSpacing: "-0.5px" }}>
              {t("goodMorning")}, Aisha 👋
            </h1>
          </div>
          <div className="relative flex items-center gap-2.5">
            <button type="button" aria-label="Notifications" onClick={() => onNavigate("notifications")} className="haptic-action icon-button relative">
              <div className="w-8 h-8 flex items-center justify-center" style={{ color: "rgba(235,235,245,0.6)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
              </div>
              {unreadNotifications > 0 && <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white" style={{ fontSize: 9, fontWeight: 700, background: "#FF453A" }}>{unreadNotifications}</div>}
            </button>
            <button
              type="button"
              aria-label="Open profile"
              onClick={() => {
                if (!sim.open) onOpenProfile();
              }}
              onPointerDown={longPress.onPointerDown}
              onPointerUp={longPress.onPointerUp}
              onPointerLeave={longPress.onPointerLeave}
              title="Profile · 长按打开 Dev Console"
              data-haptic="light"
              className="haptic-action w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm transition-transform active:scale-95 select-none"
              style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)", fontSize: 13, touchAction: "manipulation" }}
            >
              AB
            </button>
          </div>
        </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-3 animate-slide-up">

        {/* Main Course Card (2x2) */}
        <div className="glass squircle-lg p-5 relative overflow-hidden card-shadow" style={{ minHeight: 160 }}>
          <div className="absolute inset-0 opacity-10" style={{ background: "linear-gradient(135deg, #0033A0 0%, transparent 60%)" }} />
          {hasCountdown ? (
            <CountdownRing remaining={countdown.remaining} total={countdown.total} ringColor={ringColor} />
          ) : (
            <IdleRing
              label={noMoreToday ? "🎉" : hhmm(activeCourse.startH, activeCourse.startM)}
              color={noMoreToday ? "#30D158" : "rgba(0,122,255,0.55)"}
              fontSize={noMoreToday ? 22 : 16}
            />
          )}
          <div className="pr-[132px]">
            <div className="flex items-center gap-2 mb-2">
              {noMoreToday ? (
                <div className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "rgba(48,209,88,0.15)", color: "#30D158" }}>✓ {hhmm(lastToday.endH, lastToday.endM)}</div>
              ) : (
                <div className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: TYPE_META[activeCourse.type].bg, color: TYPE_META[activeCourse.type].color }}>
                  {t(TYPE_META[activeCourse.type].labelKey).toUpperCase()}
                </div>
              )}
              {hasCountdown && countdown.mode === "in-class" && (
                <div className="w-1.5 h-1.5 rounded-full animate-pulse-glow" style={{ background: "#30D158" }} />
              )}
              {noMoreToday && <span className="text-lg leading-none">🎉</span>}
            </div>
            <p className="text-white font-bold text-lg leading-tight" style={{ letterSpacing: "-0.3px" }}>
              {noMoreToday ? lastToday.name : activeCourse.name}
            </p>
            <p className="text-sm mt-1" style={{ color: "rgba(235,235,245,0.55)" }}>{noMoreToday ? t("noMoreToday") : activeCourse.prof}</p>
            {!noMoreToday && (
              <>
                <p className="text-xs mt-1 font-medium" style={{ color: "#007AFF" }}>📍 {t("room")} {activeCourse.room}, {activeCourse.building}</p>
                {hasCountdown ? (
                  <p className="text-xs mt-1.5 font-bold" style={{ color: ringColor, fontFamily: "JetBrains Mono", fontVariantNumeric: "tabular-nums" }}>
                    {countdownStatus} {formatCountdown(countdown.remaining)}
                  </p>
                ) : (
                  <p className="text-xs mt-1.5" style={{ color: "rgba(235,235,245,0.45)", fontFamily: "JetBrains Mono", fontVariantNumeric: "tabular-nums" }}>
                    {hhmm(activeCourse.startH, activeCourse.startM)}–{hhmm(activeCourse.endH, activeCourse.endM)}
                  </p>
                )}
                <button type="button" onClick={() => open2gisClassroom(activeCourse.building, activeCourse.room)} className="haptic-action mt-3 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-opacity active:opacity-70" style={{ background: "rgba(0,122,255,0.2)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.3)" }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                  </svg>
                  {t("navigate")}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Row: GPA Card + DDL Card */}
        <div className="flex gap-3">
          <GpaCard onNavigate={onNavigate} />

          {/* DDL Card */}
          <button type="button" onClick={() => onNavigate("materials")} className="haptic-action interactive-card flex-1 glass squircle-lg p-4 card-shadow text-left" style={{ borderLeft: "1px solid rgba(255,69,58,0.2)" }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>{t("nextDeadline")}</p>
              <span className="text-xs" style={{ color: "#FF453A" }}>⚠ 4{t("hoursLeft")}</span>
            </div>
            <p className="text-sm font-bold text-white leading-tight">Data Structures</p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.5)" }}>{t("assignment")} 3</p>
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,69,58,0.15)" }}>
              <AnimatedProgress value={85} duration={1400} style={{ background: "linear-gradient(90deg, #FF9F0A, #FF453A)" }} />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "rgba(235,235,245,0.4)", fontFamily: "JetBrains Mono" }}>{t("dueToday")} 23:59</p>
          </button>
        </div>

        {/* Quick Actions 2x2 */}
        <div>
          <p className="theme-section-title text-sm font-semibold mb-2.5">{t("quickAccess")}</p>
          <div className="grid grid-cols-4 gap-2.5">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  if (q.label === "Dorm") {
                    // 快速导航：用宿舍 2GIS 短链直达（iOS 原生里这串链接会自动唤起 2GIS）
                    openExternal(DORM_NAV_URL);
                    return;
                  }
                  onNavigate(q.label === "Materials" ? "materials" : q.label === "Calendar" ? "schedule" : "services");
                }}
                onMouseDown={() => setPressed(q.label)}
                onMouseUp={() => setPressed(null)}
                onMouseLeave={() => setPressed(null)}
                className="haptic-action theme-panel flex flex-col items-center gap-2 py-3.5 squircle-md transition-transform active:scale-95"
                style={{
                  transform: pressed === q.label ? "scale(0.94)" : "scale(1)",
                }}
              >
                <div className="w-10 h-10 squircle-sm flex items-center justify-center text-xl" style={{ background: q.bg }}>
                  {q.icon}
                </div>
                <span className="theme-secondary text-xs font-medium" style={{ fontSize: 11 }}>{q.label === "Materials" ? t("materials") : q.label === "Calendar" ? t("schedule") : q.label === "Dorm" ? t("dormUtilities") : "Univer"}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Today's Schedule Preview */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="theme-section-title text-sm font-semibold">{t("today")}</p>
            <button type="button" onClick={() => onNavigate("schedule")} className="haptic-action text-xs font-medium" style={{ color: "#007AFF" }}>{t("seeAll")}</button>
          </div>
          <div className="space-y-2">
            {todayRows.map((course) => {
              const status = course.status;
              const done = status === "completed";
              const live = status === "in-progress";
              const typeLabel = t(TYPE_META[course.type].labelKey);
              return (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => onNavigate("schedule")}
                  className={`haptic-action theme-panel interactive-card w-full flex items-center gap-3 px-3.5 py-3 squircle-md text-left ${done ? "past-course" : ""}`}
                  style={{
                    opacity: 1,
                    border: live ? "1px solid rgba(48,209,88,0.4)" : done ? "1px solid rgba(255,255,255,0.04)" : undefined,
                    boxShadow: live ? "0 0 0 1px rgba(48,209,88,0.16), 0 6px 18px rgba(48,209,88,0.12)" : undefined,
                    transition: "border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
                  }}
                >
                  <div className="text-center shrink-0">
                    <p
                      className="text-xs font-semibold"
                      style={{
                        color: live ? "#30D158" : done ? "rgba(235,235,245,0.35)" : "rgba(235,235,245,0.6)",
                        fontFamily: "JetBrains Mono",
                      }}
                    >
                      {hhmm(course.startH, course.startM)}
                    </p>
                    {live && (
                      <p className="text-[9px] font-bold mt-0.5" style={{ color: "#30D158", fontFamily: "JetBrains Mono" }}>
                        {hhmm(course.endH, course.endM)}
                      </p>
                    )}
                  </div>
                  <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: live ? "#30D158" : course.color, opacity: done ? 0.4 : 1 }} />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${done ? "past-course-title" : "text-white"}`}
                      style={{ textDecoration: done ? "line-through" : "none" }}
                    >
                      {course.name}
                    </p>
                    <p className="theme-muted text-xs">Room {course.room} · {typeLabel}</p>
                  </div>
                  {live ? (
                    <span
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(48,209,88,0.14)", color: "#30D158", border: "1px solid rgba(48,209,88,0.28)" }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse-glow" style={{ background: "#30D158" }} />
                      {t("statusInProgress")}
                    </span>
                  ) : done ? (
                    <svg viewBox="0 0 20 20" fill="#30D158" className="w-4 h-4 shrink-0" aria-label="Completed">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
