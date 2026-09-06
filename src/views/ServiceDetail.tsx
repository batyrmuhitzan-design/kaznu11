import { useI18n, type AllTranslationKey } from "../contexts/LanguageContext";
import { triggerHaptic } from "../utils/haptics";

export type ServiceId = "attestation" | "journal" | "plan" | "transcript" | "onlineTest" | "debt" | "fx" | "anketa";

type ChipKey = "pass" | "fail" | "inProgress" | "planned" | "open" | "due" | "retake";

interface Row {
  name?: string;
  nameKey?: AllTranslationKey;
  meta?: string;
  right?: string;
  chip?: ChipKey;
  pct?: number;
}

interface Section {
  heading?: string;
  rows: Row[];
}

interface DetailData {
  icon: string;
  key: AllTranslationKey;
  accent: string;
  sourceUniver: boolean;
  sections: Section[];
  action?: "start" | "register";
}

const CHIP_META: Record<ChipKey, { k: AllTranslationKey; color: string; bg: string }> = {
  pass: { k: "statusPass", color: "#30D158", bg: "rgba(48,209,88,0.15)" },
  fail: { k: "statusNotPass", color: "#FF453A", bg: "rgba(255,69,58,0.14)" },
  inProgress: { k: "statusInProgress", color: "#409CFF", bg: "rgba(0,122,255,0.15)" },
  planned: { k: "statusPlanned", color: "#7B79F7", bg: "rgba(94,92,230,0.16)" },
  open: { k: "statusOpen", color: "#30D158", bg: "rgba(48,209,88,0.15)" },
  due: { k: "statusDue", color: "#FF9F0A", bg: "rgba(255,159,10,0.15)" },
  retake: { k: "statusRetake", color: "#7B79F7", bg: "rgba(94,92,230,0.16)" },
};

const SVC: Record<ServiceId, { icon: string; key: AllTranslationKey; accent: string }> = {
  attestation: { icon: "📋", key: "serviceAttestation", accent: "#007AFF" },
  journal: { icon: "📊", key: "serviceJournal", accent: "#5E5CE6" },
  plan: { icon: "🗺️", key: "servicePlan", accent: "#30D158" },
  transcript: { icon: "📜", key: "serviceTranscript", accent: "#FF9F0A" },
  onlineTest: { icon: "💻", key: "serviceOnlineTest", accent: "#FF453A" },
  debt: { icon: "💸", key: "serviceDebt", accent: "#FF9F0A" },
  fx: { icon: "🔁", key: "serviceFx", accent: "#5E5CE6" },
  anketa: { icon: "🪪", key: "serviceStudentAnketa", accent: "#007AFF" },
};

function buildData(id: ServiceId): DetailData {
  const meta = SVC[id];
  const base: DetailData = { ...meta, sourceUniver: true, sections: [] };
  switch (id) {
    case "attestation":
      return {
        ...base,
        sections: [{
          rows: [
            { name: "Linear Algebra", meta: "5 ECTS · Attestation 1 ✓", chip: "pass" },
            { name: "Higher Mathematics II", meta: "5 ECTS · Attestation 1 ✓", chip: "pass" },
            { name: "Data Structures", meta: "4 ECTS · Attestation 1", chip: "inProgress" },
            { name: "Physics II", meta: "5 ECTS · Attestation 1", chip: "inProgress" },
          ],
        }],
      };
    case "journal":
      return {
        ...base,
        sections: [{
          rows: [
            { name: "Higher Mathematics II", meta: "29 / 30", right: "97%", pct: 97, chip: "pass" },
            { name: "Linear Algebra", meta: "27 / 30", right: "90%", pct: 90, chip: "pass" },
            { name: "Data Structures", meta: "24 / 26", right: "92%", pct: 92, chip: "inProgress" },
            { name: "Physics Lab", meta: "21 / 24", right: "88%", pct: 88, chip: "inProgress" },
            { name: "English C1", meta: "18 / 20", right: "90%", pct: 90, chip: "pass" },
          ],
        }],
      };
    case "plan":
      return {
        ...base,
        sections: [
          {
            heading: "2025–2026 · 3rd year",
            rows: [
              { name: "Physics II", meta: "5 ECTS", chip: "inProgress" },
              { name: "Data Structures", meta: "4 ECTS", chip: "inProgress" },
              { name: "Higher Mathematics II", meta: "5 ECTS", chip: "pass" },
            ],
          },
          {
            heading: "2026–2027 · 4th year",
            rows: [
              { name: "Machine Learning", meta: "5 ECTS", chip: "planned" },
              { name: "Diploma Project", meta: "12 ECTS", chip: "planned" },
            ],
          },
        ],
      };
    case "transcript":
      return {
        ...base,
        sections: [{
          rows: [
            { name: "2024–2025 · Fall", meta: "30 ECTS", right: "3.70", chip: "pass" },
            { name: "2024–2025 · Spring", meta: "28 ECTS", right: "3.78", chip: "pass" },
            { name: "2025–2026 · Fall", meta: "30 ECTS", right: "3.82", chip: "pass" },
            { name: "Cumulative GPA", meta: "88 / 240 ECTS", right: "3.82", chip: "pass" },
          ],
        }],
      };
    case "onlineTest":
      return {
        ...base,
        sourceUniver: false,
        action: "start",
        sections: [{
          rows: [
            { name: "Programming Fundamentals", meta: "20 questions · 40 min", chip: "open" },
            { name: "Linear Algebra Quiz 3", meta: "10 questions · 20 min", chip: "open" },
            { name: "Data Structures Test 1", meta: "25 questions · 50 min", chip: "open" },
          ],
        }],
      };
    case "debt":
      return {
        ...base,
        sections: [{
          rows: [
            { name: "History of Kazakhstan", meta: "2 ECTS · Fall 2024", chip: "fail" },
            { name: "Chemistry", meta: "4 ECTS · Spring 2025", chip: "due" },
          ],
        }],
      };
    case "fx":
      return {
        ...base,
        action: "register",
        sections: [{
          rows: [
            { name: "History of Kazakhstan", meta: "Commission · Aug 25, 10:00", chip: "retake" },
            { name: "Chemistry", meta: "Summer retake · Aug 28, 14:00", chip: "retake" },
          ],
        }],
      };
    case "anketa":
      return {
        ...base,
        sourceUniver: true,
        sections: [{
          rows: [
            { nameKey: "fullName", meta: "Bekova Aisha Nurzhanovna" },
            { nameKey: "birthDate", meta: "25.06.2006" },
            { nameKey: "iin", meta: "030625-450987" },
            { nameKey: "citizenship", meta: "Kazakhstan" },
            { nameKey: "studentId", meta: "20260001" },
            { nameKey: "faculty", meta: "Faculty of Information Technology" },
            { nameKey: "specialty", meta: "Computer Science · 6B06101" },
            { nameKey: "groupName", meta: "FIT-301" },
            { nameKey: "email", meta: "aisha.bekova@kaznu.kz" },
            { nameKey: "phone", meta: "+7 (700) 123-45-67" },
            { nameKey: "address", meta: "Al-Farabi ave. 71, Almaty" },
          ],
        }],
      };
  }
}
function RowChip({ chip }: { chip: ChipKey }) {
  const t = useI18n();
  const c = CHIP_META[chip];
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0" style={{ background: c.bg, color: c.color }}>
      {t(c.k)}
    </span>
  );
}

export default function ServiceDetail({ id, onBack }: { id: ServiceId; onBack: () => void }) {
  const t = useI18n();
  const data = buildData(id);

  return (
    <div className="app-surface h-full overflow-y-auto">
      <div className="px-4 pt-2 pb-32 animate-slide-up">
        <button type="button" onClick={onBack} className="haptic-action theme-secondary flex items-center gap-1 text-sm font-semibold">
          <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="m12.5 4-5 6 5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t("back")}
        </button>

        <div className="flex items-center gap-3 mt-4 mb-1">
          <div className="w-12 h-12 squircle-lg flex items-center justify-center text-2xl" style={{ background: `${data.accent}1f`, border: `1px solid ${data.accent}33` }}>{data.icon}</div>
          <h1 className="text-2xl font-bold text-white flex-1" style={{ letterSpacing: "-0.5px" }}>{t(data.key)}</h1>
        </div>

        {data.sourceUniver && (
          <div className="mt-2 mb-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "rgba(0,122,255,0.1)", border: "1px solid rgba(0,122,255,0.2)" }}>
            <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5 shrink-0"><path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5A1 1 0 003.4 15h13.2a1 1 0 00.9-1.5L16 11V8a6 6 0 00-6-6zM8 16a2 2 0 004 0H8z" fill="#409CFF" /></svg>
            <p className="text-[11px] font-semibold" style={{ color: "#409CFF" }}>{t("univerNote")}</p>
          </div>
        )}

        <div className="space-y-3">
          {data.sections.map((section, si) => (
            <div key={si} className="glass squircle-lg overflow-hidden card-shadow">
              {section.heading && (
                <p className="text-xs font-bold px-4 pt-3 pb-1" style={{ color: "rgba(235,235,245,0.6)" }}>{section.heading}</p>
              )}
              <div className="divide-y divide-white/5">
                {section.rows.map((row, ri) => (
                  <div key={ri} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{row.nameKey ? t(row.nameKey) : row.name}</p>
                      {row.meta && <p className="text-[11px] mt-0.5" style={{ color: "rgba(235,235,245,0.45)" }}>{row.meta}</p>}
                      {typeof row.pct === "number" && (
                        <div className="mt-1.5 h-1 rounded-full overflow-hidden meter-track" style={{ maxWidth: 150 }}>
                          <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: "#30D158" }} />
                        </div>
                      )}
                    </div>
                    {row.right && (
                      <span className="text-sm font-bold shrink-0" style={{ color: data.accent, fontFamily: "JetBrains Mono", fontVariantNumeric: "tabular-nums" }}>{row.right}</span>
                    )}
                    {row.chip && <RowChip chip={row.chip} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {data.action && (
          <button
            type="button"
            onClick={() => triggerHaptic(8)}
            className="haptic-action w-full mt-4 py-3.5 squircle-md text-sm font-bold transition-transform active:scale-95"
            style={{ background: data.accent, color: "#fff", boxShadow: `0 8px 22px ${data.accent}55` }}
          >
            {data.action === "start" ? `▶ ${t("actionStart")}` : `✓ ${t("actionRegister")}`}
          </button>
        )}
      </div>
    </div>
  );
}
