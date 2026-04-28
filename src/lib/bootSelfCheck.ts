// Startup self-check: validates that persisted onboarding stage,
// permissions flag, and the supabase auth session expiry are all
// internally consistent. Returns either a routing decision or a
// structured inconsistency that the boot route uses to render a
// one-tap error screen.
//
// This runs synchronously off localStorage where possible and
// asynchronously when it needs to confirm the live auth session.

import type { Stage } from "./store";

export const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";
export const PERSIST_KEY = "teenwallet-app";
export const SUPABASE_AUTH_KEY_PREFIX = "sb-";
export const SUPABASE_AUTH_KEY_SUFFIX = "-auth-token";

export const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

export type SelfCheckCode =
  | "STAGE_WITHOUT_USER"
  | "PERMS_WITHOUT_STAGE"
  | "SESSION_EXPIRED"
  | "PERSIST_CORRUPT"
  | "USER_MISMATCH";

export interface SelfCheckIssue {
  code: SelfCheckCode;
  message: string;
  details: Record<string, unknown>;
}

export interface SelfCheckSnapshot {
  stage: Stage;
  userId: string | null;
  permsSeen: boolean;
  hasSession: boolean;
  sessionExpiresAt: number | null;
  sessionUserId: string | null;
}

export interface SelfCheckResult {
  snapshot: SelfCheckSnapshot;
  issues: SelfCheckIssue[];
  ok: boolean;
}

/** Synchronously read persisted store snapshot from localStorage. */
export function readPersistedSnapshot(storage?: Storage): { stage: Stage; userId: string | null; corrupt: boolean } {
  const ls = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!ls) return { stage: "STAGE_0", userId: null, corrupt: false };
  const raw = ls.getItem(PERSIST_KEY);
  if (!raw) return { stage: "STAGE_0", userId: null, corrupt: false };
  try {
    const parsed = JSON.parse(raw) as { state?: { stage?: Stage; userId?: string | null } };
    const stage = parsed?.state?.stage ?? "STAGE_0";
    const userId = parsed?.state?.userId ?? null;
    if (!(stage in stageRank)) {
      return { stage: "STAGE_0", userId: null, corrupt: true };
    }
    return { stage, userId, corrupt: false };
  } catch {
    return { stage: "STAGE_0", userId: null, corrupt: true };
  }
}

/** Read perms-seen flag synchronously from storage. */
export function readPermsSeen(storage?: Storage): boolean {
  const ls = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!ls) return false;
  try { return ls.getItem(PERMISSIONS_DONE_KEY) === "1"; }
  catch { return false; }
}

/**
 * Best-effort synchronous read of the Supabase session token from
 * localStorage. Avoids the async auth.getSession() call so the boot
 * route can decide a destination before any UI mounts.
 */
export function readSessionFromStorage(storage?: Storage): { hasSession: boolean; expiresAt: number | null; userId: string | null } {
  const ls = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!ls) return { hasSession: false, expiresAt: null, userId: null };
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key) continue;
      if (!key.startsWith(SUPABASE_AUTH_KEY_PREFIX) || !key.endsWith(SUPABASE_AUTH_KEY_SUFFIX)) continue;
      const raw = ls.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        expires_at?: number;
        currentSession?: { expires_at?: number; user?: { id?: string } };
        user?: { id?: string };
      };
      const expiresAt =
        (typeof parsed.expires_at === "number" ? parsed.expires_at : undefined) ??
        (typeof parsed.currentSession?.expires_at === "number" ? parsed.currentSession.expires_at : undefined) ??
        null;
      const userId = parsed.user?.id ?? parsed.currentSession?.user?.id ?? null;
      // expires_at is a unix timestamp (seconds). Treat missing as no session.
      if (expiresAt == null) return { hasSession: false, expiresAt: null, userId };
      const stillValid = expiresAt * 1000 > Date.now();
      return { hasSession: stillValid, expiresAt, userId };
    }
  } catch {
    return { hasSession: false, expiresAt: null, userId: null };
  }
  return { hasSession: false, expiresAt: null, userId: null };
}

/** Run all consistency checks and return the structured result. */
export function runSelfCheck(storage?: Storage, now: number = Date.now()): SelfCheckResult {
  const persisted = readPersistedSnapshot(storage);
  const permsSeen = readPermsSeen(storage);
  const session = readSessionFromStorage(storage);

  const snapshot: SelfCheckSnapshot = {
    stage: persisted.stage,
    userId: persisted.userId,
    permsSeen,
    hasSession: session.hasSession,
    sessionExpiresAt: session.expiresAt,
    sessionUserId: session.userId,
  };

  const issues: SelfCheckIssue[] = [];

  if (persisted.corrupt) {
    issues.push({
      code: "PERSIST_CORRUPT",
      message: "Saved app state is corrupted and could not be read.",
      details: {},
    });
  }

  // Stage advanced past phone-verified but no userId persisted — store is desynced.
  if (stageRank[persisted.stage] >= stageRank["STAGE_3"] && !persisted.userId) {
    issues.push({
      code: "STAGE_WITHOUT_USER",
      message: `Onboarding stage is ${persisted.stage} but no user is signed in locally.`,
      details: { stage: persisted.stage },
    });
  }

  // Permissions accepted requires the user to have completed phone verification.
  if (permsSeen && stageRank[persisted.stage] < stageRank["STAGE_3"]) {
    issues.push({
      code: "PERMS_WITHOUT_STAGE",
      message: `Permissions are marked granted but onboarding stage is only ${persisted.stage}.`,
      details: { stage: persisted.stage },
    });
  }

  // Persisted user but the auth session expired or is missing.
  if (persisted.userId && session.expiresAt != null && session.expiresAt * 1000 <= now) {
    issues.push({
      code: "SESSION_EXPIRED",
      message: "Your sign-in session has expired.",
      details: { expiresAt: session.expiresAt },
    });
  }

  // Persisted user does not match the supabase session user.
  if (persisted.userId && session.userId && persisted.userId !== session.userId) {
    issues.push({
      code: "USER_MISMATCH",
      message: "Saved user does not match the active sign-in session.",
      details: { persistedUserId: persisted.userId, sessionUserId: session.userId },
    });
  }

  return { snapshot, issues, ok: issues.length === 0 };
}

/** Best-effort recovery: clears the inconsistent local state so the
 *  user can restart onboarding cleanly. */
export function resetLocalAppState(storage?: Storage): void {
  const ls = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!ls) return;
  try { ls.removeItem(PERSIST_KEY); } catch { /* ignore */ }
  try { ls.removeItem(PERMISSIONS_DONE_KEY); } catch { /* ignore */ }
}
