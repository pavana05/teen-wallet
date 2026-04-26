/**
 * Persisted OTP UX state — survives a refresh so the user doesn't lose progress
 * mid-verification. Also classifies and logs OTP error types for cross-device debugging.
 */
import { supabase } from "@/integrations/supabase/client";

const KEY = "tw-otp-state";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export type OtpErrorKind = "network" | "invalid" | "expired" | "rate_limited" | "unknown";

export interface PersistedOtp {
  phone: string;
  digits: string[];
  error: string;
  errorKind: OtpErrorKind | null;
  busy: boolean;
  resendBlockedUntil: number | null; // epoch ms
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

export function classifyOtpError(e: unknown): { message: string; kind: OtpErrorKind } {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const lower = raw.toLowerCase();

  const isNetwork =
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed") ||
    (e instanceof TypeError && lower.includes("fetch"));
  if (isNetwork) {
    return {
      kind: "network",
      message:
        "Couldn't reach our servers. Check your connection and tap Try again.",
    };
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return { kind: "rate_limited", message: "Too many attempts. Please wait a minute before trying again." };
  }
  if (lower.includes("expired")) {
    return { kind: "expired", message: "This code expired. Tap Resend to get a new one." };
  }
  if (lower.includes("invalid") && (lower.includes("otp") || lower.includes("code") || lower.includes("token"))) {
    return { kind: "invalid", message: "Re-enter the 6-digit code — that one didn't match." };
  }
  return { kind: "unknown", message: raw || "Verification failed. Please try again." };
}

/**
 * Best-effort classification log. Stored as a notification row keyed to the user
 * (when one exists) so support can correlate cross-device issues. Silently ignored
 * if the user isn't signed in yet (which is normal for OTP verification).
 */
export async function logOtpErrorEvent(kind: OtpErrorKind, detail: string, phone: string) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return; // pre-auth — nothing to log against
    await supabase.from("notifications").insert({
      user_id: data.user.id,
      type: "otp_debug",
      title: `OTP error: ${kind}`,
      body: `phone=${phone.slice(-4).padStart(phone.length, "•")} • ${detail.slice(0, 240)}`,
    });
  } catch {
    /* logging is best-effort */
  }
}
