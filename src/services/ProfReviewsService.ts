/**
 * Prof Reviews — backend access (best-effort) + local community-account store.
 *
 * The phone test build is fully usable offline against the demo catalog.
 * When the 2.0 backend is reachable through VITE_API_URL, submissions are
 * mirrored to /api/v1 (login → anonymous_hash → one-rating-per-professor).
 */
import { API_BASE_URL } from "../utils/config";
import { readSavedAccount, readSession } from "../utils/session";

export const RMP_API = `${API_BASE_URL}/api/v1`;

export interface CommunityAccount {
  univerUsername: string;
  displayName: string;
  departmentTag: string;
  token?: string;
  isDefaultName: boolean;
}

const COMMUNITY_KEY = "kaznu:rmp:community";
const REVIEWED_KEY = "kaznu:rmp:reviewed";
const EXTRAS_KEY = "kaznu:rmp:extras";

export function randomDisplayName(): string {
  return `user${Math.floor(1000000 + Math.random() * 9000000)}`;
}

export function loadCommunityAccount(): CommunityAccount {
  const session = readSession();
  const username = (session?.username ?? session?.studentId ?? "").trim().toLowerCase();
  try {
    const raw = localStorage.getItem(COMMUNITY_KEY);
    if (raw) {
      const acc = JSON.parse(raw) as CommunityAccount;
      if (acc.univerUsername === username && acc.displayName) return acc;
    }
  } catch {
    /* ignore */
  }
  // First login → auto-assign a random default global display name (like the backend).
  const acc: CommunityAccount = {
    univerUsername: username,
    displayName: randomDisplayName(),
    departmentTag: "Computer Science Student",
    isDefaultName: true,
  };
  saveCommunityAccount(acc);
  return acc;
}

export function saveCommunityAccount(acc: CommunityAccount): void {
  try {
    localStorage.setItem(COMMUNITY_KEY, JSON.stringify(acc));
  } catch {
    /* ignore */
  }
}

export function communityReviewedSet(): Set<string> {
  const key = `${REVIEWED_KEY}:${loadCommunityAccount().univerUsername}`;
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markReviewed(professorId: string): void {
  const acc = loadCommunityAccount();
  const key = `${REVIEWED_KEY}:${acc.univerUsername}`;
  const set = communityReviewedSet();
  set.add(professorId);
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export interface ExtraReview {
  professorId: string;
  courseCode: string | null;
  easy: number;
  quality: number;
  attendance: "not_mandatory" | "recommended" | "mandatory";
  comment: string;
  tags: string[];
  dept: string;
  daysAgo: number;
  createdAt: number;
}

export function loadExtraReviews(): ExtraReview[] {
  const acc = loadCommunityAccount();
  try {
    const raw = localStorage.getItem(`${EXTRAS_KEY}:${acc.univerUsername}`);
    const arr = raw ? (JSON.parse(raw) as ExtraReview[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function appendExtraReview(review: ExtraReview): void {
  const acc = loadCommunityAccount();
  const list = loadExtraReviews();
  list.unshift(review);
  try {
    localStorage.setItem(`${EXTRAS_KEY}:${acc.univerUsername}`, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* ignore */
  }
}

// ---------- Backend (best-effort) ----------

async function apiFetch(path: string, init?: RequestInit, timeoutMs = 3500): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${RMP_API}${path}`, { ...init, signal: controller.signal });
    window.clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

export async function rmpApiUp(): Promise<boolean> {
  const res = await apiFetch("/professors?limit=1", undefined, 2200);
  return res !== null && res.ok;
}

/** Sign the current Univer session into the 2.0 backend and cache the token. */
export async function rmpEnsureToken(): Promise<string | null> {
  const acc = loadCommunityAccount();
  if (acc.token) return acc.token;
  const saved = readSavedAccount();
  const session = readSession();
  const username = acc.univerUsername || session?.username || session?.studentId || "20260001";
  const password = saved?.password || "123456";
  const res = await apiFetch(
    "/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, remember: true }),
    },
    4500,
  );
  if (!res || !res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  if (data.access_token) {
    saveCommunityAccount({ ...acc, token: data.access_token });
    return data.access_token;
  }
  return null;
}

export async function rmpSyncProfileRemote(): Promise<void> {
  const token = await rmpEnsureToken();
  if (!token) return;
  const acc = loadCommunityAccount();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (!acc.isDefaultName) {
    await apiFetch("/me/display-name", { method: "PATCH", headers, body: JSON.stringify({ display_name: acc.displayName }) }, 3500);
  }
  await apiFetch("/me/department-tag", { method: "PATCH", headers, body: JSON.stringify({ department_tag: acc.departmentTag }) }, 3500);
}

export interface RmpSubmitInput {
  professorName: string;
  courseCode?: string | null;
  easy: number;
  quality: number;
  attendance: string;
  comment: string;
  tags: string[];
}

/** Mirrors a local anonymous submission to the backend. Returns a status string or null. */
export async function rmpSubmitRemote(input: RmpSubmitInput): Promise<string | null> {
  const token = await rmpEnsureToken();
  if (!token) return null;
  const acc = loadCommunityAccount();
  const surname = input.professorName.split(" ").pop()?.replace(/\./g, "") ?? input.professorName;
  const profRes = await apiFetch(`/professors?q=${encodeURIComponent(surname)}`, undefined, 4000);
  if (!profRes || !profRes.ok) return null;
  const profs = (await profRes.json()) as Array<{ id: string; name: string }>;
  const prof = profs.find((p) => p.name.toLowerCase().includes(surname.toLowerCase())) ?? profs[0];
  if (!prof) return null;

  let courseId: string | null = null;
  if (input.courseCode) {
    const courseRes = await apiFetch(`/courses?q=${encodeURIComponent(input.courseCode)}`, undefined, 4000);
    if (courseRes && courseRes.ok) {
      const courses = (await courseRes.json()) as Array<{ id: string; code: string }>;
      courseId = courses.find((c) => c.code.toLowerCase() === input.courseCode?.toLowerCase())?.id ?? null;
    }
  }

  const res = await apiFetch(
    "/reviews",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        professor_id: prof.id,
        course_id: courseId,
        rating_easy: input.easy,
        rating_quality: input.quality,
        attendance_strictness: input.attendance,
        comment: input.comment,
        tags: input.tags,
        user_department_tag: acc.departmentTag,
      }),
    },
    5000,
  );
  if (!res) return null;
  if (res.ok) return "ok";
  if (res.status === 409) return "duplicate";
  return null;
}

