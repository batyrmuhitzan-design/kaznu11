/**
 * Prof Reviews — professor & course search / rating home.
 * Reached from: Home Quick Access, Services card, Schedule & Dashboard
 * "View Professor Rating" deep links.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../contexts/LanguageContext";
import { useRmpStrings, rmpAgeLabel, rmpCountLabel } from "../locales/profReviews";
import type { RmpReview } from "../data/profReviews";
import {
  COURSES,
  PROFESSORS,
  REVIEWS,
  professorById,
  matchProfessor,
  reviewsForCourse,
} from "../data/profReviews";
import type { CommunityAccount, ExtraReview } from "../services/ProfReviewsService";
import {
  appendExtraReview,
  communityReviewedSet,
  loadCommunityAccount,
  loadExtraReviews,
  markReviewed,
  rmpApiUp,
  rmpSubmitRemote,
  rmpSyncProfileRemote,
  saveCommunityAccount,
} from "../services/ProfReviewsService";
import { motorHaptic } from "../utils/haptics";

export interface RmpDeepLink {
  professorName?: string;
  courseName?: string;
}

interface ProfReviewsProps {
  onBack: () => void;
  deepLink?: RmpDeepLink | null;
}

type FeedReview = RmpReview;
type Screen = "home" | "prof" | "course";

const STAR = "\u2605";

function initialsOf(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return `${a}${b}`.toUpperCase();
}

function avgOf(reviews: RmpReview[], key: "easy" | "quality"): number {
  if (!reviews.length) return 0;
  return Math.round((reviews.reduce((sum, r) => sum + r[key], 0) / reviews.length) * 10) / 10;
}

function ageLabel(s: Record<string, string>, r: RmpReview): string {
  if (r.createdAt) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000));
    return rmpAgeLabel(s as never, days);
  }
  return rmpAgeLabel(s as never, r.daysAgo ?? 0);
}

function extraToReview(e: ExtraReview, color: string): RmpReview {
  return {
    id: `my-${e.createdAt}`,
    professorId: e.professorId,
    courseCode: e.courseCode,
    courseTitle: null,
    easy: e.easy,
    quality: e.quality,
    attendance: e.attendance,
    comment: e.comment,
    tags: e.tags,
    likes: 0,
    dept: e.dept,
    daysAgo: 0,
  };
}

function attendanceColor(att: string): string {
  if (att === "mandatory") return "#FF9F0A";
  if (att === "recommended") return "#409CFF";
  return "#30D158";
}

function ratingColor(v: number): string {
  if (v >= 4.3) return "#10B981";
  if (v >= 3.5) return "#30D158";
  if (v >= 2.8) return "#FF9F0A";
  return "#FF453A";
}
/** Small UI atoms used across the Prof Reviews screens. */
function Stars({ value, color, size = 11 }: { value: number; color: string; size?: number }) {
  return (
    <span style={{ color: "rgba(235,235,245,0.22)", fontSize: size, letterSpacing: 1, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= Math.round(value) ? color : undefined }}>
          {STAR}
        </span>
      ))}
    </span>
  );
}

function TagChip({ text, accent }: { text: string; accent?: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{
        background: accent ? `${accent}1c` : "rgba(255,255,255,0.07)",
        color: accent ?? "rgba(235,235,245,0.72)",
        border: `1px solid ${accent ? `${accent}2e` : "rgba(255,255,255,0.09)"}`,
      }}
    >
      {text}
    </span>
  );
}

function AttendanceBadge({ att, s }: { att: string; s: Record<string, string> }) {
  const map: Record<string, string> = { not_mandatory: s.attOptional, recommended: s.attRecommended, mandatory: s.attMandatory };
  const c = attendanceColor(att);
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ background: `${c}16`, color: c }}>
      <span className="w-1 h-1 rounded-full" style={{ background: c }} />
      {map[att] ?? s.attRecommended}
    </span>
  );
}

function ReviewItem({ r, s, showProfessor }: { r: RmpReview; s: Record<string, string>; showProfessor?: boolean }) {
  const prof = professorById(r.professorId);
  return (
    <div className="px-4 py-3.5 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        {showProfessor && prof ? (
          <span className="text-xs font-bold text-white truncate">{prof.name}</span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(235,235,245,0.4)" }}>
            {r.courseCode ?? r.courseTitle ?? s.teachesCourses}
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: "rgba(94,92,230,0.16)", color: "#8E8CE9" }}>
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5"><path d="M8 1.5l1.8 3.7 4.1.6-3 2.9.7 4.1L8 10.8l-3.6 2 .7-4.1-3-2.9 4.1-.6z" /></svg>
          <Stars value={r.quality} color="#FFD60A" size={8} />
        </span>
      </div>

      {r.comment ? (
        <p className="text-[13px] leading-relaxed text-white/90">{r.comment}</p>
      ) : (
        <p className="text-[13px] italic" style={{ color: "rgba(235,235,245,0.35)" }}>—</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {r.tags?.slice(0, 3).map((tag) => (
          <TagChip key={tag} text={tag} />
        ))}
        <span className="flex-1" />
        <AttendanceBadge att={r.attendance} s={s} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "rgba(235,235,245,0.5)" }}>
          <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] font-bold" style={{ background: "rgba(255,255,255,0.1)", color: "rgba(235,235,245,0.75)" }}>
            {initialsOf(r.dept)}
          </span>
          <span className="font-medium max-w-[150px] truncate">{r.dept}</span>
          <span className="opacity-70">· {ageLabel(s, r)}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "rgba(235,235,245,0.45)" }}>
          <span className="flex items-center gap-0.5">
            <svg viewBox="0 0 20 20" fill="none" className="w-3 h-3"><path d="M10 18s-6-4.1-6-9a3.6 3.6 0 016-2.6A3.6 3.6 0 0116 9c0 4.9-6 9-6 9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            {r.likes}
          </span>
        </div>
      </div>
    </div>
  );
}

interface SummaryRow {
  id: string;
  name: string;
  department: string;
  color: string;
  quality: number;
  easy: number;
  count: number;
}

function ProfessorRow({ row, onOpen }: { row: SummaryRow; onOpen: (id: string) => void }) {
  const qualityColor = ratingColor(row.quality);
  return (
    <button
      type="button"
      onClick={() => {
        motorHaptic();
        onOpen(row.id);
      }}
      className="haptic-action theme-row w-full flex items-center gap-3 px-4 py-3.5 text-left"
    >
      <span className="w-11 h-11 squircle-sm flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg, ${row.color}, ${row.color}aa)` }}>
        {initialsOf(row.name)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-white truncate">{row.name}</span>
          <span className="text-sm font-bold shrink-0" style={{ color: qualityColor, fontFamily: "JetBrains Mono" }}>{row.quality.toFixed(1)}</span>
        </span>
        <span className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[11px] truncate" style={{ color: "rgba(235,235,245,0.45)" }}>{row.department}</span>
          <span className="text-[10px] shrink-0 flex items-center gap-1" style={{ color: "rgba(235,235,245,0.4)" }}>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full" style={{ background: "rgba(255,214,10,0.1)" }}>
              <Stars value={row.easy} color="#FFD60A" size={8} />
            </span>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 opacity-70"><path d="M6 4h8v1H6zM6 8h8v1H6zM6 12h5v1H6zM4 15h2v3l4-3h6a2 2 0 002-2V4a2 2 0 00-2-2H4a2 2 0 00-2 2v9a2 2 0 002 2z" /></svg>
          </span>
        </span>
      </span>
    </button>
  );
}
interface CourseSummaryRow {
  id: string;
  code: string;
  title: string;
  department: string;
  quality: number;
  count: number;
}

function CourseRow({ row, onOpen }: { row: CourseSummaryRow; onOpen: (code: string) => void }) {
  const color = ratingColor(row.quality);
  return (
    <button
      type="button"
      onClick={() => {
        motorHaptic();
        onOpen(row.code);
      }}
      className="haptic-action theme-row w-full flex items-center gap-3 px-4 py-3.5 text-left"
    >
      <span className="w-11 h-11 squircle-sm flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: "linear-gradient(135deg,#007AFF,#00C7BE)" }}>
        {row.code}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-white truncate">{row.title}</span>
          {row.count > 0 && (
            <span className="text-sm font-bold shrink-0" style={{ color, fontFamily: "JetBrains Mono" }}>{row.quality.toFixed(1)}</span>
          )}
        </span>
        <span className="text-[11px] mt-0.5 block truncate" style={{ color: "rgba(235,235,245,0.45)" }}>
          {row.code} · {row.department}
        </span>
      </span>
    </button>
  );
}

function RatingPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 px-3 py-2.5 squircle-sm" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(235,235,245,0.45)" }}>{label}</p>
      <p className="text-xl font-bold mt-0.5" style={{ color, fontFamily: "JetBrains Mono", lineHeight: 1.1 }}>{value.toFixed(1)}</p>
      <div className="mt-1"><Stars value={value} color={color} size={9} /></div>
    </div>
  );
}

function BackChevron({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold">
      <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  );
}
function StarPicker({ label, color, value, onChange }: { label: string; color: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "rgba(235,235,245,0.5)" }}>{label}</p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i === value ? 0 : i)}
            className="haptic-action w-9 h-9 flex items-center justify-center rounded-lg text-xl"
            style={{
              background: i <= value ? `${color}26` : "rgba(255,255,255,0.06)",
              color: i <= value ? color : "rgba(235,235,245,0.25)",
              border: `1px solid ${i <= value ? `${color}55` : "rgba(255,255,255,0.08)"}`,
            }}
            aria-label={`${label} ${i}`}
          >
            {STAR}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-12 flex flex-col items-center text-center px-8">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-3" style={{ background: "rgba(255,255,255,0.05)" }}>🔍</div>
      <p className="text-sm font-bold text-white">{title}</p>
      <p className="text-xs mt-1.5" style={{ color: "rgba(235,235,245,0.45)" }}>{hint}</p>
    </div>
  );
}

function InfoNote({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <div className="glass squircle-md p-3.5 flex gap-3" style={{ border: "1px solid rgba(0,122,255,0.16)" }}>
      <span className="text-lg leading-none mt-0.5">{icon}</span>
      <div>
        <p className="text-[11px] font-bold text-white">{title}</p>
        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "rgba(235,235,245,0.5)" }}>{body}</p>
      </div>
    </div>
  );
}

function CommunitySheet({
  s,
  acc,
  onClose,
  onSaved,
}: {
  s: Record<string, string>;
  acc: CommunityAccount;
  onClose: () => void;
  onSaved: (next: CommunityAccount) => void;
}) {
  const [name, setName] = useState(acc.displayName);
  const [dept, setDept] = useState(acc.departmentTag);
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  const doSave = () => {
    const cleaned = name.trim().replace(/\s+/g, "_");
    if (cleaned.length < 3 || cleaned.length > 24) {
      onSaved(acc); // still closes; validation printed by caller using current values
      return;
    }
    motorHaptic();
    const next: CommunityAccount = { ...acc, displayName: cleaned, departmentTag: dept.trim() || acc.departmentTag, isDefaultName: false };
    setBusy(true);
    window.setTimeout(() => {
      saveCommunityAccount(next);
      setSavedTick((x) => x + 1);
      setBusy(false);
      void rmpSyncProfileRemote();
    }, 350);
  };

  useEffect(() => {
    if (savedTick > 0) onSaved(loadCommunityAccount());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="w-full max-w-[430px] glass squircle-lg p-5 animate-slide-up pb-[max(20px,env(safe-area-inset-bottom))]" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-base font-bold text-white">👤 {s.communityProfile}</p>
          <button type="button" onClick={onClose} className="theme-muted w-7 h-7 flex items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>✕</button>
        </div>
        <p className="text-[10px] mb-4 leading-relaxed" style={{ color: "rgba(235,235,245,0.5)" }}>{s.hiddenNameNote}</p>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold mb-1 block" style={{ color: "rgba(235,235,245,0.6)" }}>{s.displayName}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            className="w-full px-3.5 py-3 squircle-sm text-sm text-white outline-none"
            style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
            placeholder="user1234567"
          />
        </label>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold mb-1 block" style={{ color: "rgba(235,235,245,0.6)" }}>{s.deptTag}</span>
          <input
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            maxLength={120}
            className="w-full px-3.5 py-3 squircle-sm text-sm text-white outline-none"
            style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
            placeholder="Data Science Student"
          />
        </label>

        <p className="text-[10px] leading-relaxed mb-4 px-3 py-2 squircle-sm" style={{ background: "rgba(0,122,255,0.1)", color: "#409CFF" }}>
          {s.nameDefaultNote}
        </p>

        <div className="flex gap-2.5">
          <button type="button" onClick={onClose} className="haptic-action flex-1 py-3 squircle-sm text-sm font-bold theme-muted" style={{ background: "rgba(255,255,255,0.07)" }}>{s.cancel}</button>
          <button
            type="button"
            onClick={doSave}
            disabled={busy}
            className="haptic-action flex-[2] py-3 squircle-sm text-sm font-bold disabled:opacity-60"
            style={{ background: "#007AFF", color: "#fff" }}
          >
            {busy ? "…" : `✓ ${s.save}`}
          </button>
        </div>
      </div>
    </div>
  );
}
const TAG_POOL = ["Clear grading", "Tough grader", "Caring", "Inspirational", "Heavy workload", "Boring lectures", "Skip class", "Easy grading"];

function ComposerScreen({
  s, prof, courseChips, attendanceSeeds, onClose, onSubmitted,
}: {
  s: Record<string, string>;
  prof: SummaryRow;
  courseChips: Array<{ code: string; title: string }>;
  attendanceSeeds: string[];
  onClose: () => void;
  onSubmitted: (input: { easy: number; quality: number; attendance: string; comment: string; tags: string[]; courseCode: string | null }) => void;
}) {
  const [easy, setEasy] = useState(5);
  const [quality, setQuality] = useState(5);
  const [attendance, setAttendance] = useState("recommended");
  const [courseCode, setCourseCode] = useState("");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const toggleTag = (tag: string) => setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : prev.length >= 4 ? prev : [...prev, tag]));
  const canSubmit = easy >= 1 && quality >= 1;
  const doSubmit = () => {
    motorHaptic();
    onSubmitted({ easy, quality, attendance, comment: comment.trim(), tags, courseCode: courseCode || null });
  };
  const attendanceLabels: Record<string, string> = { not_mandatory: s.attOptional, recommended: s.attRecommended, mandatory: s.attMandatory };

  return (
    <div className="fixed inset-0 z-[55] flex flex-col" style={{ background: "var(--app-bg)", color: "var(--app-text)" }}>
      <div className="px-4 pt-2 pb-3 flex items-center justify-between shrink-0">
        <BackChevron label={s.cancel} onBack={onClose} />
        <button type="button" onClick={doSubmit} disabled={!canSubmit} className="haptic-action px-4 py-2 squircle-sm text-xs font-bold disabled:opacity-40" style={{ background: "#007AFF", color: "#fff" }}>{s.submit}</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8 space-y-4">
        <div className="glass squircle-lg p-4 flex items-center gap-3">
          <span className="w-11 h-11 squircle-sm flex items-center justify-center text-sm font-bold text-white" style={{ background: `linear-gradient(135deg, ${prof.color}, ${prof.color}aa)` }}>{initialsOf(prof.name)}</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{prof.name}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{s.rateThisProfessor}</p>
          </div>
        </div>

        <InfoNote title={s.anonymousTag} body={s.howBody} icon="🕶️" />

        <div className="glass squircle-lg p-4 space-y-4">
          <StarPicker label={s.quality} color="#8E8CE9" value={quality} onChange={setQuality} />
          <StarPicker label={s.easiness} color="#FFD60A" value={easy} onChange={setEasy} />
        </div>
        {courseChips.length > 0 && (
          <div className="glass squircle-lg p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>{s.teachesCourses}</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCourseCode("")}
                className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
                style={{ background: courseCode === "" ? "rgba(0,122,255,0.22)" : "rgba(255,255,255,0.07)", color: courseCode === "" ? "#409CFF" : "rgba(235,235,245,0.7)" }}
              >
                🌐 {s.teachesCourses}
              </button>
              {courseChips.map((c) => {
                const active = courseCode === c.code;
                return (
                  <button key={c.code} type="button" onClick={() => setCourseCode(c.code)} className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
                    style={{ background: active ? "rgba(0,122,255,0.22)" : "rgba(255,255,255,0.07)", color: active ? "#409CFF" : "rgba(235,235,245,0.7)", border: active ? "1px solid rgba(0,122,255,0.5)" : "1px solid transparent" }}
                  >{c.code}</button>
                );
              })}
            </div>
          </div>
        )}

        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>{s.attendance}</p>
          <div className="flex rounded-full p-1" style={{ background: "var(--seg-track)" }}>
            {attendanceSeeds.map((seed) => {
              const active = attendance === seed;
              const c = attendanceColor(seed);
              return (
                <button key={seed} type="button" onClick={() => setAttendance(seed)}
                  className="haptic-action flex-1 py-2 rounded-full text-[11px] font-semibold transition-all"
                  style={{ background: active ? c : "transparent", color: active ? "#fff" : "rgba(235,235,245,0.6)" }}
                >{attendanceLabels[seed]}</button>
              );
            })}
          </div>
        </div>
        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>{s.comment}</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 1200))} rows={4} placeholder={s.commentPlaceholder}
            className="w-full px-3 py-3 squircle-sm text-sm text-white outline-none resize-none leading-relaxed"
            style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}
          />
          <p className="text-[9px] mt-1 text-right" style={{ color: "rgba(235,235,245,0.35)" }}>{comment.length}/1200</p>
        </div>

        <div className="glass squircle-lg p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(235,235,245,0.5)" }}>{s.tags}</p>
          <div className="flex flex-wrap gap-1.5">
            {TAG_POOL.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button key={tag} type="button" onClick={() => toggleTag(tag)} className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
                  style={{
                    background: active ? "rgba(94,92,230,0.24)" : "rgba(255,255,255,0.07)",
                    color: active ? "#A6A4FF" : "rgba(235,235,245,0.7)",
                    border: active ? "1px solid rgba(94,92,230,0.6)" : "1px solid transparent",
                  }}
                >{active ? "✓ " : ""}#{tag}</button>
              );
            })}
          </div>
        </div>


      </div>
    </div>
  );
}
function ProfessorDetail({
  s, row, reviews, courseStats, reviewed, source, onBack, onCompose, onOpenCourse,
}: {
  s: Record<string, string>;
  row: SummaryRow;
  reviews: RmpReview[];
  courseStats: Array<{ code: string; quality: number; count: number }>;
  reviewed: boolean;
  source: string;
  onBack: () => void;
  onCompose: () => void;
  onOpenCourse: (code: string) => void;
}) {
  const qualityColor = ratingColor(row.quality);
  return (
    <div className="app-surface h-full overflow-y-auto">
      <div className="px-4 pt-2 pb-32 animate-slide-up">
        <div className="flex items-center justify-between">
          <BackChevron label={s.professors} onBack={onBack} />
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full flex items-center gap-1"
            style={{ background: source === "live" ? "rgba(48,209,88,0.14)" : "rgba(255,159,10,0.14)", color: source === "live" ? "#30D158" : "#FF9F0A" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: source === "live" ? "#30D158" : "#FF9F0A" }} />
            {source === "live" ? s.live : s.demoData}
          </span>
        </div>

        <div className="glass squircle-lg p-5 mt-3 relative overflow-hidden card-shadow">
          <div className="absolute inset-0 opacity-10" style={{ background: `linear-gradient(135deg, ${row.color} 0%, transparent 65%)` }} />
          <div className="relative flex items-center gap-4">
            <span className="w-16 h-16 squircle-lg flex items-center justify-center text-xl font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg, ${row.color}, ${row.color}99)` }}>
              {initialsOf(row.name)}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate" style={{ letterSpacing: "-0.4px" }}>{row.name}</h1>
              <p className="text-xs mt-1" style={{ color: "rgba(235,235,245,0.55)" }}>{row.department}</p>
              <p className="text-[10px] mt-1 font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                {rmpCountLabel(s, row.count)} · {s.of} 5
              </p>
            </div>
          </div>
          <div className="relative flex gap-2 mt-4">
            <RatingPill label={s.quality} value={row.quality} color={qualityColor} />
            <RatingPill label={s.easiness} value={row.easy} color="#FFD60A" />
          </div>
        </div>

        {courseStats.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-bold mb-2" style={{ color: "rgba(235,235,245,0.6)" }}>{s.teachesCourses}</p>
            <div className="flex flex-wrap gap-1.5">
              {courseStats.map((c) => (
                <button key={c.code} type="button" onClick={() => onOpenCourse(c.code)}
                  className="haptic-action px-2.5 py-1.5 squircle-sm text-[11px] font-semibold inline-flex items-center gap-1.5"
                  style={{ background: "rgba(0,122,255,0.14)", color: "#409CFF", border: "1px solid rgba(0,122,255,0.28)" }}
                >
                  {c.code}
                  <span className="opacity-80" style={{ color: ratingColor(c.quality), fontFamily: "JetBrains Mono" }}>{c.quality.toFixed(1)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="glass squircle-lg p-4 mt-4 flex items-center justify-between gap-3" style={{ border: `1px solid ${reviewed ? "rgba(48,209,88,0.2)" : "rgba(0,122,255,0.24)"}` }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg shrink-0">{reviewed ? "✅" : "🕶️"}</span>
            <p className="text-xs font-semibold text-white leading-snug">{reviewed ? s.ratedNote : s.anonymousTag}</p>
          </div>
          {!reviewed && (
            <button type="button" onClick={onCompose} className="haptic-action shrink-0 px-3.5 py-2.5 squircle-sm text-xs font-bold" style={{ background: "#007AFF", color: "#fff", boxShadow: "0 6px 18px rgba(0,122,255,0.35)" }}>
              {s.writeReview}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 mb-2">
          <p className="text-sm font-semibold text-white">{s.reviewsWord}</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(235,235,245,0.55)" }}>
            {reviews.length}
          </span>
        </div>

        {reviews.length === 0 ? (
          <div className="glass squircle-lg overflow-hidden"><EmptyState title={s.noRatingsYet} hint={s.writeReview} /></div>
        ) : (
          <div className="glass squircle-lg overflow-hidden divide-y divide-white/5">
            {reviews.map((r) => (
              <ReviewItem key={r.id} r={r} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function CourseDetail({
  s, course, reviews, onBack, onOpenProfessor,
}: {
  s: Record<string, string>;
  course: { code: string; title: string; department: string };
  reviews: RmpReview[];
  onBack: () => void;
  onOpenProfessor: (id: string) => void;
}) {
  const profIds = [...new Set(reviews.map((r) => r.professorId))];
  const profRows = profIds
    .map((id) => {
      const p = professorById(id);
      if (!p) return null;
      const rs = reviews.filter((r) => r.professorId === id);
      return { ...p, quality: avgOf(rs, "quality"), easy: avgOf(rs, "easy"), count: rs.length };
    })
    .filter((p): p is SummaryRow => p !== null)
    .sort((a, b) => b.quality - a.quality);

  return (
    <div className="app-surface h-full overflow-y-auto">
      <div className="px-4 pt-2 pb-32 animate-slide-up">
        <BackChevron label={s.courses} onBack={onBack} />
        <div className="glass squircle-lg p-5 mt-3 card-shadow" style={{ border: "1px solid rgba(0,122,255,0.18)" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#409CFF" }}>{course.code}</p>
              <h1 className="text-xl font-bold text-white mt-1 truncate" style={{ letterSpacing: "-0.4px" }}>{course.title}</h1>
              <p className="text-xs mt-1" style={{ color: "rgba(235,235,245,0.55)" }}>{course.department}</p>
            </div>
            <span className="text-3xl shrink-0">📚</span>
          </div>
        </div>

        {profRows.length > 0 && (
          <>
            <p className="text-xs font-bold mt-4 mb-2" style={{ color: "rgba(235,235,245,0.6)" }}>{s.professors}</p>
            <div className="glass squircle-lg overflow-hidden">
              {profRows.map((row) => (
                <ProfessorRow key={row.id} row={row} onOpen={onOpenProfessor} />
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-between mt-5 mb-2">
          <p className="text-sm font-semibold text-white">{s.reviewsWord}</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(235,235,245,0.55)" }}>{reviews.length}</span>
        </div>
        {reviews.length === 0 ? (
          <div className="glass squircle-lg overflow-hidden"><EmptyState title={s.noRatingsYet} hint={s.blurb} /></div>
        ) : (
          <div className="glass squircle-lg overflow-hidden divide-y divide-white/5">
            {reviews.map((r) => (
              <ReviewItem key={r.id} r={r} s={s} showProfessor />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function HomeContent({
  s, source, mode, query, onQuery, onMode, profRows, courseRows, onOpenProf, onOpenCourse, onCommunity,
}: {
  s: Record<string, string>;
  source: string;
  mode: "prof" | "course";
  query: string;
  onQuery: (q: string) => void;
  onMode: (m: "prof" | "course") => void;
  profRows: SummaryRow[];
  courseRows: CourseSummaryRow[];
  onOpenProf: (id: string) => void;
  onOpenCourse: (code: string) => void;
  onCommunity: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-1 pb-28 space-y-3 animate-slide-up">
      <div className="glass squircle-lg p-4" style={{ border: "1px solid rgba(0,122,255,0.18)" }}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-white">{s.blurb}</p>
          <button type="button" onClick={onCommunity} aria-label={s.communityProfile} className="haptic-action w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.08)" }}>👤</button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 px-3 py-2.5 squircle-sm" style={{ background: "var(--field-bg)", border: "1px solid var(--field-border)" }}>
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 shrink-0"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" /><path d="m14 14 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={mode === "prof" ? s.searchProfessors : s.searchCourses}
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-xs"
              style={{ color: "var(--app-text)" }}
            />
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: source === "live" ? "rgba(48,209,88,0.14)" : "rgba(255,159,10,0.14)", color: source === "live" ? "#30D158" : "#FF9F0A" }}>
              {source === "live" ? s.live : source === "demo" ? s.demoData : "…"}
            </span>
          </div>
        </div>
        <div className="flex rounded-full p-1 mt-3" style={{ background: "var(--seg-track)" }}>
          {(["prof", "course"] as const).map((m) => {
            const active = mode === m;
            return (
              <button key={m} type="button" onClick={() => onMode(m)} className="haptic-action flex-1 py-2 rounded-full text-[11px] font-bold transition-all"
                style={{ background: active ? "#007AFF" : "transparent", color: active ? "#fff" : "rgba(235,235,245,0.6)" }}>
                {m === "prof" ? `👨‍🏫 ${s.professors}` : `📚 ${s.courses}`}
              </button>
            );
          })}
        </div>
      </div>

      <InfoNote title={s.howTitle} body={s.howBody} icon="🕶️" />

      <div className="glass squircle-md overflow-hidden">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(235,235,245,0.45)" }}>
            {mode === "prof" ? `${s.professors} · ${profRows.length}` : `${s.courses} · ${courseRows.length}`}
          </p>
        </div>
        <div className="divide-y divide-white/5 pb-1">
          {mode === "prof"
            ? profRows.map((row) => <ProfessorRow key={row.id} row={row} onOpen={onOpenProf} />)
            : courseRows.map((row) => <CourseRow key={row.id} row={row} onOpen={onOpenCourse} />)}
        </div>
        {mode === "prof" && profRows.length === 0 && <EmptyState title={s.noResults} hint={s.noResultsHint} />}
        {mode === "course" && courseRows.length === 0 && <EmptyState title={s.noResults} hint={s.noResultsHint} />}
      </div>
    </div>
  );
}
function ProfReviewsView({ onBack, deepLink }: ProfReviewsProps) {
  const s = useRmpStrings();
  const t = useI18n();
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<"prof" | "course">("prof");
  const [query, setQuery] = useState("");
  const [profSel, setProfSel] = useState<SummaryRow | null>(null);
  const [courseSel, setCourseSel] = useState<{ code: string; title: string; department: string } | null>(null);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [acc, setAcc] = useState<CommunityAccount>(() => loadCommunityAccount());
  const [source, setSource] = useState<"checking" | "live" | "demo">("checking");
  const [extras, setExtras] = useState<FeedReview[]>([]);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    let cancelled = false;
    rmpApiUp().then((up) => {
      if (!cancelled) setSource(up ? "live" : "demo");
    });
    setExtras(loadExtraReviews().map((e) => extraToReview(e, "#007AFF")));
    return () => {
      cancelled = true;
    };
  }, []);

  const merged = useMemo<FeedReview[]>(() => [...REVIEWS, ...extras], [extras]);
  const reviewedIds = useMemo(() => communityReviewedSet(), [tick, acc.univerUsername]);

  const profRows = useMemo<SummaryRow[]>(() => {
    return PROFESSORS.map((p) => {
      const rs = merged.filter((r) => r.professorId === p.id);
      return { id: p.id, name: p.name, department: p.department, color: p.color, quality: avgOf(rs, "quality"), easy: avgOf(rs, "easy"), count: rs.length };
    });
  }, [merged]);

  const courseRows = useMemo<CourseSummaryRow[]>(() => {
    return COURSES.map((c) => {
      const rs = merged.filter((r) => r.courseCode === c.code);
      return { id: c.id, code: c.code, title: c.title, department: c.department, quality: avgOf(rs, "quality"), count: rs.length };
    });
  }, [merged]);

  const q = query.trim().toLowerCase();
  const shownProfs = useMemo(() => {
    const list = profRows.filter((p) => !q || p.name.toLowerCase().includes(q) || p.department.toLowerCase().includes(q));
    return [...list].sort((a, b) => b.quality - a.quality);
  }, [profRows, q]);

  const shownCourses = useMemo(() => {
    const list = courseRows.filter((c) => !q || c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.department.toLowerCase().includes(q));
    return list;
  }, [courseRows, q]);

  const courseStatsFor = (id: string) => {
    const codes = [...new Set(merged.filter((r) => r.professorId === id && r.courseCode).map((r) => r.courseCode))].filter(Boolean) as string[];
    return codes.map((code) => {
      const rs = merged.filter((r) => r.professorId === id && r.courseCode === code);
      return { code, quality: avgOf(rs, "quality"), count: rs.length };
    });
  };

  const openProf = (id: string) => {
    const row = profRows.find((r) => r.id === id);
    if (!row) return;
    setProfSel(row);
    setScreen("prof");
  };

  const openCourse = (code: string) => {
    const c = COURSES.find((x) => x.code === code);
    if (!c) return;
    setCourseSel({ code: c.code, title: c.title, department: c.department });
    setScreen("course");
  };

  // Deep link from Home / Schedule: jump straight to the professor's ratings.
  useEffect(() => {
    if (!deepLink) return;
    const profName = deepLink.professorName;
    if (profName) {
      const hit = matchProfessor(profName);
      if (hit) {
        const rs = merged.filter((r) => r.professorId === hit.id);
        setProfSel({ id: hit.id, name: hit.name, department: hit.department, color: hit.color, quality: avgOf(rs, "quality"), easy: avgOf(rs, "easy"), count: rs.length });
        setMode("prof");
        setQuery(profName);
        setScreen("prof");
        return;
      }
    }
    const courseName = deepLink.courseName;
    if (courseName) {
      const c = COURSES.find((x) => x.title.toLowerCase() === courseName.toLowerCase() || x.code.toLowerCase() === courseName.toLowerCase());
      if (c) {
        openCourse(c.code);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitReview = (input: { easy: number; quality: number; attendance: string; comment: string; tags: string[]; courseCode: string | null }) => {
    if (!profSel) return;
    const now = Date.now();
    const extra: ExtraReview = {
      professorId: profSel.id,
      courseCode: input.courseCode,
      easy: input.easy,
      quality: input.quality,
      attendance: input.attendance as "not_mandatory" | "recommended" | "mandatory",
      comment: input.comment,
      tags: input.tags,
      dept: acc.departmentTag,
      daysAgo: 0,
      createdAt: now,
    };
    appendExtraReview(extra);
    markReviewed(profSel.id);
    setExtras((prev) => [extraToReview(extra, profSel.color), ...prev]);
    setComposerId(null);
    setTick((x) => x + 1);
    showToast(`✓ ${s.savedOk} · ${profSel.name.split(" ")[0]}`);
    void rmpSubmitRemote({ professorName: profSel.name, courseCode: input.courseCode, easy: input.easy, quality: input.quality, attendance: input.attendance, comment: input.comment, tags: input.tags });
  };

  const onProfileSaved = (next: CommunityAccount) => {
    setAcc(next);
    setProfileOpen(false);
    showToast(`✓ ${s.savedOk}`);
  };

  const ATTENDANCE_SEEDS = ["not_mandatory", "recommended", "mandatory"];

  return (
    <div className="app-surface h-full flex flex-col overflow-hidden">
      {screen === "home" && (
        <div className="shrink-0 px-4 pt-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <BackChevron label={t("back")} onBack={onBack} />
            <h1 className="text-xl font-bold text-white flex items-center gap-1.5" style={{ letterSpacing: "-0.4px" }}>
              <span style={{ color: "#FFD60A" }}>⭐</span> {s.title}
            </h1>
            <span className="w-8" />
          </div>
        </div>
      )}

      {screen === "home" && (
        <HomeContent
          s={s}
          source={source}
          mode={mode}
          query={query}
          onQuery={setQuery}
          onMode={(m) => {
            setMode(m);
            setQuery("");
          }}
          profRows={shownProfs}
          courseRows={shownCourses}
          onOpenProf={openProf}
          onOpenCourse={openCourse}
          onCommunity={() => setProfileOpen(true)}
        />
      )}

      {screen === "prof" && profSel && (
        <ProfessorDetail
          s={s}
          row={profSel}
          reviews={merged.filter((r) => r.professorId === profSel.id).sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0))}
          courseStats={courseStatsFor(profSel.id)}
          reviewed={reviewedIds.has(profSel.id)}
          source={source}
          onBack={() => {
            setScreen("home");
            setQuery("");
          }}
          onCompose={() => setComposerId(profSel.id)}
          onOpenCourse={openCourse}
        />
      )}

      {screen === "course" && courseSel && (
        <CourseDetail
          s={s}
          course={courseSel}
          reviews={merged.filter((r) => r.courseCode === courseSel.code)}
          onBack={() => {
            setScreen("home");
            setQuery("");
          }}
          onOpenProfessor={openProf}
        />
      )}

      {composerId && profSel && (
        <ComposerScreen
          s={s}
          prof={profSel}
          attendanceSeeds={ATTENDANCE_SEEDS}
          courseChips={courseStatsFor(profSel.id).map((c) => ({ code: c.code, title: COURSES.find((x) => x.code === c.code)?.title ?? c.code }))}
          onClose={() => setComposerId(null)}
          onSubmitted={submitReview}
        />
      )}

      {profileOpen && <CommunitySheet s={s} acc={acc} onClose={() => setProfileOpen(false)} onSaved={onProfileSaved} />}

      {toast && (
        <div
          className="fixed left-1/2 z-[70] px-4 py-2.5 squircle-sm text-xs font-bold text-white shadow-lg"
          style={{
            top: "calc(env(safe-area-inset-top) + 14px)",
            transform: "translateX(-50%)",
            background: "rgba(16,185,129,0.92)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default ProfReviewsView;









