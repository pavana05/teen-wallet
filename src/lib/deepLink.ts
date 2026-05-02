/**
 * Tiny deep-link bus used by push notifications and other native entry points.
 * The push tap handler stores the desired target here and fires `tw:deeplink`;
 * any screen can listen and react (e.g. Transactions opens the matching txn).
 */
export type PendingDeepLink =
  | { kind: "transaction"; transactionId: string }
  | { kind: "notifications" }
  | { kind: "kyc"; status?: "approved" | "rejected" | "pending" }
  | { kind: "profile" }
  | { kind: "home" }
  | { kind: "scan" }
  | { kind: "referral" };

const KEY = "tw-pending-deeplink-v1";

export function setPendingDeepLink(link: PendingDeepLink) {
  try {
    localStorage.setItem(KEY, JSON.stringify(link));
  } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tw:deeplink", { detail: link }));
  }
}

export function consumePendingDeepLink(): PendingDeepLink | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return JSON.parse(raw) as PendingDeepLink;
  } catch {
    return null;
  }
}

export function peekPendingDeepLink(): PendingDeepLink | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingDeepLink) : null;
  } catch {
    return null;
  }
}
