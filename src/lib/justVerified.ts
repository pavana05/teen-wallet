import type { Stage } from "@/lib/store";

/**
 * Short-lived flag that lets us re-show the "Phone verified" success screen
 * after a refresh that lands within a few seconds of the original verify.
 * Keeps the experience smooth — without this, a refresh during the celebration
 * would dump the user back into the OTP input.
 *
 * The flag is intentionally short (default 10s) — long enough to cover
 * accidental refreshes, but short enough that it never blocks a returning
 * user from seeing the real next screen.
 */

const KEY = "tw-just-verified";
const DEFAULT_TTL_MS = 10_000;

export function markJustVerified(ttlMs = DEFAULT_TTL_MS) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ttl: ttlMs }));
  } catch { /* ignore quota */ }
}

export function isJustVerified(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at?: number; ttl?: number };
    if (typeof parsed.at !== "number") return false;
    const ttl = typeof parsed.ttl === "number" ? parsed.ttl : DEFAULT_TTL_MS;
    return Date.now() - parsed.at <= ttl;
  } catch { return false; }
}

export function clearJustVerified() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Compute the next stage to land on after Phone Verified, given a fresh
 * profile snapshot. Mirrors the resume logic in AuthPhone.handleVerify so
 * "Continue" always honors the latest backend state — even if the profile
 * updated in the background while the celebration was on screen.
 */
export function resolveStageFromProfile(p: {
  onboarding_stage: Stage | string | null | undefined;
  kyc_status: string | null | undefined;
} | null): Stage {
  if (!p) return "STAGE_3";
  const profileStage = (p.onboarding_stage ?? "STAGE_3") as Stage;
  const kyc = p.kyc_status ?? null;
  if (kyc === "approved") return "STAGE_5";
  if (kyc === "pending") return "STAGE_4";
  if (profileStage === "STAGE_0" || profileStage === "STAGE_1" || profileStage === "STAGE_2") {
    return "STAGE_3";
  }
  return profileStage;
}
