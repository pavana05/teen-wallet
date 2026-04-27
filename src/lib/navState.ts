/**
 * Unified onboarding navigation breadcrumb.
 *
 * Persists the *last completed action* the user took during the boot/onboarding
 * funnel so the next cold launch can resume on the exact same screen + sub-state
 * (e.g. "onboarding slide 2", "OTP entry", "permissions: camera granted",
 *  "KYC step 2 saved", "KYC pending poll").
 *
 * This is intentionally separate from the Zustand `stage` field — `stage` is the
 * coarse funnel step persisted to Supabase (`profiles.onboarding_stage`), while
 * this file is the per-screen micro-state that lets us honor "resume at the
 * exact slide and action the user last completed."
 *
 * Stored entirely client-side. Never contains PII beyond an opaque step name.
 */

import type { Stage } from "@/lib/store";

export type NavScreen =
  | "splash"
  | "onboarding"
  | "auth"
  | "permissions"
  | "kyc"
  | "kyc_pending"
  | "home";

export type NavAction =
  // Onboarding
  | "onboarding_slide_viewed"
  | "onboarding_completed"
  // Auth
  | "auth_phone_entered"
  | "auth_otp_sent"
  | "auth_otp_verified"
  // Permissions
  | "permission_granted"
  | "permission_denied"
  | "permissions_completed"
  // KYC
  | "kyc_step_completed"
  | "kyc_submitted"
  | "kyc_pending_polled"
  | "kyc_approved"
  // Home
  | "home_reached";

export interface NavCheckpoint {
  screen: NavScreen;
  action: NavAction;
  /** Free-form sub-state, e.g. slide index, step number, permission key. */
  detail?: Record<string, string | number | boolean | null>;
  /** Coarse funnel stage at the time of the action — for cross-checking. */
  stage?: Stage;
  /** Epoch ms. */
  at: number;
}

const KEY = "tw-nav-checkpoint-v1";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function recordCheckpoint(c: Omit<NavCheckpoint, "at">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: NavCheckpoint = { ...c, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function readCheckpoint(): NavCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavCheckpoint;
    if (!parsed?.at || Date.now() - parsed.at > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Map a checkpoint to the screen the app should resume on. Single source of
 * truth used by both the boot router and the transition tests.
 */
export function resumeScreenFor(c: NavCheckpoint | null): NavScreen {
  if (!c) return "splash";
  switch (c.action) {
    case "onboarding_slide_viewed":
      return "onboarding";
    case "onboarding_completed":
    case "auth_phone_entered":
    case "auth_otp_sent":
      return "auth";
    case "auth_otp_verified":
    case "permission_granted":
    case "permission_denied":
      return "permissions";
    case "permissions_completed":
    case "kyc_step_completed":
      return "kyc";
    case "kyc_submitted":
    case "kyc_pending_polled":
      return "kyc_pending";
    case "kyc_approved":
    case "home_reached":
      return "home";
    default:
      return c.screen;
  }
}
