/**
 * Offline-first action queue.
 *
 * Queues SAFE, non-financial mutations to localStorage and replays them with
 * exponential backoff when the network returns. Each kind of action has an
 * executor registered in `EXECUTORS` so the queue itself stays generic.
 *
 * NOT for payments or KYC submissions — those are time-sensitive and must
 * fail loud rather than be silently replayed later. Use the `payments`/`kyc`
 * code paths directly and let them surface a "no internet" error.
 *
 * Operations supported:
 *   - profile_update          — update fields on public.profiles (own row)
 *   - notif_mark_read         — set notifications.read = true
 *   - notif_mark_all_read     — set read = true for the user's notifications
 *   - notif_delete            — delete a notification row
 *   - issue_report_submit     — insert a row into issue_reports
 *   - contact_upsert          — insert or update a row in contacts
 *   - contact_delete          — delete a contact row
 */
import { supabase } from "@/integrations/supabase/client";

export type QueuedKind =
  | "profile_update"
  | "notif_mark_read"
  | "notif_mark_all_read"
  | "notif_delete"
  | "issue_report_submit"
  | "contact_upsert"
  | "contact_delete";

export interface QueuedAction<P = Record<string, unknown>> {
  /** Stable client-generated id (also used for idempotency / dedupe). */
  id: string;
  kind: QueuedKind;
  payload: P;
  /** Number of attempts made so far. */
  attempts: number;
  /** Epoch ms — when we may next retry. */
  nextAttemptAt: number;
  /** Epoch ms when first enqueued. */
  enqueuedAt: number;
  /** Last error string (if any). */
  lastError?: string;
}

const STORAGE_KEY = "tw-offline-queue-v1";
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 2_000;       // first retry after 2s
const MAX_BACKOFF_MS = 5 * 60_000;    // cap at 5min
const FLUSH_INTERVAL_MS = 15_000;    // background flush tick

// ---------- storage ----------

function safeRead(): QueuedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function safeWrite(items: QueuedAction[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota or private mode — drop silently */
  }
}

// ---------- public API ----------

type Listener = (state: { pending: number; lastError: string | null; flushing: boolean }) => void;
const listeners = new Set<Listener>();
let flushing = false;
let lastError: string | null = null;

function emit() {
  const snap = { pending: getPendingCount(), lastError, flushing };
  listeners.forEach((l) => { try { l(snap); } catch { /* ignore */ } });
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  // emit current state immediately so consumers can render synchronously
  l({ pending: getPendingCount(), lastError, flushing });
  return () => { listeners.delete(l); };
}

export function getPendingCount(): number {
  return safeRead().length;
}

export function getQueueSnapshot(): QueuedAction[] {
  return safeRead();
}

export function clearQueue() {
  safeWrite([]);
  lastError = null;
  emit();
}

function genId(): string {
  return (
    "q_" + Date.now().toString(36) + "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Enqueue an action. If the network is online and not currently flushing,
 * we attempt to run it immediately so the happy path stays fast.
 */
export async function enqueue<K extends QueuedKind>(
  kind: K,
  payload: Parameters<(typeof EXECUTORS)[K]>[0],
  opts: { immediate?: boolean } = {}
): Promise<{ executed: boolean; queued: boolean; id: string }> {
  const id = genId();

  // Try immediate execution first when online — keeps the UX snappy and
  // avoids polluting the queue with one-off successes.
  if (opts.immediate !== false && isOnline()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (EXECUTORS[kind] as any)(payload);
      return { executed: true, queued: false, id };
    } catch (err) {
      // Fall through to enqueue and let the retry loop handle it.
      console.warn("[offlineQueue] immediate execution failed, queuing:", kind, err);
    }
  }

  const action: QueuedAction = {
    id,
    kind,
    payload: payload as unknown as Record<string, unknown>,
    attempts: 0,
    nextAttemptAt: Date.now(),
    enqueuedAt: Date.now(),
  };

  const all = safeRead();
  all.push(action);
  safeWrite(all);
  emit();

  // Kick off a flush attempt right away if we're online (covers the case
  // where immediate execution was skipped because opts.immediate=false).
  if (isOnline()) void flush();
  return { executed: false, queued: true, id };
}

// ---------- executors ----------
//
// Each executor receives a typed payload and either resolves (success) or
// throws (will be retried). They MUST be idempotent or operate on rows the
// caller controls (RLS scopes everything per-user).

interface ProfileUpdatePayload { fields: Record<string, unknown>; }
interface NotifMarkReadPayload { id: string; }
interface NotifMarkAllReadPayload { userId: string; }
interface NotifDeletePayload { id: string; }
interface IssueReportPayload {
  category: string;
  message: string;
  route?: string | null;
  user_agent?: string | null;
  app_version?: string | null;
  user_id?: string | null;
  console_errors?: unknown[];
  stack_trace?: string | null;
  screenshot_path?: string | null;
}
interface ContactUpsertPayload {
  id?: string; user_id: string; name: string; upi_id: string;
  phone?: string | null; emoji?: string | null; verified?: boolean;
}
interface ContactDeletePayload { id: string; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOwnUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

const EXECUTORS = {
  profile_update: async (p: ProfileUpdatePayload) => {
    const userId = await getOwnUserId();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("profiles").update(p.fields as any).eq("id", userId);
    if (error) throw error;
  },
  notif_mark_read: async (p: NotifMarkReadPayload) => {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", p.id);
    if (error) throw error;
  },
  notif_mark_all_read: async (p: NotifMarkAllReadPayload) => {
    const { error } = await supabase
      .from("notifications").update({ read: true })
      .eq("user_id", p.userId).eq("read", false);
    if (error) throw error;
  },
  notif_delete: async (p: NotifDeletePayload) => {
    const { error } = await supabase.from("notifications").delete().eq("id", p.id);
    if (error) throw error;
  },
  issue_report_submit: async (p: IssueReportPayload) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("issue_reports").insert(p as any);
    if (error) throw error;
  },
  contact_upsert: async (p: ContactUpsertPayload) => {
    if (p.id) {
      const { error } = await supabase.from("contacts").update({
        name: p.name, upi_id: p.upi_id, phone: p.phone ?? null,
        emoji: p.emoji ?? null, verified: p.verified ?? false,
      }).eq("id", p.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("contacts").insert({
        user_id: p.user_id, name: p.name, upi_id: p.upi_id,
        phone: p.phone ?? null, emoji: p.emoji ?? null,
        verified: p.verified ?? false,
      });
      if (error) throw error;
    }
  },
  contact_delete: async (p: ContactDeletePayload) => {
    const { error } = await supabase.from("contacts").delete().eq("id", p.id);
    if (error) throw error;
  },
} as const;

// ---------- network detection ----------

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

// ---------- flush loop ----------

function backoffMs(attempts: number): number {
  // attempts is the count BEFORE this retry (0 → first retry)
  const ms = BASE_BACKOFF_MS * Math.pow(2, attempts);
  return Math.min(ms, MAX_BACKOFF_MS);
}

/**
 * Attempt to drain the queue. Safe to call concurrently — re-entrancy is
 * guarded so only one flush runs at a time.
 */
export async function flush(): Promise<{ ran: number; failed: number; remaining: number }> {
  if (flushing) return { ran: 0, failed: 0, remaining: getPendingCount() };
  if (!isOnline()) return { ran: 0, failed: 0, remaining: getPendingCount() };

  flushing = true; emit();
  let ran = 0, failed = 0;
  try {
    // Process actions one at a time so we don't hammer the backend on a
    // weak connection. Re-read the queue between actions because executors
    // may add follow-up actions in the future.
    while (true) {
      if (!isOnline()) break;
      const all = safeRead();
      const now = Date.now();
      const next = all.find((a) => a.nextAttemptAt <= now && a.attempts < MAX_ATTEMPTS);
      if (!next) break;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (EXECUTORS[next.kind] as any)(next.payload);
        // success — drop from queue
        safeWrite(safeRead().filter((a) => a.id !== next.id));
        lastError = null;
        ran++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        const updated = safeRead().map((a) => {
          if (a.id !== next.id) return a;
          const attempts = a.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            // Give up on this action — leave it in the queue with a flag
            // so the user can inspect/retry/discard manually if a UI is
            // exposed for it later.
            return { ...a, attempts, lastError: message, nextAttemptAt: Number.MAX_SAFE_INTEGER };
          }
          return { ...a, attempts, lastError: message, nextAttemptAt: Date.now() + backoffMs(attempts) };
        });
        safeWrite(updated);
        // Stop the loop on the first failure so we respect the backoff
        // for that action; the next tick will pick up other ready actions.
        break;
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return { ran, failed, remaining: getPendingCount() };
}

// ---------- background lifecycle ----------

let installed = false;
let intervalHandle: number | undefined;

/**
 * Install online/offline listeners and a periodic flush tick. Idempotent —
 * safe to call multiple times.
 */
export function installOfflineQueue() {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("online", () => { void flush(); });
  window.addEventListener("focus", () => { void flush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });

  intervalHandle = window.setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);

  // First boot — try to drain anything left over from the previous session.
  if (isOnline()) void flush();
}

/** Tear down — used by tests. */
export function __resetOfflineQueueForTests() {
  if (typeof window !== "undefined" && intervalHandle !== undefined) {
    window.clearInterval(intervalHandle);
  }
  installed = false;
  intervalHandle = undefined;
  flushing = false;
  lastError = null;
  listeners.clear();
}
