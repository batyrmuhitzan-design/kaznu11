import { useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { hapticSuccess } from "../utils/haptics";

type DocFormat = "PDF" | "PPT" | "DOC" | "XLS" | "ZIP";

interface CourseFile {
  id: string;
  name: string;
  format: DocFormat;
  size: string;
  pages?: number;
  date: string;
}

interface CourseSection {
  id: string;
  course: string;
  code: string;
  prof: string;
  color: string;
  files: CourseFile[];
}

const COURSE_MATERIALS: CourseSection[] = [
  {
    id: "la",
    course: "Linear Algebra",
    code: "MATH 150",
    prof: "Akhmetov N.T.",
    color: "#5E5CE6",
    files: [
      { id: "la-1", name: "Linear Algebra and its Applications (4th ed.)", format: "PDF", size: "42 MB", pages: 714, date: "Sep 2" },
      { id: "la-2", name: "Lecture Slides — Determinants & Matrices", format: "PPT", size: "6 MB", date: "Sep 5" },
      { id: "la-3", name: "Problem Set 1 — Full Solutions", format: "PDF", size: "1.4 MB", pages: 9, date: "Sep 8" },
    ],
  },
  {
    id: "hm2",
    course: "Higher Mathematics II",
    code: "MATH 201",
    prof: "Bekova A.K.",
    color: "#FF9F0A",
    files: [
      { id: "hm2-1", name: "Calculus: Early Transcendentals (8th ed.)", format: "PDF", size: "58 MB", pages: 992, date: "Sep 1" },
      { id: "hm2-2", name: "Differential Equations — Lecture Notes", format: "PDF", size: "3.2 MB", pages: 47, date: "Sep 3" },
      { id: "hm2-3", name: "Exercise Bank (with answers)", format: "DOC", size: "0.9 MB", date: "Sep 7" },
      { id: "hm2-4", name: "Archive: past midterm + solutions", format: "ZIP", size: "12 MB", date: "Sep 10" },
    ],
  },
  {
    id: "phys",
    course: "Physics Lab",
    code: "PHYS 120",
    prof: "Serikova G.M.",
    color: "#30D158",
    files: [
      { id: "phys-1", name: "Lab Manual 2026 (all experiments)", format: "PDF", size: "18 MB", pages: 210, date: "Sep 2" },
      { id: "phys-2", name: "Report template (.docx)", format: "DOC", size: "0.2 MB", date: "Sep 2" },
      { id: "phys-3", name: "Experiment 1 data sheet", format: "XLS", size: "0.4 MB", date: "Sep 6" },
    ],
  },
  {
    id: "eng",
    course: "English C1 — Academic Writing",
    code: "LANG 310",
    prof: "Ivanova O.P.",
    color: "#007AFF",
    files: [
      { id: "eng-1", name: "Academic Writing Handbook", format: "PDF", size: "8 MB", pages: 96, date: "Sep 1" },
      { id: "eng-2", name: "Week 1–4 vocabulary list", format: "DOC", size: "0.3 MB", date: "Sep 4" },
    ],
  },
];

const FORMAT_BG: Record<string, string> = {
  PDF: "rgba(255,69,58,0.15)",
  PPT: "rgba(255,159,10,0.15)",
  DOC: "rgba(0,122,255,0.15)",
  XLS: "rgba(48,209,88,0.15)",
  ZIP: "rgba(94,92,230,0.15)",
};
const FORMAT_COLOR: Record<string, string> = {
  PDF: "#FF453A",
  PPT: "#FF9F0A",
  DOC: "#409CFF",
  XLS: "#30D158",
  ZIP: "#7B79F7",
};

function FileIcon({ format }: { format: string }) {
  return (
    <div className="w-10 h-10 squircle-sm flex items-center justify-center shrink-0" style={{ background: FORMAT_BG[format] ?? "rgba(255,255,255,0.08)", color: FORMAT_COLOR[format] ?? "#fff" }}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5zM8 13h8v-1H8v1zm0 3h8v-1H8v1zm0 3h5v-1H8v1z" />
      </svg>
    </div>
  );
}

function DownloadIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} className="w-4 h-4">
      <path d="M10 2a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 10.586V3a1 1 0 011-1zM3 16a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
    </svg>
  );
}

export default function Materials() {
  const t = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ id: string; progress: number } | null>(null);

  const q = query.trim().toLowerCase();
  const groups = COURSE_MATERIALS.map((section) => ({
    ...section,
    files: section.files.filter((f) => !q || f.name.toLowerCase().includes(q) || section.course.toLowerCase().includes(q)),
  })).filter((section) => section.files.length > 0);

  const totalFiles = COURSE_MATERIALS.reduce((sum, s) => sum + s.files.length, 0);

  const findFile = (fileId: string) => {
    for (const s of COURSE_MATERIALS) {
      const f = s.files.find((x) => x.id === fileId);
      if (f) return f;
    }
    return undefined;
  };

  const handleDownload = (fileId: string) => {
    // 已下载 → 点击移除（本地演示）
    if (saved.has(fileId)) {
      const file = findFile(fileId);
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      toast.push(file ? `《${file.name}》已从本地移除` : "Removed", "info");
      return;
    }
    if (active) return; // 同一时间只模拟一个下载

    const file = findFile(fileId);
    let progress = 0;
    setActive({ id: fileId, progress });
    const timer = window.setInterval(() => {
      progress += 6 + Math.random() * 16;
      if (progress >= 100) {
        window.clearInterval(timer);
        setActive(null);
        setSaved((prev) => new Set(prev).add(fileId));
        toast.push(file ? `《${file.name}》已保存至本地` : "File saved", "success");
        void hapticSuccess();
      } else {
        setActive({ id: fileId, progress: Math.min(100, Math.round(progress)) });
      }
    }, 130);
  };

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      <div className="screen-pin px-4 pt-1 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium" style={{ color: "rgba(235,235,245,0.5)" }}>{t("fall")} 2026</p>
              <h1 className="text-2xl font-bold text-white mt-0.5" style={{ letterSpacing: "-0.5px" }}>{t("courseMaterials")}</h1>
            </div>
            <span className="px-2.5 py-1.5 rounded-full text-xs font-bold" style={{ background: "rgba(0,122,255,0.14)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.25)", fontFamily: "JetBrains Mono" }}>
              {totalFiles}
            </span>
          </div>

          {/* 搜索 */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 squircle-md" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 shrink-0">
              <circle cx="9" cy="9" r="6" stroke="rgba(235,235,245,0.5)" strokeWidth="1.6" />
              <path d="m13.5 13.5 3.5 3.5" stroke="rgba(235,235,245,0.5)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchMaterials")}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-28 space-y-3 animate-slide-up">

        {groups.length === 0 && (
          <div className="glass squircle-lg p-8 flex flex-col items-center gap-2">
            <span className="text-3xl">📭</span>
            <p className="theme-muted text-sm">{t("noMaterials")}</p>
          </div>
        )}

        {/* 每门课的教材区 */}
        {groups.map((section) => (
          <div key={section.id} className="glass squircle-lg overflow-hidden card-shadow">
            <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between" style={{ borderLeft: `3px solid ${section.color}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white truncate">{section.course}</p>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${section.color}1f`, color: section.color, fontFamily: "JetBrains Mono" }}>{section.code}</span>
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(235,235,245,0.5)" }}>{section.prof}</p>
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: "rgba(235,235,245,0.45)" }}>{section.files.length}</span>
            </div>

            <div className="divide-y divide-white/5 border-t border-white/5">
              {section.files.map((file) => {
                const isSaved = saved.has(file.id);
                return (
                  <div key={file.id} className="flex items-center gap-3 px-4 py-3">
                    <FileIcon format={file.format} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{file.name}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "rgba(235,235,245,0.45)", fontFamily: "JetBrains Mono" }}>
                        {file.format} · {file.size}
                        {file.pages ? ` · ${file.pages} pp` : ""} · {file.date}
                      </p>
                    </div>
                    {active && active.id === file.id ? (
                      <span
                        role="progressbar"
                        aria-valuenow={active.progress}
                        aria-label={`${active.progress}%`}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 squircle-xs text-xs font-bold"
                        style={{ background: "rgba(0,122,255,0.12)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.3)" }}
                      >
                        <span className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#409CFF", borderTopColor: "transparent" }} />
                        {active.progress}%
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDownload(file.id)}
                        data-action="download"
                        data-haptic="heavy"
                        className="haptic-action shrink-0 flex items-center gap-1.5 px-3 py-1.5 squircle-xs text-xs font-bold transition-all active:scale-95"
                        style={{
                          background: isSaved ? "rgba(48,209,88,0.16)" : "rgba(0,122,255,0.16)",
                          color: isSaved ? "#30D158" : "#409CFF",
                          border: `1px solid ${isSaved ? "rgba(48,209,88,0.3)" : "rgba(0,122,255,0.3)"}`,
                        }}
                      >
                        <DownloadIcon filled={isSaved} />
                        {isSaved ? t("downloaded") : t("download")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
