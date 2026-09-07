import { useEffect, useRef, useState } from "react";
import { useI18n, type AllTranslationKey } from "../contexts/LanguageContext";
import { motorHaptic, triggerHaptic } from "../utils/haptics";
import ServiceDetail, { type ServiceId } from "./ServiceDetail";
import SwipeBack from "../components/SwipeBack";
import { enableCoursePush, disableCoursePush, listManagedCourseIds } from "../native/coursePush";
import { tr } from "../utils/locale";

interface ServiceEntry {
  id?: ServiceId;
  detail?: boolean;
  icon: string;
  labelKey: AllTranslationKey;
  sub?: string;
  color: string;
  bg: string;
}

const SERVICE_ENTRIES: ServiceEntry[] = [
  { icon: "📚", labelKey: "library", sub: "3 books checked out", color: "#007AFF", bg: "rgba(0,122,255,0.14)" },
  { icon: "🏠", labelKey: "dorm", sub: "Block B, Room 214", color: "#30D158", bg: "rgba(48,209,88,0.13)" },
  { icon: "💳", labelKey: "unicard", sub: "Balance: ₸4,200", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { icon: "🎓", labelKey: "scholarship", sub: "Next: Nov 5", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
  { icon: "🍽️", labelKey: "cafeteria", sub: "Today: Beshbarmak", color: "#FF453A", bg: "rgba(255,69,58,0.12)" },
  { icon: "⚕️", labelKey: "medical", sub: "No appointments", color: "#30D158", bg: "rgba(48,209,88,0.12)" },

  { id: "attestation", detail: true, icon: "📋", labelKey: "serviceAttestation", color: "#007AFF", bg: "rgba(0,122,255,0.14)" },
  { id: "journal", detail: true, icon: "📊", labelKey: "serviceJournal", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
  { id: "plan", detail: true, icon: "🗺️", labelKey: "servicePlan", color: "#30D158", bg: "rgba(48,209,88,0.13)" },
  { id: "transcript", detail: true, icon: "📜", labelKey: "serviceTranscript", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { id: "onlineTest", detail: true, icon: "💻", labelKey: "serviceOnlineTest", color: "#FF453A", bg: "rgba(255,69,58,0.12)" },
  { id: "debt", detail: true, icon: "💸", labelKey: "serviceDebt", color: "#FF9F0A", bg: "rgba(255,159,10,0.13)" },
  { id: "fx", detail: true, icon: "🔁", labelKey: "serviceFx", color: "#5E5CE6", bg: "rgba(94,92,230,0.13)" },
  { id: "anketa", detail: true, icon: "🪪", labelKey: "serviceStudentAnketa", color: "#007AFF", bg: "rgba(0,122,255,0.14)" },
];

/* 全部课程：开闹钟后，本 App 会在上课前 30 分钟提醒 */
interface AlarmCourse {
  id: string;
  name: string;
  when: string;
  room: string;
  prof: string;
  color: string;
}
const ALARM_COURSES: AlarmCourse[] = [
  { id: "la", name: "Linear Algebra", when: "09:00–10:30", room: "204", prof: "Akhmetov N.T.", color: "#5E5CE6" },
  { id: "hm2", name: "Higher Mathematics II", when: "11:00–12:30", room: "315", prof: "Bekova A.K.", color: "#5E5CE6" },
  { id: "phys", name: "Physics Lab", when: "14:00–15:30", room: "Lab 3", prof: "Serikova G.M.", color: "#30D158" },
  { id: "eng", name: "English Seminar", when: "16:00–17:30", room: "108", prof: "Omarova D.S.", color: "#FF9F0A" },
  { id: "ds", name: "Data Structures", when: "Wed · 09:00–10:30", room: "301", prof: "Seitkali B.M.", color: "#007AFF" },
  { id: "ml", name: "Machine Learning", when: "Thu · 14:00–15:30", room: "407", prof: "Semagulova A.T.", color: "#FF453A" },
];

function readAlarms(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem("courseAlarms") || "[]") as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/* 住宿费：每月 ₸25,000。后续接入后端后，把 localStorage 换成数据库“每月交费记录表”。 */
const DORM_FEE = 25000;
const DORM_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DORM_STORAGE_KEY = "dormFeeLastPaid";

function readDormLastPaid(): number | null {
  try {
    const raw = localStorage.getItem(DORM_STORAGE_KEY);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** 绿(支付日) → 橘(半月) → 红(到期) 的连续过渡色 */
function feeColor(pct: number) {
  const green = [48, 209, 88];
  const orange = [255, 159, 10];
  const red = [255, 69, 58];
  let a: number[], b: number[], t: number;
  if (pct <= 0.5) {
    a = green; b = orange; t = pct / 0.5;
  } else {
    a = orange; b = red; t = (pct - 0.5) / 0.5;
  }
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}


export default function Services() {
  const t = useI18n();
  const [univerStatus, setUniverStatus] = useState<"ok" | "slow">("slow");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("—");
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<ServiceId | null>(null);
  const dormRef = useRef<HTMLDivElement>(null);
  const [dormFocus, setDormFocus] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("kaznu:openDorm") === "1") {
        localStorage.removeItem("kaznu:openDorm");
        setDormFocus(true);
        const t1 = window.setTimeout(() => dormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 260);
        const t2 = window.setTimeout(() => setDormFocus(false), 3400);
        return () => {
          window.clearTimeout(t1);
          window.clearTimeout(t2);
        };
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [barcode, setBarcode] = useState(false);
  const [alarms, setAlarms] = useState<Set<string>>(readAlarms);
  const [deniedOpen, setDeniedOpen] = useState(false);

  // 与 iOS 系统 Pending 通知 100% 同步：启动/回前台读取系统已注册的课程通知
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await listManagedCourseIds();
      if (cancelled || ids.length === 0) return;
      setAlarms((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        try {
          localStorage.setItem("courseAlarms", JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState("");
  const [toastOut, setToastOut] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const alarmCount = alarms.size;

  const [lastPaid, setLastPaid] = useState<number | null>(readDormLastPaid);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsedMs = lastPaid == null ? 0 : Math.max(0, nowMs - lastPaid);
  const feePct = lastPaid == null ? 0 : Math.min(1, elapsedMs / DORM_MONTH_MS);
  const dormOverdue = lastPaid == null || elapsedMs >= DORM_MONTH_MS;
  const feeDaysLeft = lastPaid == null ? 0 : Math.max(0, Math.ceil((DORM_MONTH_MS - elapsedMs) / 86400000));
  const feeBarColor = lastPaid == null ? "rgb(255, 69, 58)" : feeColor(feePct);

  const showToast = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToastOut(false);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => {
      setToastOut(true);
      toastTimer.current = window.setTimeout(() => setToast(""), 260);
    }, 1900);
  };

  const refreshUniver = () => {
    if (syncing) return;
    setSyncing(true);
    triggerHaptic(6);
    setTimeout(() => {
      setUniverStatus("ok");
      setSyncing(false);
      setLastSync(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      showToast("Univer · synced ✓");
    }, 900);
  };

  const applyAlarmSet = (courseId: string, on: boolean) => {
    setAlarms((prev) => {
      const next = new Set(prev);
      if (on) next.add(courseId);
      else next.delete(courseId);
      try {
        localStorage.setItem("courseAlarms", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleAlarm = async (course: AlarmCourse) => {
    motorHaptic();
    const spec = { id: course.id, name: course.name, when: course.when, room: course.room };
    const currentlyOn = alarms.has(course.id);
    if (currentlyOn) {
      // 关：从系统通知队列按 Course ID 移除
      await disableCoursePush(spec);
      applyAlarmSet(course.id, false);
      return;
    }
    // 开：请求权限 → 注册每周重复提醒（课程开始前 30 分钟）
    const enabled = await enableCoursePush(spec);
    if (!enabled) {
      setDeniedOpen(true); // 引导去系统设置开启通知
      return;
    }
    applyAlarmSet(course.id, true);
  };

  const openPay = () => {
    triggerHaptic(8);
    setPayOpen(true);
  };

  const confirmPay = () => {
    setPaying(true);
    motorHaptic();
    setTimeout(() => {
      setPaying(false);
      setPayOpen(false);
      const paidAt = Date.now();
      setLastPaid(paidAt);
      localStorage.setItem(DORM_STORAGE_KEY, String(paidAt));
      showToast("Kaspi · demo");
      motorHaptic();
      try {
        window.open("https://kaspi.kz/", "_blank", "noopener");
      } catch {
        /* 预览环境可能阻止弹窗 */
      }
    }, 900);
  };

  const statusColor = univerStatus === "ok" ? "#30D158" : "#FF9F0A";
  const statusLabel = univerStatus === "ok" ? t("allSystems") : t("degradedCache");
  const tiles = [
    { id: "schedule", accent: "#10B981", ok: true, label: t("schedule"), meta: "Tomorrow 09:00 Data Structures · 2 sessions synced" },
    { id: "grades", accent: "#409CFF", ok: true, label: t("grades"), meta: "GPA 3.82 · updated 2 min ago" },
    { id: "registration", accent: "#F59E0B", ok: false, label: t("registration"), meta: "Registration opens Sep 1 · 5/6 selected" },
  ];

  if (activeService) {
    return (
      <SwipeBack onBack={() => setActiveService(null)}>
        <ServiceDetail id={activeService} onBack={() => setActiveService(null)} />
      </SwipeBack>
    );
  }

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 w-full overflow-hidden">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white shrink-0 truncate" style={{ letterSpacing: "-0.5px" }}>{t("campusHub")}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 rounded-full flex items-center gap-1 border border-gray-200 dark:border-zinc-700 whitespace-nowrap">
            {syncing ? "Syncing…" : "Univer · synced ✓"}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-4 animate-slide-up">

        {/* Univer System —— 补全成可操作的门户面板 */}
        <div className="glass squircle-lg p-4 card-shadow" style={{ border: `1px solid ${statusColor}33` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="animate-pulse-glow status-dot" style={{ background: statusColor, color: statusColor }} />
              <div>
                <p className="text-sm font-bold text-white">Univer System</p>
                <p className="text-xs mt-0.5" style={{ color: statusColor, transition: "color 0.35s ease" }}>
                  {syncing ? "Syncing…" : statusLabel}
                  {lastSync !== "—" && !syncing ? ` · ${lastSync}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshUniver}
              disabled={syncing}
              className="haptic-action px-3 py-1.5 squircle-sm text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: "rgba(0,122,255,0.15)", color: "#407AFF" }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" style={{ animation: syncing ? "spin 0.8s linear infinite" : "none" }}>
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.1A7 7 0 1110 17a7 7 0 01-6.4-3.9 1 1 0 111.8-.9A5 5 0 1010 5a5 5 0 00-4 2H8a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              {t("refresh")}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {tiles.map((item) => {
              const active = openTile === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { triggerHaptic(6); setOpenTile(active ? null : item.id); }}
                  className="haptic-action flex flex-col items-center gap-1.5 py-2 squircle-sm transition-transform active:scale-95"
                  style={{ background: active ? `${item.accent}1f` : "rgba(255,255,255,0.04)", border: `1px solid ${active ? `${item.accent}55` : "rgba(255,255,255,0.06)"}` }}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.ok ? "#30D158" : "#FF9F0A", boxShadow: `0 0 4px ${item.ok ? "#30D158" : "#FF9F0A"}` }} />
                  <p className="text-xs" style={{ color: active ? item.accent : "rgba(235,235,245,0.6)" }}>{item.label}</p>
                </button>
              );
            })}
          </div>

          {openTile && (
            <div className="animate-slide-up mt-2 px-3 py-2.5 squircle-sm text-xs leading-relaxed" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(235,235,245,0.7)" }}>
              {tiles.find((x) => x.id === openTile)?.meta}
              {openTile === "registration" && <p className="mt-1 text-[11px]" style={{ color: "#FF9F0A" }}>Registration opens in Univer web — preview only.</p>}
            </div>
          )}
        </div>
        {/* Library Barcode Card */}
        <div className="glass squircle-lg overflow-hidden card-shadow">
          <button type="button" className="w-full flex items-center justify-between px-4 py-4" onClick={() => { triggerHaptic(6); setBarcode(!barcode); }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 squircle-sm flex items-center justify-center text-xl" style={{ background: "rgba(0,122,255,0.15)" }}>📚</div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">{t("libraryCard")}</p>
                <p className="text-xs" style={{ color: "rgba(235,235,245,0.45)" }}>{t("showBarcode")}</p>
              </div>
            </div>
            <div className="px-2 py-1 squircle-xs text-xs font-semibold" style={{ background: "rgba(0,122,255,0.15)", color: "#407AFF" }}>
              {barcode ? t("hide") : t("show")}
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
                <p className="text-xs font-bold text-black" style={{ fontFamily: "JetBrains Mono", letterSpacing: "0.2em" }}>KZ-2024-058-7821</p>
              </div>
              <p className="text-xs mt-2.5 text-center" style={{ color: "rgba(235,235,245,0.4)" }}>Aisha Bekova · Faculty of Computer Science</p>
            </div>
          )}
        </div>
        {/* Dorm —— 个人宿舍信息 + 每月住宿费（跳 Kaspi 交费） */}
        <div
          ref={dormRef}
          className="glass squircle-lg p-4 card-shadow"
          style={{
            borderLeft: "4px solid #30D158",
            scrollMarginTop: 12,
            transition: "box-shadow 0.5s ease, border-color 0.5s ease",
            boxShadow: dormFocus ? "0 0 0 2px rgba(48,209,88,0.7), 0 12px 30px rgba(48,209,88,0.22)" : undefined,
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 squircle-sm flex items-center justify-center text-lg" style={{ background: "rgba(48,209,88,0.14)" }}>🏠</div>
              <div>
                <p className="text-sm font-bold text-white">{t("dormBlock")} · Block B, Rm 214</p>
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(48,209,88,0.9)" }}>● {t("dorm")} · living</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: "rgba(48,209,88,0.14)", color: "#30D158" }}>{t("monthlyFee")}</span>
          </div>

          <div className="space-y-2 mb-4">
            {[
              { k: "Student", v: "Aisha Bekova" },
              { k: t("studentId"), v: "20260001" },
              { k: "Room", v: "Block B · Floor 2 · 214" },
              { k: t("monthlyFee"), v: `₸${DORM_FEE.toLocaleString()} / month` },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between text-xs">
                <span className="theme-muted">{row.k}</span>
                <span className="font-semibold text-white">{row.v}</span>
              </div>
            ))}
          </div>

          {/* 交费后的 30 天倒计时进度条：绿 → 渐变橘 → 渐变红 */}
          {lastPaid != null && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-[10px] mb-1.5">
                <span className="font-bold" style={{ color: feeBarColor, transition: "color 1s linear" }}>
                  {dormOverdue ? t("overdue") : `${t("paid")} · ${feeDaysLeft} ${t("daysLeft")}`}
                </span>
                <span style={{ color: "rgba(235,235,245,0.45)", fontFamily: "JetBrains Mono" }}>{feeDaysLeft} d</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden meter-track">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${((1 - feePct) * 100).toFixed(2)}%`,
                    background: feeBarColor,
                    boxShadow: `0 0 10px ${feeBarColor}`,
                    transition: "width 1s linear, background 1s linear",
                  }}
                />
              </div>
              <div className="mt-1 text-[9px]" style={{ color: "rgba(235,235,245,0.35)" }}>
                30 {t("daysLeft")}
              </div>
            </div>
          )}

          {/* 未交 / 到期未交：持续提示交费 */}
          {dormOverdue && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.28)" }}>
              <span style={{ fontSize: 16 }}>⏰</span>
              <p className="text-xs font-bold" style={{ color: "#FF453A" }}>
                {t("pleasePay")} · ₸{DORM_FEE.toLocaleString()}
              </p>
            </div>
          )}

          <button type="button" onClick={openPay} className="haptic-action w-full py-3 squircle-sm text-sm font-bold flex items-center justify-center gap-2 transition-transform active:scale-95" style={{ background: dormOverdue ? "linear-gradient(90deg, #FF453A, #FF9F0A)" : "linear-gradient(90deg, rgba(255,159,10,0.9), rgba(255,69,58,0.9))", color: "#fff", boxShadow: "0 6px 18px rgba(255,69,58,0.22)" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zm-2 5v5a2 2 0 002 2h12a2 2 0 002-2V9H2zm3 2.5h7a.5.5 0 010 1H5a.5.5 0 010-1z" /></svg>
            {t("payDorm")} · ₸{DORM_FEE.toLocaleString()} → {t("payWithKaspi")}
          </button>
        </div>
        {/* Course Radar —— 全部课程 + 上课前 30 分钟闹钟 */}
        <div className="glass squircle-lg p-4 card-shadow">
          <div className="flex items-center justify-between mb-1">
            <div>
              <p className="text-sm font-bold text-white">{t("courseRadar")}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{t("alarmCourses")} · 30′</p>
            </div>
            <span className="px-2 py-1 squircle-xs flex items-center gap-1.5 text-xs font-bold" style={{ background: alarmCount > 0 ? "rgba(255,159,10,0.14)" : "rgba(255,255,255,0.05)", color: alarmCount > 0 ? "#FF9F0A" : "rgba(235,235,245,0.45)" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5A1 1 0 003.4 15h13.2a1 1 0 00.9-1.5L16 11V8a6 6 0 00-6-6zM8 16a2 2 0 004 0H8z" /></svg>
              {alarmCount}
            </span>
          </div>

          <div className="space-y-2 mt-2.5">
            {ALARM_COURSES.map((c) => {
              const on = alarms.has(c.id);
              const accent = on ? c.color : "rgba(235,235,245,0.15)";
              return (
                <div key={c.id} className="rounded-2xl px-3.5 py-3" style={{ background: "rgba(255,255,255,0.04)", borderLeft: `3px solid ${accent}` }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold" style={{ color: on ? c.color : "rgba(235,235,245,0.5)", fontFamily: "JetBrains Mono" }}>{c.when}</p>
                      <p className="text-sm font-semibold text-white mt-1 leading-snug" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{c.name}</p>
                      <p className="text-[11px] mt-1 truncate" style={{ color: "rgba(235,235,245,0.45)" }}>{c.prof} · {t("room")} {c.room}</p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={on ? tr("Turn off reminder", "Ескертуді өшіру", "Выключить напоминание") : tr("Remind 30 min before", "Сабаққа 30 мин бұрын ескерту", "Напоминать за 30 мин")}
                      onClick={() => void toggleAlarm(c)}
                      className="haptic-action shrink-0 mt-0.5 w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90"
                      style={{
                        background: on ? `${c.color}22` : "rgba(255,255,255,0.06)",
                        color: on ? c.color : "rgba(235,235,245,0.55)",
                        border: `1px solid ${on ? `${c.color}55` : "rgba(255,255,255,0.1)"}`,
                      }}
                    >
                      {on ? (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 3a6 6 0 00-6 6v3l-1.6 2.6A1 1 0 005.2 16h13.6a1 1 0 00.8-1.4L18 12V9a6 6 0 00-6-6zM10 18a2 2 0 004 0h-4z" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M6 9.5V8.2M6 12v-1M18 12v-3a6 6 0 00-6-6 5.9 5.9 0 00-2.3.46M12 3a6 6 0 016 6v3l1.6 2.6A1 1 0 0118.8 16h-9M5.2 16l-1.2 0m0 0h1.2m12.2 0h-1.2M10 18a2 2 0 004 0" /><path d="M3 3l18 18" strokeWidth="1.8" /></svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "rgba(235,235,245,0.35)" }}>{t("alarmHint")}</p>
        </div>
        {/* All Services Grid */}
        <div>
          <p className="text-sm font-semibold mb-2.5" style={{ color: "rgba(235,235,245,0.7)" }}>{t("allServices")}</p>
          <div className="grid grid-cols-3 gap-2.5">
            {SERVICE_ENTRIES.map((s) => (
              <button
                key={s.labelKey}
                type="button"
                onClick={() => {
                  if (s.detail && s.id) {
                    triggerHaptic(8);
                    setActiveService(s.id);
                  } else {
                    triggerHaptic(6);
                    showToast(t("comingSoon"));
                  }
                }}
                className="haptic-action flex flex-col items-center gap-2 py-4 squircle-md transition-transform active:scale-95"
                style={{ background: "rgba(28,28,30,0.85)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="w-11 h-11 squircle-md flex items-center justify-center text-2xl" style={{ background: s.bg }}>{s.icon}</div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-white leading-tight">{t(s.labelKey)}</p>
                  {s.sub && <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.4)", fontSize: 10 }}>{s.sub}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toast：全宽 flex 容器精确定位，不依赖 translateX 猜位置 */}
      {toast && (
        <div
          className="toast-host fixed inset-x-0 top-0 z-[120] flex justify-center pointer-events-none"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)" }}
        >
          <div className={`toast-pop${toastOut ? " toast-out" : ""}`}>{toast}</div>
        </div>
      )}

      {/* 通知权限被拒 → 引导去系统设置 */}
      {deniedOpen && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} onClick={() => setDeniedOpen(false)}>
          <div className="w-full max-w-[430px] glass squircle-lg p-5 animate-slide-up" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, margin: "0 auto" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-white">🔕 {tr("Notifications are off", "Хабарландырулар өшірулі", "Уведомления выключены")}</p>
            <p className="theme-secondary text-xs mt-3 leading-relaxed">
              {tr(
                "To receive class reminders, please enable notifications for KazNU Helper in iOS Settings → KazNU Helper → Notifications → Allow Notifications.",
                "Сабақ ескертулерін алу үшін iOS Баптаулар → KazNU Helper → Хабарландырулар → «Хабарландыруларға рұқсат ету» бөлімінде рұқсат беріңіз.",
                "Чтобы получать напоминания о занятиях, включите уведомления в Настройках iOS → KazNU Helper → Уведомления.",
              )}
            </p>
            <div className="flex gap-2.5 mt-5">
              <button type="button" onClick={() => setDeniedOpen(false)} className="haptic-action flex-1 py-3 squircle-sm text-sm font-bold" style={{ background: "rgba(0,122,255,0.16)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.3)" }}>
                {tr("OK", "Жарайды", "OK")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kaspi 交住宿费 Sheet */}
      {payOpen && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }} onClick={() => setPayOpen(false)}>
          <div className="w-full max-w-[430px] glass squircle-lg p-5 animate-slide-up" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, margin: "0 auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-bold text-white">{t("payDorm")}</p>
              <button type="button" onClick={() => setPayOpen(false)} className="theme-muted w-7 h-7 flex items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>✕</button>
            </div>
            <div className="space-y-2 mb-4 text-xs">
              <div className="flex justify-between"><span className="theme-muted">{t("dorm")}</span><span className="font-semibold text-white">Block B · Room 214</span></div>
              <div className="flex justify-between"><span className="theme-muted">Period</span><span className="font-semibold text-white">September 2026</span></div>
              <div className="flex justify-between"><span className="theme-muted">{t("monthlyFee")}</span><span className="font-bold" style={{ color: "#FF453A", fontFamily: "JetBrains Mono" }}>₸{DORM_FEE.toLocaleString()}</span></div>
            </div>
            <p className="text-[11px] mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(0,122,255,0.1)", color: "#409CFF" }}>
              {t("payWithKaspi")} — opens the installed Kaspi app on your phone (native build).
            </p>
            <button type="button" onClick={confirmPay} disabled={paying} className="haptic-action w-full py-3 squircle-sm text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70" style={{ background: "#FF453A", color: "#fff" }}>
              {paying ? "Processing…" : `${t("openKaspi")} · ₸${DORM_FEE.toLocaleString()}`}
            </button>
            <button type="button" onClick={() => setPayOpen(false)} className="haptic-action w-full mt-2 py-2.5 squircle-sm text-sm font-semibold theme-muted">{t("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
