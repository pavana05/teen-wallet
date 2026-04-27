/**
 * receiptDelivery
 * ---------------
 * Tracks the user's most recent delivery attempt per transaction so we can
 * show a "last sent via Email · just now" hint on the receipt actions.
 *
 * We can't truly know if a mailto:/sms:/wa.me deep link succeeded — the
 * platform hands off to another app. We record an "attempted" status
 * immediately, and (where the Web Share API resolves) upgrade it to "sent".
 * "failed" is recorded when an error is thrown synchronously.
 *
 * Storage: localStorage, capped at 200 entries (FIFO eviction). Per-txn
 * state survives reloads so the user can see what they last did.
 */

export type ReceiptChannel = "email" | "sms" | "whatsapp" | "share" | "download";
export type ReceiptDeliveryStatus = "attempted" | "sent" | "failed";

export interface ReceiptDelivery {
  txnId: string;
  channel: ReceiptChannel;
  status: ReceiptDeliveryStatus;
  attemptedAt: string; // ISO
}

const KEY = "tw-receipt-deliveries-v1";
const MAX_ENTRIES = 200;

function readAll(): ReceiptDelivery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReceiptDelivery[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: ReceiptDelivery[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = list.slice(-MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded — ignore */
  }
}

/** Record (or update) a delivery attempt. Returns the saved record. */
export function recordReceiptDelivery(
  txnId: string,
  channel: ReceiptChannel,
  status: ReceiptDeliveryStatus = "attempted",
): ReceiptDelivery {
  const all = readAll();
  // Drop any prior entry for the same (txnId, channel) so the latest wins.
  const filtered = all.filter((d) => !(d.txnId === txnId && d.channel === channel));
  const entry: ReceiptDelivery = {
    txnId,
    channel,
    status,
    attemptedAt: new Date().toISOString(),
  };
  filtered.push(entry);
  writeAll(filtered);
  // Notify any in-tab listeners (the same window won't get a `storage` event).
  try {
    window.dispatchEvent(new CustomEvent("tw-receipt-delivery", { detail: entry }));
  } catch {
    /* ignore */
  }
  return entry;
}

/** Most-recent delivery attempt for a transaction (any channel), or null. */
export function getLastDelivery(txnId: string): ReceiptDelivery | null {
  const matches = readAll().filter((d) => d.txnId === txnId);
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
  return matches[matches.length - 1];
}

/** All deliveries for a transaction, oldest first. */
export function getDeliveriesFor(txnId: string): ReceiptDelivery[] {
  return readAll()
    .filter((d) => d.txnId === txnId)
    .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
}

/** Human-readable channel label. */
export function channelLabel(c: ReceiptChannel): string {
  switch (c) {
    case "email": return "Email";
    case "sms": return "SMS";
    case "whatsapp": return "WhatsApp";
    case "share": return "Share";
    case "download": return "Download";
  }
}

/** Human-readable status label (with status verb). */
export function statusLabel(s: ReceiptDeliveryStatus): string {
  switch (s) {
    case "attempted": return "Opened";
    case "sent": return "Sent";
    case "failed": return "Failed";
  }
}

/** "just now" / "2 min ago" / "Yesterday" style. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return "just now";
  if (sec < 90) return "1 min ago";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 5400) return "1 hr ago";
  if (sec < 86400) return `${Math.round(sec / 3600)} hr ago`;
  if (sec < 172800) return "yesterday";
  return `${Math.round(sec / 86400)} days ago`;
}
