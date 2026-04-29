// Persistent, source-of-truth state for the notification permission flow.
//
// Goals (drives the Permissions screen UX):
//   1. Once the user grants notifications, never prompt again — even if they
//      re-open the app or replay onboarding.
//   2. Show a one-time "Notifications enabled" success confirmation right
//      after a fresh grant. After it's been seen once, never show again.
//   3. The "Retry" affordance on the notifications row is only visible if the
//      *last* attempt actually failed. Idle / first-run shows a normal CTA.
//   4. If the user previously granted notifications but later disabled them
//      at the OS / browser level, force the permissions screen to appear
//      one more time so we can re-request — but only once per "drop".
//
// This module is intentionally storage-only. The Permissions screen and the
// boot decision read from it; the actual OS prompt lives in Permissions.tsx.

const KEY = "tw-notification-state-v1";

export type NotifPhase =
  | "idle"        // never asked yet
  | "granted"    // OS/browser granted → no more prompts
  | "denied"     // last attempt failed → show Retry + reason
  | "disabled";  // was previously granted, now revoked → re-prompt once

export interface NotificationState {
  /** Most recent resolved phase. Drives the UI. */
  phase: NotifPhase;
  /** Last user-facing error reason, only set when phase === "denied". */
  lastError?: string | null;
  /** Last error subtype/name (e.g. "NotAllowedError"), debugging only. */
  lastErrorName?: string | null;
  /** Whether the one-time "Notifications enabled" toast has been shown. */
  successShown: boolean;
  /** Whether we've already forced a re-prompt for the current "disabled" drop. */
  rePromptShown: boolean;
  /** Last time we wrote this state — for debugging/audit only. */
  updatedAt: number;
}

const DEFAULT: NotificationState = {
  phase: "idle",
  lastError: null,
  lastErrorName: null,
  successShown: false,
  rePromptShown: false,
  updatedAt: 0,
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readNotificationState(): NotificationState {
  if (!isBrowser()) return { ...DEFAULT };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<NotificationState>;
    return {
      ...DEFAULT,
      ...parsed,
      // Sanitize phase in case storage was tampered with.
      phase: (["idle", "granted", "denied", "disabled"] as NotifPhase[]).includes(
        parsed.phase as NotifPhase,
      )
        ? (parsed.phase as NotifPhase)
        : "idle",
    };
  } catch {
    return { ...DEFAULT };
  }
}

function write(next: NotificationState): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...next, updatedAt: Date.now() }),
    );
  } catch {
    /* quota — non-fatal */
  }
}

/** Mark the latest attempt as a successful grant. */
export function markNotificationGranted(): NotificationState {
  const cur = readNotificationState();
  // If we're transitioning idle/denied/disabled → granted, the success cue
  // should be shown again (only one time, but a fresh grant deserves one).
  const successShown = cur.phase === "granted" ? cur.successShown : false;
  const next: NotificationState = {
    ...cur,
    phase: "granted",
    lastError: null,
    lastErrorName: null,
    successShown,
    rePromptShown: false,
  };
  write(next);
  return next;
}

/** Mark the latest attempt as a denial with a human-readable reason. */
export function markNotificationDenied(
  reason: string,
  errorName?: string | null,
): NotificationState {
  const cur = readNotificationState();
  const next: NotificationState = {
    ...cur,
    phase: "denied",
    lastError: reason || "Notification permission was not granted.",
    lastErrorName: errorName ?? null,
    successShown: cur.successShown,
  };
  write(next);
  return next;
}

/**
 * Detect a previously-granted permission that has since been revoked. If so,
 * transition the state to "disabled" so the boot flow can surface the
 * permissions screen once. No-op if the user never granted to begin with.
 */
export function reconcileNotificationState(
  liveStatus: "granted" | "denied" | "default" | "unknown",
): NotificationState {
  const cur = readNotificationState();
  if (cur.phase === "granted" && liveStatus === "denied") {
    const next: NotificationState = {
      ...cur,
      phase: "disabled",
      lastError: "Notifications were turned off in your device settings.",
      lastErrorName: "RevokedExternally",
      rePromptShown: false,
    };
    write(next);
    return next;
  }
  return cur;
}

/** Confirm the success cue has been shown once — never show it again. */
export function markSuccessShown(): NotificationState {
  const cur = readNotificationState();
  if (cur.successShown) return cur;
  const next: NotificationState = { ...cur, successShown: true };
  write(next);
  return next;
}

/** Confirm the forced re-prompt has happened — never auto-prompt again for this drop. */
export function markRePromptShown(): NotificationState {
  const cur = readNotificationState();
  if (cur.rePromptShown) return cur;
  const next: NotificationState = { ...cur, rePromptShown: true };
  write(next);
  return next;
}

/**
 * Whether the boot flow should force the Permissions screen back into view
 * because notifications were revoked since the last completion. Returns true
 * exactly once per revocation event.
 */
export function shouldForceReprompt(): boolean {
  const s = readNotificationState();
  return s.phase === "disabled" && !s.rePromptShown;
}

/** Reset everything — used by tests + the "sign out" path. */
export function resetNotificationState(): void {
  if (!isBrowser()) return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
