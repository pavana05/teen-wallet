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

export type NotifType =
  | "welcome"
  | "transaction"        // outgoing payment (legacy / payment_sent)
  | "payment_sent"
  | "payment_received"
  | "low_balance"
  | "fraud"
  | "alert"
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
