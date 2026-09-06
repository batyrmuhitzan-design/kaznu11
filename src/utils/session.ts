/**
 * 登录会话（原型阶段先存 localStorage；之后换成 iOS Keychain / 后端 token）。
 * 规则：
 *  - 勾选“记住账号” → 登录信息本地保存，下次进 App 自动登录；
 *  - 超过 15 天没有打开/登录过 → 会话过期，需要重新输密码验证；
 *  - 未勾选“记住账号” → 本次会话只在内存里有效，下次打开仍要输密码。
 */

export const SESSION_STORAGE_KEY = "kaznu:session";
export const REMEMBER_FLAG_KEY = "kaznu:remember";
export const SAVED_ACCOUNT_KEY = "kaznu:savedAccount";
export const LAST_USERNAME_KEY = "kaznu:lastUsername";

/** 距离上次活跃超过 N 天则要求重新验证 */
export const SESSION_TTL_DAYS = 15;
const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionData {
  username: string;
  displayName: string;
  studentId: string;
  loggedAt: number;
  /** 最近一次活跃（打开 App / 登录），用于 15 天失效判定 */
  lastActiveAt: number;
}

export interface SavedAccount {
  username: string;
  password: string;
  displayName: string;
  studentId: string;
  savedAt: number;
}

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function readSession(): SessionData | null {
  const parsed = safeGet<Partial<SessionData>>(SESSION_STORAGE_KEY);
  if (!parsed?.username || typeof parsed.loggedAt !== "number") return null;
  return {
    username: parsed.username,
    displayName: parsed.displayName ?? parsed.username,
    studentId: parsed.studentId ?? "",
    loggedAt: parsed.loggedAt,
    lastActiveAt: parsed.lastActiveAt ?? parsed.loggedAt,
  };
}

/** 是否开启了“自动登录”（上次登录勾选过记住账号） */
export function isAutoLoginEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 会话是否仍有效：
 *  - 必须开启过“记住账号/自动登录”；
 *  - 距离上次活跃（lastActiveAt）未超过 15 天。
 */
export function isSessionValid(): boolean {
  if (!isAutoLoginEnabled()) return false;
  const s = readSession();
  if (!s) return false;
  const ageMs = Date.now() - s.lastActiveAt;
  return ageMs >= 0 && ageMs < TTL_MS;
}

/** 打开 App 时“活跃”一次，滚动 15 天窗口（仅当会话当前有效时） */
export function touchSession() {
  const s = readSession();
  if (!s || !isSessionValid()) return;
  s.lastActiveAt = Date.now();
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function saveSession(
  input: { username: string; password: string; displayName: string; studentId: string },
  remember: boolean,
): SessionData {
  const now = Date.now();
  const session: SessionData = {
    username: input.username,
    displayName: input.displayName,
    studentId: input.studentId,
    loggedAt: now,
    lastActiveAt: now,
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    localStorage.setItem(REMEMBER_FLAG_KEY, remember ? "true" : "false");
    if (remember) {
      const account: SavedAccount = { ...input, savedAt: now };
      localStorage.setItem(SAVED_ACCOUNT_KEY, JSON.stringify(account));
    } else {
      localStorage.removeItem(SAVED_ACCOUNT_KEY);
    }
    localStorage.setItem(LAST_USERNAME_KEY, JSON.stringify(input.username));
  } catch {
    /* 存储不可用时忽略 */
  }
  return session;
}

/** 记住的账号（含密码），用于 15 天后重新验证时预填 */
export function readSavedAccount(): SavedAccount | null {
  return safeGet<SavedAccount>(SAVED_ACCOUNT_KEY);
}

/** 上次登录过的用户名（不记住时也预填用户名） */
export function readLastUsername(): string {
  try {
    return JSON.parse(localStorage.getItem(LAST_USERNAME_KEY) ?? "null") ?? "";
  } catch {
    return "";
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(REMEMBER_FLAG_KEY);
    localStorage.removeItem(SAVED_ACCOUNT_KEY);
    localStorage.removeItem(LAST_USERNAME_KEY);
  } catch {
    /* ignore */
  }
}

