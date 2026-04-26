/**
 * Lightweight correlation IDs for user-facing errors.
 *
 * Goal: every failure surfaced in the UI carries a short, copyable token that
 * matches a record in server logs (edge function logs, audit_log, notifications)
 * so support can pinpoint the exact request without asking the user to reproduce.
 *
 * Format: `tw_<8 lowercase hex chars>` — short enough to read aloud, unique enough
 * (~4 billion namespace) for a single user's lifetime of debugging.
 */

export function newCorrelationId(): string {
  // Prefer crypto.randomUUID where available; fall back to Math.random for old runtimes.
  try {
    const uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.();
    if (uuid) return `tw_${uuid.replace(/-/g, "").slice(0, 8)}`;
  } catch { /* fall through */ }
  return `tw_${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")}`;
}

/**
 * Build a friendly user-safe error message that always ends in "(ID: tw_xxxxxxxx)".
 * The ID half is what support pastes into log search.
 */
export function formatTaggedError(userSafeMessage: string, correlationId: string): string {
  return `${userSafeMessage} (ID: ${correlationId})`;
}
