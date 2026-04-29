/**
 * Advanced notification toasts.
 *
 * Bridges our `notifications` feed (DB-backed, persistent) to rich sonner
 * toasts (ephemeral, in-the-moment) so the user gets:
 *
 *  - the right severity (success / error / warning / info)
 *  - useful context (description line, optional action button)
 *  - lifecycle updates for payments (one toast id mutates pending → final)
 *  - no duplicates (toast id keys collapse repeats)
 *
 * Toasts are best-effort UI sugar. If sonner is unavailable for any reason
 * (SSR, missing provider) every helper silently no-ops.
 */
import { toast, type ExternalToast } from "sonner";
import type { NotifType } from "./notify";

const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Stable id-per-attempt so pending/success/failed collapse into one row. */
export const attemptToastId = (attemptId: string) => `tw:attempt:${attemptId}`;

/** Stable id for "type-only" toasts so reissues replace, not stack. */
const typeToastId = (type: NotifType) => `tw:type:${type}`;

interface BaseOpts extends ExternalToast {
  description?: string;
}

function safeToast(kind: "success" | "error" | "info" | "warning" | "message", msg: string, opts?: BaseOpts) {
  try {
    if (kind === "message") return toast(msg, opts);
    return toast[kind](msg, opts);
  } catch {
    /* ignore */
  }
}

// ─── Greetings & welcome ─────────────────────────────────────────────────────

export function toastWelcome(title: string, body?: string | null) {
  safeToast("message", title, {
    description: body ?? undefined,
    duration: 4000,
    id: typeToastId("welcome"),
  });
}

export function toastGreeting(title: string, body?: string | null) {
  safeToast("message", title, {
    description: body ?? undefined,
    duration: 3500,
    id: typeToastId("greeting"),
  });
}

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * Show a *live* pending toast when a payment enters processing.
 * Use the returned id (or call attemptToastId) to update later.
 */
export function toastPaymentPending(attemptId: string, amount: number, payeeName: string) {
  const id = attemptToastId(attemptId);
  try {
    toast.loading(`Paying ${fmtINR(amount)} to ${payeeName}…`, {
      id,
      description: "Waiting for the bank to confirm. This usually takes a few seconds.",
      duration: 30_000, // long-lived; will be replaced by terminal toast
    });
  } catch {
    /* ignore */
  }
  return id;
}

/** Mutate the pending toast into a success toast (same id → in-place update). */
export function toastPaymentReceived(
  attemptId: string | null,
  amount: number,
  fromName?: string | null,
  opts?: { onView?: () => void },
) {
  const id = attemptId ? attemptToastId(attemptId) : undefined;
  const title = fromName
    ? `${fmtINR(amount)} received from ${fromName}`
    : `${fmtINR(amount)} credited`;
  safeToast("success", title, {
    id,
    description: "Added to your wallet.",
    duration: 5000,
    action: opts?.onView ? { label: "View", onClick: opts.onView } : undefined,
  });
}

export function toastPaymentSent(
  attemptId: string | null,
  amount: number,
  payeeName: string,
  opts?: { onView?: () => void },
) {
  const id = attemptId ? attemptToastId(attemptId) : undefined;
  safeToast("success", `${fmtINR(amount)} sent to ${payeeName}`, {
    id,
    description: "Payment confirmed by the bank.",
    duration: 5000,
    action: opts?.onView ? { label: "Receipt", onClick: opts.onView } : undefined,
  });
}

export function toastPaymentFailed(
  attemptId: string | null,
  amount: number,
  payeeName: string,
  reason?: string | null,
  opts?: { onRetry?: () => void },
) {
  const id = attemptId ? attemptToastId(attemptId) : undefined;
  safeToast("error", `Payment of ${fmtINR(amount)} to ${payeeName} failed`, {
    id,
    description: (reason && reason.trim()) || "Tap retry to try again.",
    duration: 7000,
    action: opts?.onRetry ? { label: "Retry", onClick: opts.onRetry } : undefined,
  });
}

// ─── Wallet & account warnings ───────────────────────────────────────────────

export function toastLowBalance(balance: number, threshold: number, opts?: { onTopUp?: () => void }) {
  safeToast("warning", `Low balance · ${fmtINR(balance)}`, {
    id: typeToastId("low_balance"),
    description: `You're below ${fmtINR(threshold)}. Top up to keep paying.`,
    duration: 6000,
    action: opts?.onTopUp ? { label: "Top up", onClick: opts.onTopUp } : undefined,
  });
}

export function toastFraudAlert(title: string, body?: string | null, opts?: { onReview?: () => void }) {
  safeToast("error", title, {
    id: typeToastId("fraud"),
    description: body ?? "We blocked a suspicious action on your account.",
    duration: 10_000,
    action: opts?.onReview ? { label: "Review", onClick: opts.onReview } : undefined,
  });
}

// ─── Issues / support ────────────────────────────────────────────────────────

export function toastIssueSubmitted(category: string) {
  safeToast("success", "Report received 🛠️", {
    id: typeToastId("issue_submitted"),
    description: `Thanks for flagging this (${category}). We're on it.`,
    duration: 4500,
  });
}

export function toastIssueResolved(title: string, body?: string | null) {
  safeToast("success", title, {
    id: typeToastId("issue_resolved"),
    description: body ?? "Your reported issue has been resolved.",
    duration: 5000,
  });
}

// ─── Offers ──────────────────────────────────────────────────────────────────

export function toastOffer(title: string, body?: string | null, opts?: { onOpen?: () => void }) {
  safeToast("message", title, {
    id: typeToastId("offer"),
    description: body ?? undefined,
    duration: 6000,
    action: opts?.onOpen ? { label: "Open", onClick: opts.onOpen } : undefined,
  });
}

// ─── Generic dismiss helper ──────────────────────────────────────────────────

export function dismissToast(id?: string) {
  try {
    if (id) toast.dismiss(id);
    else toast.dismiss();
  } catch {
    /* ignore */
  }
}
