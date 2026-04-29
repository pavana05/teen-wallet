/**
 * Client-side helpers for inserting rich app notifications.
 *
 * The `notifications` table stores `type` as free text — these constants give
 * the rest of the app a single source of truth so the NotificationsPanel can
 * render the right icon/tint and we never typo a type string.
 *
 * All inserts go through the user's RLS-scoped supabase client (own rows only).
 *
 * Many helpers are throttled with localStorage so we don't spam the feed
 * (e.g. greetings fire once per slot/day, low-balance once per dip).
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type NotifType =
  | "welcome"
  | "greeting"           // good morning/afternoon/evening
  | "transaction"        // outgoing payment (legacy)
  | "payment_sent"
  | "payment_received"
  | "payment_pending"    // payment processing taking longer than expected
  | "payment_failed"
  | "low_balance"
  | "fraud"
  | "alert"
  | "issue"              // app/runtime issue surfaced to the user
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
    console.warn("[notify] insert failed", { type, error: error.message });
  }
}

const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ */
/* Throttle helpers                                                    */
/* ------------------------------------------------------------------ */

function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}
function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Welcome (one per user per day)                                      */
/* ------------------------------------------------------------------ */

const WELCOME_KEY = "tw-welcome-greeted-v1";
interface GreetedRecord { userId: string; day: string }

export async function maybeInsertWelcome(userId: string, fullName: string | null) {
  if (typeof window === "undefined") return;
  const today = new Date().toISOString().slice(0, 10);
  const prev = readJSON<GreetedRecord>(WELCOME_KEY);
  if (prev && prev.userId === userId && prev.day === today) return;

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  const title = firstName ? `Welcome back, ${firstName}! 👋` : "Welcome back! 👋";
  await insertNotification({
    userId,
    type: "welcome",
    title,
    body: "Glad to see you again. Your wallet is ready.",
  });
  writeJSON(WELCOME_KEY, { userId, day: today } satisfies GreetedRecord);
}

/* ------------------------------------------------------------------ */
/* Time-of-day greeting (good morning/afternoon/evening)               */
/* once per (user, day, slot)                                          */
/* ------------------------------------------------------------------ */

const GREETING_KEY = "tw-greeting-v1";
type Slot = "morning" | "afternoon" | "evening" | "night";
interface GreetingRecord { userId: string; day: string; slot: Slot }

function currentSlot(d = new Date()): Slot {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

const GREETING_COPY: Record<Slot, { title: (n: string) => string; body: string; emoji: string }> = {
  morning:   { title: (n) => `Good morning${n ? `, ${n}` : ""}! ☀️`, body: "Have a great day ahead.",            emoji: "☀️" },
  afternoon: { title: (n) => `Good afternoon${n ? `, ${n}` : ""} 🌤️`, body: "Hope your day's going well.",        emoji: "🌤️" },
  evening:   { title: (n) => `Good evening${n ? `, ${n}` : ""} 🌙`,   body: "Wrapping up the day? We're with you.", emoji: "🌙" },
  night:     { title: (n) => `Hi${n ? `, ${n}` : ""} 🌌`,             body: "Up late? Pay safely.",                emoji: "🌌" },
};

export async function maybeInsertGreeting(userId: string, fullName: string | null) {
  if (typeof window === "undefined") return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const slot = currentSlot(now);
  const prev = readJSON<GreetingRecord>(GREETING_KEY);
  if (prev && prev.userId === userId && prev.day === day && prev.slot === slot) return;

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  const copy = GREETING_COPY[slot];
  await insertNotification({
    userId,
    type: "greeting",
    title: copy.title(firstName),
    body: copy.body,
  });
  writeJSON(GREETING_KEY, { userId, day, slot } satisfies GreetingRecord);
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export async function notifyPaymentReceived(
  userId: string,
  amount: number,
  fromName?: string | null,
  meta?: { upiId?: string | null; note?: string | null },
) {
  const formatted = fmtINR(amount);
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

export async function notifyPaymentSent(
  userId: string,
  amount: number,
  payeeName: string,
  meta?: { upiId?: string | null; txnId?: string | null },
) {
  const title = `${fmtINR(amount)} paid to ${payeeName}`;
  const bodyParts = [meta?.upiId, meta?.txnId ? `Ref ${meta.txnId.slice(0, 8)}` : null].filter(Boolean) as string[];
  await insertNotification({
    userId,
    type: "payment_sent",
    title,
    body: bodyParts.length > 0 ? bodyParts.join(" · ") : "Tap to view receipt",
  });
}

export async function notifyPaymentFailed(
  userId: string,
  amount: number,
  payeeName: string | null,
  reason: string | null,
) {
  const title = payeeName
    ? `${fmtINR(amount)} to ${payeeName} failed`
    : `Payment of ${fmtINR(amount)} failed`;
  await insertNotification({
    userId,
    type: "payment_failed",
    title,
    body: reason ?? "Please retry. No money was deducted.",
  });
}

export async function notifyPaymentPending(
  userId: string,
  amount: number,
  payeeName: string | null,
) {
  const title = payeeName
    ? `${fmtINR(amount)} to ${payeeName} is processing`
    : `Payment of ${fmtINR(amount)} is processing`;
  await insertNotification({
    userId,
    type: "payment_pending",
    title,
    body: "Taking longer than usual. We'll update you as soon as it clears.",
  });
}

/* ------------------------------------------------------------------ */
/* Low balance — fires once per dip below threshold                    */
/* ------------------------------------------------------------------ */

const LOW_BAL_KEY = "tw-lowbal-v1";
interface LowBalRecord { userId: string; below: boolean }

export async function maybeNotifyLowBalance(userId: string, balance: number, threshold = 100) {
  const prev = readJSON<LowBalRecord>(LOW_BAL_KEY);
  const isBelow = balance < threshold;
  // Only notify on transition from "above" → "below".
  if (isBelow && (!prev || prev.userId !== userId || !prev.below)) {
    await notifyLowBalance(userId, balance, threshold);
  }
  writeJSON(LOW_BAL_KEY, { userId, below: isBelow } satisfies LowBalRecord);
}

export async function notifyLowBalance(userId: string, balance: number, threshold = 100) {
  await insertNotification({
    userId,
    type: "low_balance",
    title: `Low balance · ${fmtINR(balance)}`,
    body: `Your wallet dropped below ${fmtINR(threshold)}. Top up to keep paying.`,
  });
}

/* ------------------------------------------------------------------ */
/* App issue — runtime errors surfaced to the user                     */
/* Throttled to one every 10 minutes so we don't flood the feed.       */
/* ------------------------------------------------------------------ */

const ISSUE_KEY = "tw-issue-v1";
interface IssueRecord { userId: string; at: number }
const ISSUE_THROTTLE_MS = 10 * 60 * 1000;

export async function notifyAppIssue(userId: string, title: string, body?: string | null) {
  const prev = readJSON<IssueRecord>(ISSUE_KEY);
  if (prev && prev.userId === userId && Date.now() - prev.at < ISSUE_THROTTLE_MS) return;
  await insertNotification({ userId, type: "issue", title, body: body ?? null });
  writeJSON(ISSUE_KEY, { userId, at: Date.now() } satisfies IssueRecord);
}

/* ------------------------------------------------------------------ */
/* Toast + notification combo (for actions that should also flash UI)  */
/* ------------------------------------------------------------------ */

export function toastAndNotify(
  userId: string | null,
  kind: "success" | "error" | "info",
  title: string,
  body?: string,
  type: NotifType = "alert",
) {
  if (kind === "success") toast.success(title, { description: body });
  else if (kind === "error") toast.error(title, { description: body });
  else toast(title, { description: body });
  if (userId) void insertNotification({ userId, type, title, body: body ?? null });
}
