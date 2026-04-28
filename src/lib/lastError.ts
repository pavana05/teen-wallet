// Lightweight global "last error" bus.
// Anywhere in the app can report an error; the GlobalErrorOverlay
// listens and presents a retry UI instead of leaving the user
// stuck on a shimmer or a blank screen.

export interface ReportedError {
  ts: number;
  message: string;
  source?: string; // e.g. "supabase", "rls", "session", "boot"
  code?: string | null;
  detail?: string | null;
  retry?: () => void | Promise<void>;
}

type Listener = (err: ReportedError | null) => void;

let current: ReportedError | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) {
    try { l(current); } catch { /* ignore */ }
  }
}

export function reportError(input: Omit<ReportedError, "ts"> & { ts?: number }): void {
  current = { ts: Date.now(), ...input };
  emit();
}

export function clearError(): void {
  current = null;
  emit();
}

export function getLastError(): ReportedError | null {
  return current;
}

export function subscribeError(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Convenience helper for Supabase / RLS style `{ error }` results. */
export function reportSupabaseError(
  err: { message?: string; code?: string | null; details?: string | null } | null | undefined,
  source: string,
  retry?: () => void | Promise<void>,
): void {
  if (!err) return;
  reportError({
    message: err.message || "Database request failed",
    source,
    code: err.code ?? null,
    detail: err.details ?? null,
    retry,
  });
}
