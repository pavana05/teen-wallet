/**
 * Persisted OTP UX state — survives a refresh so the user doesn't lose progress
 * mid-verification. Also classifies and logs OTP error types for cross-device debugging.
 *
 * Every classified error carries a `correlationId` (`tw_xxxxxxxx`) that is:
 *  - shown to the user next to the error so they can copy/paste it to support,
 *  - written to `notifications` (when signed in) and to console.error so it can be
 *    grepped in worker/edge logs.
 */
import { supabase } from "@/integrations/supabase/client";
import { newCorrelationId } from "@/lib/errorIds";

const KEY = "tw-otp-state";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export type OtpErrorKind = "network" | "invalid" | "expired" | "rate_limited" | "unknown";

export interface PersistedOtp {
  phone: string;
  digits: string[];
  error: string;
  errorKind: OtpErrorKind | null;
  correlationId: string | null;
  busy: boolean;
  resendBlockedUntil: number | null; // epoch ms
  resendCount?: number;              // # of resends in this attempt window
  cooldownTotalMs?: number | null;   // total duration of the *current* cooldown
  savedAt: number;
}

export function loadOtpState(): PersistedOtp | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedOtp;
    if (!s.savedAt || Date.now() - s.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveOtpState(s: Omit<PersistedOtp, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
  } catch {
    /* quota — ignore */
  }
}

export function clearOtpState() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export interface ClassifiedOtpError {
  message: string;
  kind: OtpErrorKind;
  correlationId: string;
}

export function classifyOtpError(e: unknown): ClassifiedOtpError {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const lower = raw.toLowerCase();
  const correlationId = newCorrelationId();

  const isNetwork =
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed") ||
    (e instanceof TypeError && lower.includes("fetch"));

  let base: { kind: OtpErrorKind; message: string };
  if (isNetwork) {
    base = { kind: "network", message: "Couldn't reach our servers. Check your connection and tap Try again." };
  } else if (lower.includes("rate") || lower.includes("too many")) {
    base = { kind: "rate_limited", message: "Too many attempts. Please wait a minute before trying again." };
  } else if (lower.includes("expired")) {
    base = { kind: "expired", message: "This code expired. Tap Resend to get a new one." };
  } else if (lower.includes("invalid") && (lower.includes("otp") || lower.includes("code") || lower.includes("token"))) {
    base = { kind: "invalid", message: "Re-enter the 6-digit code — that one didn't match." };
  } else {
    base = { kind: "unknown", message: raw || "Verification failed. Please try again." };
  }

  // Mirror to console with the ID so it's grep-able in worker logs.
  // eslint-disable-next-line no-console
  console.error(`[otp] ${base.kind} ${correlationId}: ${raw}`);
  return { ...base, correlationId };
}

/**
 * Best-effort classification log. Stored as a notification row keyed to the user
 * (when one exists) so support can correlate cross-device issues. Silently ignored
 * if the user isn't signed in yet (which is normal for OTP verification).
 */
export async function logOtpErrorEvent(kind: OtpErrorKind, detail: string, phone: string, correlationId: string) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return; // pre-auth — nothing to log against
    await supabase.from("notifications").insert({
      user_id: data.user.id,
      type: "otp_debug",
      title: `OTP error: ${kind} [${correlationId}]`,
      body: `phone=${phone.slice(-4).padStart(phone.length, "•")} • id=${correlationId} • ${detail.slice(0, 220)}`,
    });
  } catch {
    /* logging is best-effort */
  }
}

