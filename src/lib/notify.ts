/**
 * Client-side helpers for inserting rich app notifications.
 *
 * The `notifications` table stores `type` as free text — these constants give
 * the rest of the app a single source of truth so the NotificationsPanel can
 * render the right icon/tint and we never typo a type string.
 *
 * All inserts go through the user's RLS-scoped supabase client (own rows only).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  toastWelcome,
  toastGreeting,
  toastPaymentReceived,
  toastPaymentFailed,
  toastPaymentPending,
  toastLowBalance,
  toastFraudAlert,
  toastIssueSubmitted,
  toastIssueResolved,
  toastOffer,
} from "./notifyToast";

export type NotifType =
  | "welcome"
  | "greeting"           // good morning / afternoon / evening
  | "transaction"        // outgoing payment (legacy / payment_sent)
  | "payment_sent"
  | "payment_received"
  | "payment_failed"
  | "payment_pending"
  | "low_balance"
  | "fraud"
  | "alert"
  | "issue_submitted"
  | "issue_resolved"
  | "offer";

interface InsertArgs {
  userId: string;
  type: NotifType;
  title: string;
  body?: string | null;
}

export async function insertNotification({ userId, type, title, body = null }: InsertArgs) {
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
  });
  if (error) {
    // Notifications are non-critical — log and swallow so callers don't break flows.
    console.warn("[notify] insert failed", { type, error: error.message });
  }
}

/**
 * Welcome notification — fires once per (user, calendar day) so we greet the
 * user when they cold-open the app, but don't spam on tab switches.
 */
const WELCOME_KEY = "tw-welcome-greeted-v1";

interface GreetedRecord { userId: string; day: string }

export async function maybeInsertWelcome(userId: string, fullName: string | null) {
  if (typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    const raw = localStorage.getItem(WELCOME_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as GreetedRecord;
      if (prev.userId === userId && prev.day === today) return;
    }
  } catch {
    // ignore corrupt entries — we'll overwrite below
  }

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  const title = firstName ? `Welcome back, ${firstName}! 👋` : "Welcome back! 👋";
  const body = "Glad to see you again. Your wallet is ready.";

  await insertNotification({ userId, type: "welcome", title, body });

  try {
    localStorage.setItem(WELCOME_KEY, JSON.stringify({ userId, day: today } satisfies GreetedRecord));
  } catch {
    // localStorage may be unavailable (private mode) — best-effort only
  }
}

/**
 * Payment received — call when an external credit lands on the account
 * (parent top-up, refund, cashback settlement, peer payment, etc.).
 */
export async function notifyPaymentReceived(
  userId: string,
  amount: number,
  fromName?: string | null,
  meta?: { upiId?: string | null; note?: string | null },
) {
  const formatted = `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const title = fromName
    ? `${formatted} received from ${fromName}`
    : `${formatted} credited to your wallet`;
  const bodyParts = [meta?.note, meta?.upiId].filter(Boolean) as string[];
  await insertNotification({
    userId,
    type: "payment_received",
    title,
    body: bodyParts.length > 0 ? bodyParts.join(" · ") : "Tap to view in History",
  });
}

/** Optional helper for low-balance warnings used by Home/balance watcher. */
export async function notifyLowBalance(userId: string, balance: number, threshold: number) {
  const title = `Low balance · ₹${balance.toLocaleString("en-IN")}`;
  const body = `Your wallet dropped below ₹${threshold.toLocaleString("en-IN")}. Top up to keep paying.`;
  await insertNotification({ userId, type: "low_balance", title, body });
}

/**
 * Time-of-day greeting — fires once per (user, day-part) so the user sees a
 * "Good morning / afternoon / evening" notification on the first session of
 * each day-part. Not spammy: stored in localStorage with a daily reset.
 */
const GREETING_KEY = "tw-greeting-v1";
type DayPart = "morning" | "afternoon" | "evening" | "night";

function currentDayPart(d: Date = new Date()): DayPart {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

const GREETINGS: Record<DayPart, { emoji: string; label: string; body: string }> = {
  morning:   { emoji: "☀️", label: "Good morning",   body: "Have a great day ahead — your wallet is ready." },
  afternoon: { emoji: "🌤️", label: "Good afternoon", body: "Hope your day is going well." },
  evening:   { emoji: "🌆", label: "Good evening",   body: "Wrap up your day with a quick payment if needed." },
  night:     { emoji: "🌙", label: "Good night",     body: "Late one? We're here whenever you need us." },
};

interface GreetingRecord { userId: string; day: string; part: DayPart }

export async function maybeInsertGreeting(userId: string, fullName: string | null) {
  if (typeof window === "undefined") return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const part = currentDayPart(now);
  try {
    const raw = localStorage.getItem(GREETING_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as GreetingRecord;
      if (prev.userId === userId && prev.day === today && prev.part === part) return;
    }
  } catch {
    // ignore
  }

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  const g = GREETINGS[part];
  const title = firstName ? `${g.emoji} ${g.label}, ${firstName}!` : `${g.emoji} ${g.label}!`;
  await insertNotification({ userId, type: "greeting", title, body: g.body });

  try {
    localStorage.setItem(GREETING_KEY, JSON.stringify({ userId, day: today, part } satisfies GreetingRecord));
  } catch {
    // best-effort
  }
}

/** Payment failed notification — call from ScanPay when an attempt enters `failed` stage. */
export async function notifyPaymentFailed(
  userId: string,
  amount: number,
  payeeName: string,
  reason?: string | null,
) {
  const formatted = `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const title = `Payment of ${formatted} to ${payeeName} failed`;
  const body = (reason && reason.trim()) ? reason : "Tap to retry from History.";
  await insertNotification({ userId, type: "payment_failed", title, body });
}

/** Payment taking longer than expected — call when a payment stays in processing too long. */
export async function notifyPaymentPending(
  userId: string,
  amount: number,
  payeeName: string,
) {
  const formatted = `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const title = `Payment of ${formatted} to ${payeeName} is pending`;
  const body = "Bank is taking longer than usual. We'll update you as soon as it settles.";
  await insertNotification({ userId, type: "payment_pending", title, body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-attempt deduplication
// Ensures we never spam the user with duplicate pending/terminal notifications
// for the same payment attempt across re-renders, route changes, or app reloads.
// ─────────────────────────────────────────────────────────────────────────────
const ATTEMPT_NOTIF_KEY = "tw-attempt-notif-v1";

type AttemptNotifMap = Record<string, { pending?: boolean; terminal?: boolean }>;

function readAttemptMap(): AttemptNotifMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ATTEMPT_NOTIF_KEY);
    return raw ? (JSON.parse(raw) as AttemptNotifMap) : {};
  } catch {
    return {};
  }
}

function writeAttemptMap(map: AttemptNotifMap) {
  if (typeof window === "undefined") return;
  try {
    // Cap at last 50 attempts to keep storage tiny.
    const keys = Object.keys(map);
    if (keys.length > 50) {
      const trimmed: AttemptNotifMap = {};
      keys.slice(-50).forEach((k) => { trimmed[k] = map[k]; });
      map = trimmed;
    }
    window.localStorage.setItem(ATTEMPT_NOTIF_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

/** Returns true the FIRST time it's called for this (attemptId, kind); false thereafter. */
function claimAttemptNotif(attemptId: string, kind: "pending" | "terminal"): boolean {
  const map = readAttemptMap();
  const cur = map[attemptId] ?? {};
  if (cur[kind]) return false;
  cur[kind] = true;
  map[attemptId] = cur;
  writeAttemptMap(map);
  return true;
}

/**
 * Send a single "pending" notification for an attempt. No-op if already sent.
 * Call this exactly once when the attempt enters the processing phase.
 */
export async function notifyAttemptPendingOnce(
  attemptId: string,
  userId: string,
  amount: number,
  payeeName: string,
) {
  if (!claimAttemptNotif(attemptId, "pending")) return;
  await notifyPaymentPending(userId, amount, payeeName);
}

/**
 * Send a single terminal ("failed" or "received") notification for an attempt.
 * No-op if a terminal notification was already sent for this attempt.
 */
export async function notifyAttemptTerminalOnce(
  attemptId: string,
  outcome: "failed" | "received",
  userId: string,
  amount: number,
  payeeName: string,
  reason?: string | null,
) {
  if (!claimAttemptNotif(attemptId, "terminal")) return;
  if (outcome === "failed") {
    await notifyPaymentFailed(userId, amount, payeeName, reason);
  } else {
    await notifyPaymentReceived(userId, amount, payeeName);
  }
}

/** Issue report submitted — give the user confirmation in their notification feed. */
export async function notifyIssueSubmitted(userId: string, category: string) {
  const title = "Report received 🛠️";
  const body = `Thanks for flagging this (${category}). Our team will look into it shortly.`;
  await insertNotification({ userId, type: "issue_submitted", title, body });
}

