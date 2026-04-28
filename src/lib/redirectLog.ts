// Lightweight redirect breadcrumb log persisted to localStorage.
// Used to troubleshoot any future onboarding ↔ home jumps. Safe to no-op on SSR.
//
// Each entry captures: when, where the navigation came from, where it went,
// the persisted onboarding stage at decision time, and whether a Supabase
// session was present. We keep the last N entries (ring buffer) so the log
// never grows unbounded.

const KEY = "tw_last_redirect_v1";
const MAX_ENTRIES = 25;

export interface RedirectEntry {
  ts: number;            // epoch ms
  from: string;          // pathname we came from (or "boot")
  to: string;            // pathname we navigated to
  stage: string;         // persisted onboarding_stage at decision time
  session: boolean;      // whether a session existed
  reason?: string;       // free-form short reason (e.g. "boot_decide", "guard_block")
}

function safeRead(): RedirectEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function safeWrite(entries: RedirectEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function recordRedirect(entry: Omit<RedirectEntry, "ts">) {
  const next = safeRead();
  next.push({ ...entry, ts: Date.now() });
  safeWrite(next);
}

export function readRedirects(): RedirectEntry[] {
  return safeRead();
}

export function lastRedirect(): RedirectEntry | null {
  const all = safeRead();
  return all.length ? all[all.length - 1] : null;
}

export function clearRedirects() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
