import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Zap, ZapOff, X, Share2, Check, Bug, ShieldCheck, Wallet, Users, User as UserIcon, QrCode, Download, RotateCcw, Copy, ScanLine, ExternalLink, AlertTriangle, Info, Mail, MessageCircle, Phone, Plus, Hash, Send, Delete, ChevronDown } from "lucide-react";
import { parseUpiQr, parseUpiQrWithReason, canOpenUpiApp, buildUpiDeepLink, type UpiPayload, type UpiParseResult } from "@/lib/upi";
import { scanTransaction, logFraudFlags, type FraudFlag } from "@/lib/fraud";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadReceiptPdf, shareReceiptPdf, shareReceiptToWhatsApp, buildReceiptSummary, type ReceiptData } from "@/lib/receipt";
import {
  recordReceiptDelivery,
  getLastDelivery,
  channelLabel,
  statusLabel,
  relativeTime,
  type ReceiptDelivery,
} from "@/lib/receiptDelivery";
import { callWithAuth } from "@/lib/serverFnAuth";
import { breadcrumb, captureError } from "@/lib/breadcrumbs";

import {
  createAttempt,
  startProcessing,
  pollAttempt,
  cancelAttempt,
  findResumableAttempt,
  type AttemptSnapshot,
} from "@/lib/paymentAttempts.functions";
import { sampleFrames } from "@/lib/fpsGuard";
import { haptics } from "@/lib/haptics";
import { encryptJson, decryptJson } from "@/lib/persistCrypto";
import {
  notifyPaymentSent,
  notifyPaymentFailed,
  notifyPaymentPending,
  maybeNotifyLowBalance,
} from "@/lib/notify";

const reducedMotion = () => {
  if (typeof window === "undefined") return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

const SCANPAY_PERSIST_KEY = "tw-scanpay-flow-v1";
const SCANPAY_ATTEMPT_KEY = "tw-scanpay-attempt-id-v1";
const SCANPAY_LAST_QR_KEY = "tw-scanpay-last-qr-v1";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 60_000;

interface PersistedFlow {
  phase: Phase;
  payload: UpiPayload | null;
  amount: number;
  note?: string;
  /** ms since epoch — used to discard stale flows after app close/reopen. */
  ts?: number;
}

/**
 * Persisted scan flow is resumed for up to 24h so users who close the app
 * mid-scan land back on the same step (scanning / confirm) on reopen,
 * including the last decoded QR payload.
 */
const SCANPAY_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Last-decoded QR cache TTL — cleared automatically after this idle period. */
const SCANPAY_LAST_QR_TTL_MS = 15 * 60 * 1000;

type Phase = "scanning" | "confirm" | "processing" | "success" | "failed";
type FailKind = "generic" | "balance_changed" | "insufficient" | "blocked";

interface SavedTxn {
  id: string;
  amount: number;
  payee: string;
  upiId: string;
  note: string | null;
  createdAt: string;
  /** `upi://pay?...` deep link returned from the backend. Empty string if backend path was unavailable. */
  upiDeepLink: string;
}

export function ScanPay({ onBack }: { onBack: () => void }) {
  const { userId, balance } = useApp();

  // Hydrate persisted flow (scan phase + parsed payload + amount) so a
  // refresh / accidental nav doesn't drop the user back into a broken loop.
  // We try a synchronous read first (legacy plaintext from older builds /
  // sessionStorage); if the persisted value is encrypted we hydrate async.
  const initialPersisted = readPersistedSync();
  const [phase, setPhase] = useState<Phase>(initialPersisted?.phase ?? "scanning");
  const [payload, setPayload] = useState<UpiPayload | null>(initialPersisted?.payload ?? null);
  const [amount, setAmount] = useState<number>(initialPersisted?.amount ?? 0);
  const [resultMsg, setResultMsg] = useState("");
  const [failKind, setFailKind] = useState<FailKind>("generic");
  // Inline error shown directly within the Confirm screen (does not eject the
  // user to the full FailedView). Used for transient/recoverable failures so
  // the slide area can shake + show retry without losing entered context.
  const [payError, setPayError] = useState<string | null>(null);
  // The actual transaction returned from the API after a successful insert.
  // Drives the success screen's reference ID + receipt PDF.
  const [savedTxn, setSavedTxn] = useState<SavedTxn | null>(null);
  const [note, setNote] = useState<string>(initialPersisted?.note ?? "");
  // Bump this to force-remount the ScannerView and dispose its camera + Html5Qrcode instance.
  const [scannerKey, setScannerKey] = useState(0);
  const [hydrated, setHydrated] = useState(!!initialPersisted);

  // Persisted server-side payment attempt id. When present, we are mid-flow
  // and polling the backend for status updates rather than running a timer.
  const [attemptId, setAttemptId] = useState<string | null>(() => readAttemptId());

  // Async hydration for encrypted persisted blobs.
  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void readPersisted().then((p) => {
      if (cancelled) return;
      if (p) {
        setPhase(p.phase);
        setPayload(p.payload);
        setAmount(p.amount ?? 0);
        setNote(p.note ?? "");
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  // Keep persistence in sync; clear on terminal states. Including `note` so a
  // user-typed memo survives accidental nav-away mid-flow.
  useEffect(() => {
    if (!hydrated) return;
    if (phase === "scanning" || phase === "confirm") {
      void writePersisted({ phase, payload, amount, note });
    } else {
      clearPersisted();
    }
  }, [hydrated, phase, payload, amount, note]);

  // Mirror attemptId into localStorage so a refresh during processing
  // resumes against the same backend record.
  useEffect(() => {
    if (attemptId) writeAttemptId(attemptId);
    else clearAttemptId();
  }, [attemptId]);

  const navLockRef = useRef(false);
  const handleDecoded = useCallback((parsed: UpiPayload) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    if (navigator.vibrate) navigator.vibrate(40);
    setPayload(parsed);
    setAmount(parsed.amount ?? 0);
    setNote(parsed.note ?? "");
    breadcrumb("payment.qr_decoded", { upiId: parsed.upiId, payee: parsed.payeeName, amount: parsed.amount ?? undefined });
    setPhase("confirm");
  }, []);

  // ── Resume on mount ──
  // If we have a persisted attempt id (or the backend reports an in-progress
  // attempt for this user), rehydrate the UI into the correct stage instead
  // of dropping the user back into the scanner. This is the heart of "reopen
  // the app and continue from the same payment screen state".
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!userId) return;
    resumedRef.current = true;
    // Offline mode: skip the backend resume call entirely. The local
    // persisted flow (read on mount above) already restored the scan step
    // and last decoded QR payload, so the user sees zero latency.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void resumeFromBackend({
      userId,
      cachedAttemptId: attemptId,
      onResume: ({ snap }) => {
        setPayload({
          upiId: snap.upiId,
          payeeName: snap.payeeName,
          amount: snap.amount,
          amountRaw: String(snap.amount),
          amountSource: "rupees",
          note: snap.note,
          currency: "INR",
        });
        setAmount(snap.amount);
        setNote(snap.note ?? "");
        setAttemptId(snap.id);
        if (snap.stage === "processing") {
          setPhase("processing");
        } else if (snap.stage === "confirm") {
          setPhase("confirm");
        } else if (snap.stage === "success" && snap.transactionId) {
          // Already done — show success screen with what we know.
          setSavedTxn(snapToSavedTxn(snap));
          setPhase("success");
        } else if (snap.stage === "failed") {
          setResultMsg(snap.failureReason ?? "Payment failed");
          setFailKind("generic");
          setPhase("failed");
        }
      },
    });
  }, [userId, attemptId]);

  // ── Polling loop while processing ──
  // The success transition is driven by the backend (simulated PSP webhook
  // finalizes the attempt after ~3s). The UI just polls and reacts.
  useEffect(() => {
    if (phase !== "processing" || !attemptId) return;
    let cancelled = false;
    let pendingNotified = false;
    const PENDING_NOTIFY_MS = 8000; // notify "still processing" if it takes >8s
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await callWithAuth(pollAttempt, { attemptId });
        if (cancelled) return;
        if (!res.ok) {
          if (Date.now() - startedAt > POLL_MAX_MS) {
            setResultMsg(res.message);
            setFailKind("generic");
            setPhase("failed");
            if (userId) void notifyPaymentFailed(userId, 0, null, res.message);
            return;
          }
          setTimeout(tick, POLL_INTERVAL_MS);
          return;
        }
        const snap = res.attempt;
        if (typeof res.newBalance === "number") {
          useApp.setState({ balance: res.newBalance });
        }
        if (snap.stage === "success" && snap.transactionId) {
          breadcrumb("payment.success", { txnId: snap.transactionId, amount: snap.amount, durationMs: Date.now() - startedAt });
          setSavedTxn(snapToSavedTxn(snap));
          setResultMsg(`₹${snap.amount.toFixed(0)} sent to ${snap.payeeName}`);
          if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
          setAttemptId(null);
          setPhase("success");
          if (userId) {
            void notifyPaymentSent(userId, snap.amount, snap.payeeName, {
              upiId: snap.upiId,
              txnId: snap.transactionId,
            });
            if (typeof res.newBalance === "number") {
              void maybeNotifyLowBalance(userId, res.newBalance);
            }
          }
          return;
        }
        if (snap.stage === "failed") {
          breadcrumb("payment.failed", { amount: snap.amount, reason: snap.failureReason ?? undefined }, "warning");
          setResultMsg(snap.failureReason ?? "Payment failed");
          setFailKind("generic");
          setAttemptId(null);
          setPhase("failed");
          if (userId) void notifyPaymentFailed(userId, snap.amount, snap.payeeName, snap.failureReason ?? null);
          return;
        }
        // Still processing — schedule next tick.
        if (!pendingNotified && Date.now() - startedAt > PENDING_NOTIFY_MS) {
          pendingNotified = true;
          if (userId) void notifyPaymentPending(userId, snap.amount, snap.payeeName);
        }
        if (Date.now() - startedAt > POLL_MAX_MS) {
          setResultMsg("Payment is taking longer than expected. We'll keep trying in the background.");
          setFailKind("generic");
          setPhase("failed");
          if (userId) void notifyPaymentPending(userId, snap.amount, snap.payeeName);
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        captureError(err, { where: "scanpay.poll", attemptId });
        if (Date.now() - startedAt > POLL_MAX_MS) {
          setResultMsg("Lost connection to payment service.");
          setFailKind("generic");
          setPhase("failed");
          if (userId) void notifyPaymentFailed(userId, 0, null, "Lost connection to payment service.");
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      }
  };

  // Cycle to the next available camera (front ↔ back, or through multiple
  // back lenses on phones that expose them). Triggers a soft reset so the
  // new camera is picked up by the scanner-init effect.
  const switchCamera = () => {
    if (cameras.length < 2) {
      toast.message("Only one camera available");
      return;
    }
    setCameraIndex((i) => (i + 1) % cameras.length);
    setStarting(true);
    setRestartTick((t) => t + 1);
  };
    // Slight delay so the premium animation has a beat to settle in.
    const initial = setTimeout(tick, 800);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [phase, attemptId]);

  const handlePay = useCallback(async () => {
    if (!userId || !payload) return;
    const amt = amount;
    const noteToSave = note.trim() || payload.note || null;
    setPayError(null);
    breadcrumb("payment.submit_started", { amount: amt, upiId: payload.upiId, payee: payload.payeeName });

    // ── Pre-flight client-side fraud check ──
    const preflight = await scanTransaction({ userId, amount: amt, upiId: payload.upiId });
    if (preflight.blocked) {
      const blockFlag = preflight.flags.find((f) => f.severity === "block");
      breadcrumb("fraud.blocked_preflight", { amount: amt, upiId: payload.upiId, fraudRule: blockFlag?.rule, reason: blockFlag?.message }, "warning");
      await logFraudFlags(userId, null, preflight.flags, "blocked");
      setResultMsg(blockFlag?.message ?? "Payment blocked");
      setFailKind("blocked");
      setPhase("failed");
      void haptics.error();
      return;
    }
    if (amt > balance) {
      breadcrumb("payment.insufficient_preflight", { amount: amt, balance }, "warning");
      setResultMsg("Insufficient balance");
      setFailKind("insufficient");
      setPhase("failed");
      void haptics.error();
      return;
    }

    // ── Create + start the server-side payment attempt ──
    let id = attemptId;
    try {
      if (!id) {
        const created = await callWithAuth(createAttempt, {
          amount: amt,
          upiId: payload.upiId,
          payeeName: payload.payeeName,
          note: noteToSave,
          method: "upi",
        });
        if (!created.ok) {
          setPayError(created.message || "Couldn't start payment. Please try again.");
          void haptics.error();
          return;
        }
        id = created.attempt.id;
        setAttemptId(id);
      }
      const started = await callWithAuth(startProcessing, { attemptId: id });
      if (!started.ok) {
        setPayError(started.message || "Couldn't start payment. Please try again.");
        void haptics.error();
        return;
      }
    } catch (err) {
      captureError(err, { where: "scanpay.startProcessing", amount: amt });
      setPayError("Couldn't start payment. Please check your connection and try again.");
      void haptics.error();
      return;
    }

    // Hand off to the polling effect by switching phase.
    setPhase("processing");
  }, [userId, payload, amount, balance, note, attemptId]);

  const reset = useCallback(() => {
    // Best-effort: cancel the server attempt if one is in-flight.
    if (attemptId) {
      void callWithAuth(cancelAttempt, { attemptId }).catch(() => {});
    }
    setAttemptId(null);
    setPayload(null);
    setAmount(0);
    setNote("");
    setResultMsg("");
    setFailKind("generic");
    setPayError(null);
    setSavedTxn(null);
    navLockRef.current = false;
    clearPersisted();
    clearAttemptId();
    setScannerKey((k) => k + 1);
    setPhase("scanning");
  }, [attemptId]);

  // Retry the last attempted payment without re-scanning. Used by the failure
  // screen when the failure was transient (network/insufficient balance fixed).
  const retryPay = useCallback(() => {
    if (!payload) { reset(); return; }
    // Old attempt is terminal — start a fresh one on next Confirm.
    setAttemptId(null);
    clearAttemptId();
    setResultMsg("");
    setFailKind("generic");
    setPhase("confirm");
  }, [payload, reset]);

  const handleHardBack = useCallback(() => {
    if (attemptId && (phase === "confirm" || phase === "processing")) {
      void callWithAuth(cancelAttempt, { attemptId }).catch(() => {});
    }
    clearPersisted();
    clearAttemptId();
    onBack();
  }, [onBack, attemptId, phase]);


  if (phase === "processing") return <ProcessingView amount={amount} />;
  if (phase === "success" && savedTxn) {
    return (
      <SuccessView
        txn={savedTxn}
        payerName={null}
        payerPhone={null}
        onDone={handleHardBack}
        onScanAgain={reset}
      />
    );
  }
  if (phase === "failed") {
    return (
      <FailedView
        kind={failKind}
        message={resultMsg}
        amount={amount}
        payee={payload?.payeeName ?? ""}
        onRetry={retryPay}
        onScanAgain={reset}
        onCancel={handleHardBack}
      />
    );
  }
  if (phase === "confirm" && payload) {
    return (
      <ConfirmView
        payload={payload}
        amount={amount}
        onAmountChange={setAmount}
        note={note}
        onNoteChange={setNote}
        onConfirm={handlePay}
        onBack={reset}
        balance={balance}
        userId={userId}
        payError={payError}
        onClearError={() => setPayError(null)}
      />
    );
  }
  return <ScannerView key={scannerKey} onBack={handleHardBack} onDecoded={handleDecoded} />;
}

/* ============================================================
   Persistence helpers
   ============================================================ */
/**
 * Synchronous best-effort read used to seed initial state on mount. Returns
 * null when the persisted blob is encrypted (callers fall back to async).
 * This preserves zero-latency resume for legacy plaintext entries (and tests).
 */
function readPersistedSync(): PersistedFlow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(SCANPAY_PERSIST_KEY) ??
      window.sessionStorage.getItem(SCANPAY_PERSIST_KEY);
    if (!raw) return null;
    if (raw.startsWith("e:")) return null; // encrypted — defer to async path
    const json = raw.startsWith("p:") ? raw.slice(2) : raw;
    const parsed = JSON.parse(json) as PersistedFlow;
    if (parsed.phase !== "scanning" && parsed.phase !== "confirm") return null;
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (ts && Date.now() - ts > SCANPAY_RESUME_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readPersisted(): Promise<PersistedFlow | null> {
  if (typeof window === "undefined") return null;
  try {
    // Prefer localStorage (survives app restart). Fall back to sessionStorage
    // for older builds that wrote there.
    const raw =
      window.localStorage.getItem(SCANPAY_PERSIST_KEY) ??
      window.sessionStorage.getItem(SCANPAY_PERSIST_KEY);
    if (!raw) return null;
    const parsed = await decryptJson<PersistedFlow>(raw);
    if (!parsed) {
      try { window.localStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
      return null;
    }
    // Only resume into safe phases — never resume into processing/success/failed.
    if (parsed.phase !== "scanning" && parsed.phase !== "confirm") return null;
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!ts || Date.now() - ts > SCANPAY_RESUME_MAX_AGE_MS) {
      try { window.localStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
      try { window.sessionStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
      try { window.localStorage.removeItem(SCANPAY_LAST_QR_KEY); } catch { /* ignore */ }
      return null;
    }
    // TTL-clear the last-decoded QR cache independently if it has expired.
    try {
      const lastRaw = window.localStorage.getItem(SCANPAY_LAST_QR_KEY);
      if (lastRaw) {
        const last = await decryptJson<{ ts?: number }>(lastRaw);
        if (!last || !last.ts || Date.now() - last.ts > SCANPAY_LAST_QR_TTL_MS) {
          window.localStorage.removeItem(SCANPAY_LAST_QR_KEY);
        }
      }
    } catch { /* ignore */ }
    return parsed;
  } catch {
    return null;
  }
}
async function writePersisted(p: PersistedFlow) {
  if (typeof window === "undefined") return;
  try {
    const enc = await encryptJson({ ...p, ts: Date.now() });
    window.localStorage.setItem(SCANPAY_PERSIST_KEY, enc);
  } catch { /* quota — ignore */ }
  // Also cache the last decoded QR payload separately (encrypted) for quick reference.
  if (p.payload) {
    try {
      const enc = await encryptJson({ payload: p.payload, ts: Date.now() });
      window.localStorage.setItem(SCANPAY_LAST_QR_KEY, enc);
    } catch { /* ignore */ }
  }
}
function clearPersisted() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
  try { window.sessionStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
  try { window.localStorage.removeItem(SCANPAY_LAST_QR_KEY); } catch { /* ignore */ }
}

// ── Attempt-id cache (localStorage so it survives a full restart) ──
function readAttemptId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(SCANPAY_ATTEMPT_KEY); } catch { return null; }
}
function writeAttemptId(id: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SCANPAY_ATTEMPT_KEY, id); } catch { /* quota — ignore */ }
}
function clearAttemptId() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(SCANPAY_ATTEMPT_KEY); } catch { /* ignore */ }
}

/**
 * Downscale an image File so the QR decoder has a sharper, smaller frame to
 * work with. Many phone photos are 4000+ px wide which makes the QR a tiny
 * fraction of the frame; html5-qrcode's scanFile heuristics struggle with
 * that. We cap the longest edge at `maxEdge` (default 1200) and re-encode
 * as a JPEG blob.
 *
 * Returns null if the browser can't load the image (corrupt file, unsupported
 * format, etc.) — callers should fall back to the original.
 */
async function downscaleImage(file: File, maxEdge = 1200): Promise<File | null> {
  if (typeof window === "undefined") return null;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("img-load"));
      el.src = url;
    });
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= maxEdge) {
      URL.revokeObjectURL(url);
      return file; // already small enough
    }
    const scale = maxEdge / longest;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { URL.revokeObjectURL(url); return null; }
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-small.jpg", { type: "image/jpeg" });
  } catch {
    return null;
  }
}

/** Convert a server attempt snapshot into the local SavedTxn shape used by SuccessView. */
function snapToSavedTxn(snap: AttemptSnapshot): SavedTxn {
  return {
    id: snap.transactionId ?? snap.id,
    amount: snap.amount,
    payee: snap.payeeName,
    upiId: snap.upiId,
    note: snap.note,
    createdAt: snap.completedAt ?? snap.createdAt,
    upiDeepLink: "", // built lazily by SuccessView fallback if user taps "Open in UPI app"
  };
}

/**
 * Resolve which payment attempt (if any) the user should resume into.
 * Tries the cached attempt id first, then falls back to a server lookup of
 * the most recent in-progress attempt for this user.
 */
async function resumeFromBackend(opts: {
  userId: string;
  cachedAttemptId: string | null;
  onResume: (args: { snap: AttemptSnapshot }) => void;
}) {
  const { cachedAttemptId, onResume } = opts;
  try {
    if (cachedAttemptId) {
      const res = await callWithAuth(pollAttempt, { attemptId: cachedAttemptId });
      if (res.ok) {
        onResume({ snap: res.attempt });
        return;
      }
    }
    const found = await callWithAuth(findResumableAttempt, {});
    if (found.ok && found.attempt) {
      onResume({ snap: found.attempt });
    }
  } catch (err) {
    captureError(err, { where: "scanpay.resumeFromBackend" });
  }
}

/**
 * Post-payment balance reconciliation.
 *
 * After a successful payment we already optimistically updated the local
 * balance from the server function's `newBalance`. This re-fetches the
 * canonical `profiles.balance` row and:
 *   • silently corrects local state if the values match (no-op),
 *   • updates local state + emits a soft toast if a drift is detected
 *     (e.g., a parental top-up landed in the same window),
 *   • is fully best-effort — any error is swallowed because the user
 *     already saw a success screen and we don't want to scare them.
 */
async function reconcileBalance(userId: string, expected: number): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("balance")
      .eq("id", userId)
      .single();
    if (error || !data) return;
    const live = Number(data.balance);
    if (Number.isNaN(live)) return;
    const drift = Math.abs(live - expected);
    if (drift < 0.01) {
      // In sync — make sure local matches canonical anyway.
      useApp.setState({ balance: live });
      return;
    }
    // Drift detected — sync local store to the truth and let the user know.
    useApp.setState({ balance: live });
    breadcrumb("payment.balance_reconciled", { expected, live, drift }, "info");
    toast.message("Balance updated", {
      description: `Wallet now shows ₹${live.toFixed(2)}.`,
    });
  } catch (err) {
    captureError(err, { where: "scanpay.reconcileBalance" });
  }
}

/* ============================================================
   1. SCANNER
   ============================================================ */

interface DebugSnapshot {
  raw: string;
  result: UpiParseResult;
  at: number;
}

function pickAdaptiveTuning() {
  // Heuristic: low-end devices get a tighter pipeline so each decode pass stays
  // fast; mid/high-end devices push FPS hard for near-instant lock-on.
  const cores = (typeof navigator !== "undefined" && Number(navigator.hardwareConcurrency)) || 4;
  const memRaw = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  const mem = typeof memRaw === "number" ? memRaw : 4;
  const isLowEnd = cores <= 4 || mem <= 2;

  // qrbox must be a fixed object for html5-qrcode to honour it reliably.
  // A larger scan window means partial / off-center / further-away QR codes
  // still land inside the decode region — big sensitivity win.
  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const vh = typeof window !== "undefined" ? window.innerHeight : 640;
  const base = Math.min(vw, vh);
  const edge = Math.min(440, Math.floor(base * (isLowEnd ? 0.78 : 0.90)));

  return {
    // Higher FPS = more decode attempts per second. html5-qrcode caps internally
    // but asking for 30/60 makes it run as fast as the device allows.
    fps: isLowEnd ? 20 : 60,
    qrbox: { width: edge, height: edge },
    profile: isLowEnd ? "low-end" : "high-end",
    cores,
    mem,
  };
}

function ScannerView({ onBack, onDecoded }: { onBack: () => void; onDecoded: (p: UpiPayload) => void }) {
  const containerId = "tw-qr-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [torch, setTorch] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [starting, setStarting] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debug, setDebug] = useState<DebugSnapshot | null>(null);
  const [softResetCount, setSoftResetCount] = useState(0);
  // Counts INVALID decodes (got bytes, but they weren't a UPI QR) and
  // CAMERA START failures. When either runs hot we surface a recovery
  // panel offering an inline retry + a one-tap fallback to gallery upload.
  const [invalidDecodeCount, setInvalidDecodeCount] = useState(0);
  const [cameraStartError, setCameraStartError] = useState<string | null>(null);
  // Inline #FF4444 banner shown after a failed gallery upload. Persists until
  // the user retries (re-opens the picker) or successfully decodes a QR.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  // Real-time camera state for the on-screen feedback strip:
  //   "starting" → still warming up the camera
  //   "tracking" → camera is feeding frames + decoder is alive (no QR yet)
  //   "locked"   → a valid UPI QR was decoded; transitioning to confirm
  const [scanState, setScanState] = useState<"starting" | "tracking" | "locked">("starting");

  // Play a short confirmation beep + haptic the moment we lock onto a QR.
  // Uses WebAudio (no asset bundle hit) and falls back silently if blocked.
  useEffect(() => {
    if (scanState !== "locked") return;
    try {
      type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(880, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.24);
        setTimeout(() => { ctx.close().catch(() => {}); }, 400);
      }
    } catch { /* audio blocked — ignore */ }
    try { navigator.vibrate?.([20, 30, 20]); } catch { /* ignore */ }
  }, [scanState]);
  const decodedRef = useRef(false);
  const lastInvalidToastRef = useRef(0);
  const lastDecodeAttemptRef = useRef<number>(Date.now());
  const watchdogRef = useRef<number | null>(null);
  const tuningRef = useRef(pickAdaptiveTuning());

  // Available cameras + currently selected index. Drives the "Change camera"
  // control on devices with both front+back (or multiple back) lenses.
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);

  // Bumping this value forces the scanner-init effect to re-run, which is our
  // "soft reset": dispose the current Html5Qrcode + camera, then start fresh.
  const [restartTick, setRestartTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;
        const cams = await Html5Qrcode.getCameras();
        if (!cams.length) throw new Error("No camera available");
        setCameras(cams);
        // First boot: pick the rear camera. Subsequent restarts respect the
        // user's "Change camera" selection via cameraIndex.
        const preferIdx = cams.findIndex((c) => /back|rear|environment/i.test(c.label));
        const idx = restartTick === 0 && preferIdx >= 0 ? preferIdx : Math.min(cameraIndex, cams.length - 1);
        if (restartTick === 0 && preferIdx >= 0) setCameraIndex(preferIdx);
        const camId = cams[idx]?.id ?? cams[0].id;
        if (cancelled) return;

        const tuning = tuningRef.current;
        await scanner.start(
          camId,
          {
            fps: tuning.fps,
            qrbox: tuning.qrbox,
            aspectRatio: 1,
            // Request a high-resolution stream so small/far QR modules still
            // resolve sharply enough for the decoder. Browsers clamp these to
            // the closest supported track size.
            videoConstraints: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 60, min: 30 },
              advanced: [
                { focusMode: "continuous" } as unknown as MediaTrackConstraintSet,
                { exposureMode: "continuous" } as unknown as MediaTrackConstraintSet,
                { whiteBalanceMode: "continuous" } as unknown as MediaTrackConstraintSet,
              ],
            } as MediaTrackConstraints,
            // Native BarcodeDetector (Chrome/Android/Capacitor) is dramatically
            // faster than the WASM fallback — keep it on.
            useBarCodeDetectorIfSupported: true,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          } as Parameters<Html5Qrcode["start"]>[1],
          (decoded) => {
            // Hard lock: act exactly once per scanner lifecycle.
            if (decodedRef.current) return;
            const result = parseUpiQrWithReason(decoded);
            setDebug({ raw: decoded, result, at: Date.now() });
            if (!result.payload) {
              const now = Date.now();
              if (now - lastInvalidToastRef.current > 2000) {
                lastInvalidToastRef.current = now;
                toast.error(result.reason ?? "Invalid QR code");
              }
              setInvalidDecodeCount((c) => c + 1);
              return;
            }
            // ✅ Valid UPI QR detected → INSTANT redirect to confirm page.
            // Stop scanner first (fire-and-forget) and hand off synchronously
            // — onDecoded sets phase="confirm" immediately, no extra taps.
            decodedRef.current = true;
            setScanState("locked");
            if (watchdogRef.current) { window.clearInterval(watchdogRef.current); watchdogRef.current = null; }
            scanner.stop().catch(() => {});
            onDecoded(result.payload);
          },
          () => {
            // html5-qrcode fires the failure callback on every frame that didn't decode.
            // We piggy-back on it as a heartbeat → if it stops firing, the camera/decoder is stuck.
            lastDecodeAttemptRef.current = Date.now();
            // Flip to "tracking" the moment the decoder is alive — gives the user
            // immediate feedback that the camera is actively looking for a QR.
            setScanState((s) => (s === "starting" ? "tracking" : s));
          },
        );
        if (!cancelled) {
          setStarting(false);
          setScanState((s) => (s === "starting" ? "tracking" : s));
          lastDecodeAttemptRef.current = Date.now();

          // ── Stuck-scanner watchdog ──
          // If the per-frame decode callback stops firing for >6s, the camera
          // pipeline is wedged (common after backgrounding the tab on iOS or
          // when a long autofocus stalls). Soft-reset by remounting init.
          watchdogRef.current = window.setInterval(() => {
            if (decodedRef.current) return;
            const idleMs = Date.now() - lastDecodeAttemptRef.current;
            if (idleMs > 6000) {
              if (watchdogRef.current) { window.clearInterval(watchdogRef.current); watchdogRef.current = null; }
              setSoftResetCount((c) => c + 1);
              toast.message("Re-tuning camera…", { duration: 1200 });
              setRestartTick((t) => t + 1);
            }
          }, 1500);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Camera unavailable";
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setPermissionDenied(true);
        } else {
          // Surface the error inline so the user can retry or fall back to gallery,
          // instead of relying on a transient toast they may have missed.
          setCameraStartError(msg);
          toast.error(msg);
        }
        setStarting(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (watchdogRef.current) { window.clearInterval(watchdogRef.current); watchdogRef.current = null; }
      const s = scannerRef.current;
      if (s) {
        const cleanup = async () => {
          try {
            if (s.isScanning) await s.stop();
            await s.clear();
          } catch { /* swallow — element may already be gone */ }
        };
        void cleanup();
      }
      scannerRef.current = null;
    };
    // restartTick triggers the soft-reset: re-running this effect tears down
    // the existing camera and starts a fresh Html5Qrcode instance.
  }, [onDecoded, restartTick]);

  const manualSoftReset = () => {
    setSoftResetCount((c) => c + 1);
    setInvalidDecodeCount(0);
    setCameraStartError(null);
    setStarting(true);
    setRestartTick((t) => t + 1);
  };

  // Trigger gallery picker programmatically — used by the recovery panel so
  // a struggling user can fall back from camera scanning to file upload in
  // Wraps `openGalleryPicker` to clear any prior #FF4444 banner first so the
  // user gets a clean retry state when they tap "Retry".
  const openGalleryPickerFresh = () => {
    setUploadError(null);
    fallbackInputRef.current?.click();
  };
  const openGalleryPicker = openGalleryPickerFresh;

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.applyVideoConstraints({
        advanced: [{ torch: !torch } as MediaTrackConstraintSet],
      });
      setTorch((t) => !t);
    } catch {
      toast.error("Torch not supported on this device");
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // ── 1. Validate the file before touching the decoder ──
      // The decoder is expensive; reject obvious non-images, oversized files,
      // and empty files up-front so we surface a precise reason to the user.
      if (!file.type.startsWith("image/")) {
        setUploadError("That file isn't an image. Pick a JPG, PNG, or WebP photo of a QR.");
        setInvalidDecodeCount((c) => c + 1);
        return;
      }
      if (file.size === 0) {
        setUploadError("This image looks empty. Try another photo.");
        setInvalidDecodeCount((c) => c + 1);
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        setUploadError("Image is too large (max 12 MB). Use a smaller photo.");
        setInvalidDecodeCount((c) => c + 1);
        return;
      }

      const scanner = scannerRef.current ?? new Html5Qrcode(containerId, { verbose: false });
      if (scanner.isScanning) await scanner.stop().catch(() => {});

      // ── 2. Try multiple decode passes ──
      // Real-world photos often contain more than one QR, partial occlusion,
      // or framing that confuses the decoder on the first attempt. We try the
      // raw file first, then a downscaled copy as a fallback. Each pass that
      // returns text is parsed against the UPI grammar; the first valid UPI
      // payload wins. We collect all decoded strings so we can show a clearer
      // reason when none of them are UPI.
      const decoded: string[] = [];
      const tryDecode = async (input: File | Blob) => {
        try {
          const text = await scanner.scanFile(input as File, false);
          if (text && !decoded.includes(text)) decoded.push(text);
        } catch {
          /* swallow — fall through to the next strategy */
        }
      };

      await tryDecode(file);
      if (!decoded.some((t) => parseUpiQr(t))) {
        // Downscale and retry — helps with very large photos where the QR is
        // small relative to the frame.
        const downscaled = await downscaleImage(file, 1200).catch(() => null);
        if (downscaled) await tryDecode(downscaled);
      }

      // Pick the first decoded string that parses as UPI; otherwise surface
      // the most specific parse reason from the candidates we collected.
      let chosen: UpiParseResult | null = null;
      for (const text of decoded) {
        const r = parseUpiQrWithReason(text);
        if (r.payload) { chosen = r; break; }
        if (!chosen) chosen = r; // remember first non-UPI decode for messaging
      }
      setDebug({ raw: decoded[0] ?? "", result: chosen ?? { payload: null, reason: "No QR detected", matched: null }, at: Date.now() });

      if (chosen?.payload) {
        setUploadError(null);
        onDecoded(chosen.payload);
        return;
      }

      // No usable UPI QR — pick the friendliest reason we have.
      const reason =
        decoded.length === 0
          ? "We couldn't find a QR in this image. Try a sharper, better-lit photo."
          : decoded.length > 1
            ? "Multiple QR codes detected — none of them are UPI payment codes."
            : chosen?.reason ?? "This QR isn't a UPI payment code.";
      setUploadError(reason);
      setInvalidDecodeCount((c) => c + 1);
    } catch (err) {
      captureError(err, { where: "scanpay.handleUpload" });
      setUploadError("Could not read QR from image. Try a clearer photo.");
      setInvalidDecodeCount((c) => c + 1);
    } finally {
      // Always clear the input so picking the same file again still triggers onChange.
      if (e.target) e.target.value = "";
    }
  };

  if (permissionDenied) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0B0B] px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5">
          <ZapOff className="w-7 h-7 text-white/70" />
        </div>
        <p className="text-[17px] font-semibold text-white">Camera permission needed</p>
        <p className="mt-2 text-[13px] text-white/60 max-w-xs">
          Allow camera access in your browser settings, then tap retry to scan a UPI QR.
        </p>
        <button onClick={() => location.reload()} className="mt-6 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-semibold text-[13px]">
          Retry
        </button>
        <button onClick={onBack} className="mt-3 text-[12px] text-white/55">Go back</button>
      </div>
    );
  }

  const stateLabel =
    scanState === "locked" ? "QR locked · opening payment…" :
    scanState === "tracking" ? "Camera tracking · point at any UPI QR" :
    "Starting camera…";

  return (
    <div className="flex-1 flex flex-col bg-[#0B0B0B] relative overflow-hidden">
      {/* Full-screen camera feed — clean, edge-to-edge, no decorative borders. */}
      <div id={containerId} className="absolute inset-0 [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />

      {/* Torch active glow — subtle warm pulse for "flash on" feedback. */}
      {torch && <div className="sp2-torch-glow" aria-hidden="true" />}

      {/* Minimal top bar — back, title, debug, torch. No brand pill, no borders. */}
      <div className="sp2-topbar sp2-topbar-clean">
        <button onClick={onBack} aria-label="Back" className="sp2-icon-btn focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="sp2-clean-title">Scan & Pay</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDebugOpen((v) => !v)}
            aria-label={debugOpen ? "Hide debug overlay" : "Show debug overlay"}
            aria-pressed={debugOpen}
            className={`sp2-icon-btn ${debugOpen ? "on" : ""}`}
          >
            <Bug className="w-5 h-5" />
          </button>
          <button
            onClick={toggleTorch}
            aria-label={torch ? "Turn flash off" : "Turn flash on"}
            aria-pressed={torch}
            className={`sp2-icon-btn ${torch ? "on sp2-icon-btn-torch" : ""}`}
          >
            {torch ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Centered hint + QR-detected confirmation. No frame, no corners, no beam. */}
      <div className="sp2-clean-stage">
        {scanState === "locked" ? (
          <div className="sp2-detected-overlay" role="status" aria-live="polite">
            <div className="sp2-detected-pulse" aria-hidden="true" />
            <div className="sp2-detected-card">
              <div className="sp2-detected-check">
                <Check className="w-6 h-6" strokeWidth={3} />
              </div>
              <p className="sp2-detected-title">QR detected</p>
              <p className="sp2-detected-sub">Opening payment…</p>
            </div>
          </div>
        ) : (
          <p className="sp2-clean-hint">
            {starting ? "Starting camera…" : "Point at any UPI QR"}
          </p>
        )}
        {!starting && scanState !== "locked" && (
          <button onClick={manualSoftReset} className="sp2-retune">
            Camera stuck? Re-tune
          </button>
        )}
      </div>
      {debugOpen && (
        <div className="absolute bottom-[140px] left-4 right-4 z-30 rounded-2xl bg-black/85 border border-white/10 backdrop-blur-md p-3 text-[11px] font-mono text-white/85 max-h-[36%] overflow-auto">
          <p className="text-primary mb-1">⚙ {tuningRef.current.profile} · fps {tuningRef.current.fps} · qrbox {tuningRef.current.qrbox.width}px · cores {tuningRef.current.cores} · mem {tuningRef.current.mem}GB · soft-resets {softResetCount}</p>
          {debug ? (
            <>
              <p className="text-white/55">raw:</p>
              <p className="break-all text-white/95">{debug.raw}</p>
              <p className="text-white/55 mt-2">matched: <span className="text-white/95">{debug.result.matched ?? "—"}</span></p>
              <p className="text-white/55">parsed: <span className={debug.result.payload ? "text-[#6ee7a3]" : "text-[#ff8585]"}>{debug.result.payload ? "valid" : "invalid"}</span></p>
              {debug.result.reason && <p className="text-[#ff8585]">reason: {debug.result.reason}</p>}
              {debug.result.payload && (
                <pre className="text-white/85 whitespace-pre-wrap mt-1">{JSON.stringify(debug.result.payload, null, 2)}</pre>
              )}
            </>
          ) : (
            <p className="text-white/55">Waiting for first decode…</p>
          )}
        </div>
      )}

      {/* ── QR scan recovery panel ──
          Shown when the user has hit 3+ invalid QR decodes, has done 2+ soft
          resets without locking, OR the camera failed to start. Offers a one-
          tap retry of the camera AND a one-tap fallback to gallery upload so
          a frustrated user is never stuck on the scanner. */}
      {(invalidDecodeCount >= 3 || softResetCount >= 2 || cameraStartError) && scanState !== "locked" && (
        <div className="sp2-recover" role="alertdialog" aria-live="polite" aria-label="Trouble scanning">
          <div className="sp2-recover-icon" aria-hidden="true">
            <AlertTriangle className="w-4 h-4" strokeWidth={2.4} />
          </div>
          <div className="sp2-recover-text">
            <p className="sp2-recover-title">
              {cameraStartError ? "Camera couldn't start" : "Trouble scanning?"}
            </p>
            <p className="sp2-recover-sub">
              {cameraStartError
                ? cameraStartError
                : invalidDecodeCount >= 3
                  ? "We're seeing QRs that aren't UPI payments. Try a clearer angle or upload a photo."
                  : "The camera is having trouble. Re-tune or pick a QR photo from your gallery."}
            </p>
          </div>
          <div className="sp2-recover-actions">
            <button
              type="button"
              onClick={manualSoftReset}
              className="sp2-recover-btn ghost"
              aria-label="Retry camera"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              type="button"
              onClick={openGalleryPicker}
              className="sp2-recover-btn primary"
              aria-label="Use gallery instead"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              Use gallery
            </button>
          </div>
        </div>
      )}

      {/* Inline upload-error banner — uses the spec'd #FF4444 accent so a
          failed gallery decode is impossible to miss. Stays put until the
          user taps Retry (which clears it and re-opens the picker). */}
      {uploadError && (
        <div
          className="sp2-upload-error"
          role="alert"
          aria-live="assertive"
          style={{
            position: "absolute",
            left: 16, right: 16, bottom: 168, zIndex: 35,
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 14px", borderRadius: 18,
            background: "rgba(20,8,8,0.92)",
            border: "1px solid #FF4444",
            boxShadow: "0 18px 40px -16px rgba(255,68,68,0.55)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            color: "#fff",
          }}
        >
          <span
            aria-hidden
            style={{
              flex: "0 0 auto", width: 32, height: 32, borderRadius: 999,
              display: "grid", placeItems: "center",
              background: "rgba(255,68,68,0.18)", color: "#FF4444",
            }}
          >
            <AlertTriangle className="w-4 h-4" strokeWidth={2.4} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
              Couldn't read that QR
            </p>
            <p style={{ fontSize: 12, marginTop: 2, color: "rgba(255,255,255,0.72)", lineHeight: 1.35 }}>
              {uploadError}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              onClick={openGalleryPickerFresh}
              style={{
                fontSize: 12, fontWeight: 600,
                padding: "7px 12px", borderRadius: 999,
                background: "#FF4444", color: "#fff",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
            <button
              type="button"
              onClick={() => setUploadError(null)}
              style={{
                fontSize: 11, fontWeight: 500,
                padding: "5px 10px", borderRadius: 999,
                background: "transparent", color: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input used by the recovery panel's "Use gallery" CTA. */}
      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Premium floating action menu — collapsed FAB by default. Tap to
          expand into Pay to Contact / Pay to UPI ID / My QR. Includes Upload
          QR as a quick chip in the expanded panel. */}
      <ScannerActions
        onUpload={handleUpload}
        onPickedPayload={onDecoded}
      />
    </div>
  );
}

/* ============================================================
   2. CONFIRM + 3. SLIDE TO PAY
   ============================================================ */

function ConfirmView({
  payload, amount, onAmountChange, note, onNoteChange, onConfirm, onBack, balance, userId,
  payError, onClearError,
}: {
  payload: UpiPayload;
  amount: number;
  onAmountChange: (n: number) => void;
  note: string;
  onNoteChange: (s: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  balance: number;
  userId: string | null;
  payError: string | null;
  onClearError: () => void;
}) {
  const initial = (payload.payeeName || payload.upiId).trim().charAt(0).toUpperCase();
  const MAX_TXN_AMOUNT = 10000;
  const insufficient = amount > 0 && amount > balance;
  const overLimit = amount > MAX_TXN_AMOUNT;

  // ── Fraud preview ──
  // Run the SAME client-side rules used at submit, but BEFORE the user slides
  // to pay, so they can see warnings (and any block reason) up front and either
  // tweak the amount or explicitly acknowledge the warning before continuing.
  const [fraud, setFraud] = useState<{ flags: FraudFlag[]; blocked: boolean } | null>(null);
  const [fraudLoading, setFraudLoading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Re-acknowledge whenever amount or merchant changes — silently consenting
  // to a different payment than the one originally reviewed would be a footgun.
  useEffect(() => {
    setAcknowledged(false);
  }, [amount, payload.upiId]);

  // Debounced preflight on amount change. Skip when amount is invalid.
  useEffect(() => {
    if (!userId || amount <= 0 || amount > balance) {
      setFraud(null);
      return;
    }
    let cancelled = false;
    setFraudLoading(true);
    const t = setTimeout(async () => {
      try {
        const report = await scanTransaction({ userId, amount, upiId: payload.upiId });
        if (cancelled) return;
        setFraud({ flags: report.flags, blocked: report.blocked });
      } catch {
        if (!cancelled) setFraud(null);
      } finally {
        if (!cancelled) setFraudLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [userId, amount, balance, payload.upiId]);

  const warnFlags = fraud?.flags.filter((f) => f.severity === "warn") ?? [];
  const blockFlags = fraud?.flags.filter((f) => f.severity === "block") ?? [];
  const isBlocked = fraud?.blocked === true;
  const needsAck = warnFlags.length > 0 && !isBlocked;

  // Slide is gated on: valid amount + (no warnings OR user acknowledged) + not blocked.
  const canPay =
    amount > 0 &&
    amount <= balance &&
    amount <= MAX_TXN_AMOUNT &&
    !isBlocked &&
    (!needsAck || acknowledged);



  // Two-stage flow: Stage A keypad → tap "Next" → Stage B Slide-to-Pay → tap
  // confirmation card to actually pay. The extra confirmation step prevents
  // accidental sends and shows the exact merchant/amount/note one last time.
  const [stage, setStage] = useState<"enter" | "review">("enter");
  const [confirming, setConfirming] = useState(false);
  // Wallet balance popover (anchored to the "Teen Wallet • {balance}" pill)
  const [balanceOpen, setBalanceOpen] = useState(false);

  // Refs for focus management between stages and the confirmation step.
  const nextFabRef = useRef<HTMLButtonElement | null>(null);
  const slideKnobWrapRef = useRef<HTMLDivElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const errorRetryRef = useRef<HTMLButtonElement | null>(null);
  // Slide-area ref for the shake animation when payment fails.
  const slideShellRef = useRef<HTMLDivElement | null>(null);

  // Reset to keypad whenever the amount becomes invalid or merchant changes.
  useEffect(() => {
    if (amount <= 0) {
      setStage("enter");
      setConfirming(false);
    }
  }, [amount, payload.upiId]);

  // Move focus when stage changes — helps keyboard + screen-reader users
  // immediately reach the next interactive control without hunting.
  useEffect(() => {
    if (stage === "review") {
      // Focus the slide knob so keyboard users can press Enter / arrows.
      requestAnimationFrame(() => {
        const knob = slideKnobWrapRef.current?.querySelector<HTMLElement>('[role="slider"]');
        knob?.focus();
      });
    } else {
      requestAnimationFrame(() => nextFabRef.current?.focus({ preventScroll: true }));
    }
  }, [stage]);

  // When the confirmation step opens, focus the confirm button so a quick
  // "Enter"/double-tap completes payment.
  useEffect(() => {
    if (confirming) requestAnimationFrame(() => confirmBtnRef.current?.focus());
  }, [confirming]);

  // Shake the slide region + focus retry button whenever a new payment error
  // arrives. Honour reduced-motion: skip shake but still announce + focus.
  useEffect(() => {
    if (!payError) return;
    setConfirming(false);
    const el = slideShellRef.current;
    if (el && !reducedMotion()) {
      el.classList.remove("sp3-shake");
      // force reflow so animation can re-trigger on consecutive errors
      void el.offsetWidth;
      el.classList.add("sp3-shake");
    }
    requestAnimationFrame(() => errorRetryRef.current?.focus());
  }, [payError]);

  // Format amount for display: hide leading "0", show typed digits.
  const amountStr = amount === 0 ? "" : String(amount);

  const onKey = (k: string) => {
    void haptics.tap();
    if (k === "del") {
      const next = amountStr.slice(0, -1);
      onAmountChange(next === "" ? 0 : Number(next));
      return;
    }
    if (k === ".") {
      if (amountStr.includes(".") || amountStr === "") {
        if (amountStr === "") onAmountChange(Number("0."));
        return;
      }
      onAmountChange(Number(amountStr + "."));
      return;
    }
    // digit
    if (amountStr.includes(".")) {
      const [, dec = ""] = amountStr.split(".");
      if (dec.length >= 2) return; // max 2 decimals
    }
    if (amountStr.replace(".", "").length >= 7) return; // sane cap
    const next = amountStr === "" ? k : amountStr + k;
    const nextNum = Number(next);
    if (nextNum > MAX_TXN_AMOUNT) {
      void haptics.error?.();
      const el = document.querySelector(".sp3-amount-block");
      if (el) {
        el.classList.remove("sp3-shake");
        // force reflow to restart animation
        void (el as HTMLElement).offsetWidth;
        el.classList.add("sp3-shake");
      }
      return;
    }
    onAmountChange(nextNum);
  };

  const goReview = () => {
    if (!canPay) return;
    void haptics.bloom();
    setStage("review");
  };

  // Slide handler: do NOT pay yet — open the confirmation card. The user
  // must tap "Confirm payment" to actually submit.
  const onSlideComplete = () => {
    void haptics.success();
    onClearError();
    setConfirming(true);
  };

  const onConfirmTap = () => {
    void haptics.press();
    setConfirming(false);
    onConfirm();
  };

  const onCancelConfirm = () => {
    void haptics.tap();
    setConfirming(false);
  };

  const onRetry = () => {
    void haptics.select();
    onClearError();
    // stay in review stage so the slide is right there to use again
    setStage("review");
  };

  const onFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canPay) {
      e.preventDefault();
      if (stage === "enter") goReview();
    }
  };

  return (
    <div className="sp3-pay tw-slide-up" onKeyDown={onFormKeyDown}>
      {/* Massive orange aura behind the avatar */}
      <div className="sp3-aura" aria-hidden />
      <div className="sp3-vignette" aria-hidden />

      {/* Header — minimal back button */}
      <div className="sp3-head">
        <button onClick={onBack} aria-label="Back" className="sp3-icon-btn focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="sp3-head-spacer" />
      </div>


      {/* Avatar + identity block */}
      <div className="sp3-id">
        <div className="sp3-avatar" aria-hidden>
          <span className="sp3-avatar-initial">{initial || "?"}</span>
        </div>
        <div className="sp3-name-row">
          <h2 className="sp3-name">{payload.payeeName || "Unknown payee"}</h2>
          <span className="sp3-verified" title="Verified merchant" aria-label="Verified">
            <ShieldCheck className="w-3.5 h-3.5" strokeWidth={3} />
          </span>
        </div>
        <div className="sp3-upi-row">
          <span className="sp3-upi-icon" aria-hidden />
          <span className="sp3-upi">{payload.upiId}</span>
        </div>

        {/* Amount with blinking caret */}
        <div className="sp3-amount-block" role="group" aria-label={`Amount ${amount} rupees`}>
          <span className="sp3-amount-symbol" aria-hidden>₹</span>
          <span className="sp3-amount-value num-mono" aria-live="polite">
            {amountStr || ""}
          </span>
          <span className="sp3-caret" aria-hidden />
        </div>

        {/* Note pill */}
        <div className="sp3-note-pill">
          <input
            id="sp3-note-input"
            type="text"
            maxLength={50}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Add a note"
            aria-label="Add a note for this payment (optional)"
            className="sp3-note-input focus-visible:outline-none"
          />
        </div>

        {overLimit && (
          <p id="sp3-amount-error" role="alert" className="sp3-error">
            Limit exceeded · Max ₹10,000 per transaction
          </p>
        )}
        {!overLimit && insufficient && (
          <p id="sp3-amount-error" role="alert" className="sp3-error">
            Insufficient balance · ₹{balance.toFixed(2)} available
          </p>
        )}
      </div>

      {/* ── Fraud preflight (warns + block) ── */}
      {(isBlocked || warnFlags.length > 0) && (
        <div
          className={`sp3-fraud ${isBlocked ? "sp3-fraud-blocked" : "sp3-fraud-warn"}`}
          role={isBlocked ? "alert" : "status"}
          aria-live="polite"
        >
          <div className="sp3-fraud-head">
            {isBlocked ? <X className="w-4 h-4" strokeWidth={2.6} /> : <AlertTriangle className="w-4 h-4" strokeWidth={2.4} />}
            <span>
              {isBlocked ? "Payment will be blocked" : `${warnFlags.length} warning${warnFlags.length > 1 ? "s" : ""} — review before paying`}
            </span>
          </div>
          <ul className="sp3-fraud-list">
            {(isBlocked ? blockFlags : warnFlags).map((f) => (
              <li key={f.rule}>
                <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
          {!isBlocked && (
            <label className="sp3-fraud-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>I've reviewed and want to continue</span>
            </label>
          )}
        </div>
      )}

      {/* Stage A: keypad + circular Next button */}
      {stage === "enter" && (
        <div className="sp3-keypad-wrap" data-stage="enter">
          <button
            ref={nextFabRef}
            type="button"
            onClick={goReview}
            disabled={!canPay}
            aria-label="Next — review payment"
            className="sp3-next-fab"
          >
            <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
          </button>

          <div className="sp3-keypad" role="group" aria-label="Numeric keypad">
            {["1","2","3","4","5","6","7","8","9",".","0","del"].map((k) => (
              <button
                key={k}
                type="button"
                className="sp3-key"
                onClick={() => onKey(k)}
                aria-label={k === "del" ? "Delete" : k === "." ? "Decimal point" : `Digit ${k}`}
              >
                {k === "del" ? <Delete className="w-5 h-5" strokeWidth={2} /> : <span>{k}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stage B: Slide-to-Pay → confirmation card. Inline error replaces the
          slide on failure so the user can retry without losing context. */}
      {stage === "review" && (
        <div ref={slideShellRef} className="sp3-pay-wrap safe-bottom" data-stage="review">
          <div className="sp3-method-row">
            <div className="sp3-wallet-reveal">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void haptics.tap();
                  setBalanceOpen((v) => !v);
                }}
                className={`sp3-method-pill focus-visible:ring-2 focus-visible:ring-primary ${balanceOpen ? "is-open" : ""}`}
                aria-label={`Wallet balance ₹${balance.toFixed(2)} — tap to ${balanceOpen ? "hide" : "view"} details`}
                aria-expanded={balanceOpen}
                aria-controls="sp3-wallet-balance-panel"
              >
                <span className="sp3-method-logo" aria-hidden><Wallet className="w-3.5 h-3.5" /></span>
                <span className="sp3-method-pill-stack" aria-live="polite">
                  <span className={`sp3-method-pill-line sp3-method-pill-line--label ${balanceOpen ? "is-up" : ""}`}>
                    Teen Wallet • ₹{balance.toFixed(0)}
                  </span>
                  <span className={`sp3-method-pill-line sp3-method-pill-line--balance num-mono ${balanceOpen ? "is-up" : ""}`}>
                    ₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-70 sp3-method-chevron ${balanceOpen ? "is-open" : ""}`} />
              </button>
              {balanceOpen && (
                <div id="sp3-wallet-balance-panel" className="sp3-balance-inline" role="region" aria-label="Wallet balance details">
                  <div className="sp3-balance-inline-row">
                    <span className="sp3-balance-inline-label">Available balance</span>
                    <span className="sp3-balance-inline-value num-mono">
                      ₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {amount > 0 && (
                    <div className="sp3-balance-inline-row sp3-balance-inline-row--after">
                      <span className="sp3-balance-inline-label">After this payment</span>
                      <span className="sp3-balance-inline-value num-mono">
                        ₹{Math.max(0, balance - amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="sp3-balance-link" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void haptics.tap(); setBalanceOpen(false); setStage("enter"); }}>
              Edit amount <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {payError && (
            <div className="sp3-pay-error" role="alert" aria-live="assertive">
              <div className="sp3-pay-error-head">
                <AlertTriangle className="w-4 h-4" strokeWidth={2.6} />
                <span>Payment failed</span>
              </div>
              <p className="sp3-pay-error-msg">{payError}</p>
              <div className="sp3-pay-error-actions">
                <button
                  ref={errorRetryRef}
                  type="button"
                  className="sp3-pay-error-retry"
                  onClick={onRetry}
                >
                  <RotateCcw className="w-4 h-4" /> Retry payment
                </button>
                <button
                  type="button"
                  className="sp3-pay-error-cancel"
                  onClick={() => { void haptics.tap(); onBack(); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!payError && confirming && (
            <div
              className="sp3-confirm-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sp3-confirm-title"
            >
              <h3 id="sp3-confirm-title" className="sp3-confirm-title">Confirm payment</h3>
              <dl className="sp3-confirm-list">
                <div className="sp3-confirm-row">
                  <dt>To</dt>
                  <dd className="sp3-confirm-strong">{payload.payeeName || "Unknown payee"}</dd>
                </div>
                <div className="sp3-confirm-row">
                  <dt>UPI ID</dt>
                  <dd className="num-mono">{payload.upiId}</dd>
                </div>
                <div className="sp3-confirm-row">
                  <dt>Amount</dt>
                  <dd className="sp3-confirm-amount num-mono">₹{amount.toFixed(2)}</dd>
                </div>
                {(note || payload.note) && (
                  <div className="sp3-confirm-row">
                    <dt>Note</dt>
                    <dd>{note || payload.note}</dd>
                  </div>
                )}
              </dl>
              <div className="sp3-confirm-actions">
                <button
                  type="button"
                  className="sp3-confirm-cancel"
                  onClick={onCancelConfirm}
                >
                  Cancel
                </button>
                <button
                  ref={confirmBtnRef}
                  type="button"
                  className="sp3-confirm-pay"
                  onClick={onConfirmTap}
                >
                  Confirm & Pay ₹{amount.toFixed(2)}
                </button>
              </div>
              <p className="sp3-confirm-hint">Tap to finalise — this cannot be undone.</p>
            </div>
          )}

          {!payError && !confirming && (
            <div ref={slideKnobWrapRef}>
              <SlideToPay disabled={!canPay} onComplete={onSlideComplete} amount={amount} />
            </div>
          )}

          <p className="sp3-secure">
            {fraudLoading ? "Checking payment safety…" : (
              <>
                <ShieldCheck className="w-3 h-3 inline-block mr-1 align-[-2px]" />
                Secured by Teen Wallet · UPI
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ScannerActions — premium floating action menu
   • Collapsed: a single champagne FAB ("+") pinned bottom-right.
   • Expanded: vertically stacked premium pills appear above with
     spring entrance:  Pay to Contact · Pay to UPI ID · My QR · Upload QR.
   • Hides on swipe-down (e.g. user pulls camera into focus); reveals on
     swipe-up. Backdrop tap dismisses without losing camera state.
   ============================================================ */
function ScannerActions({
  onUpload,
  onPickedPayload,
}: {
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPickedPayload: (p: UpiPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [upiOpen, setUpiOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // ── Scroll/viewport observer ──
  // Replaces the older touchstart/touchmove gesture (which silently broke on
  // desktop, on iOS Safari with passive listeners disabled, and inside any
  // nested scroll container). Instead we:
  //   1. Find the nearest scrollable ancestor (the PhoneShell screen or the
  //      window itself) once the FAB mounts.
  //   2. On every scroll, compare the new scrollTop to the previous value:
  //        downward delta  → hide   (user is reading content)
  //        upward delta    → reveal (user wants to act)
  //        near top        → always reveal
  //   3. We coalesce updates with requestAnimationFrame so the scroll handler
  //      stays cheap on low-end Android devices.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Find the scrollable ancestor of the FAB. PhoneShell scrolls internally,
    // but on the web preview the document scrolls. Walk up until we find an
    // element whose computed overflow allows scrolling AND whose scrollHeight
    // exceeds its clientHeight; otherwise fall back to window.
    const findScrollParent = (node: HTMLElement | null): HTMLElement | Window => {
      let el: HTMLElement | null = node?.parentElement ?? null;
      while (el && el !== document.body) {
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        const scrollable = (oy === "auto" || oy === "scroll" || oy === "overlay") &&
          el.scrollHeight > el.clientHeight + 4;
        if (scrollable) return el;
        el = el.parentElement;
      }
      return window;
    };

    const target = findScrollParent(wrapRef.current);
    const getY = () => target instanceof Window
      ? (window.scrollY || document.documentElement.scrollTop || 0)
      : (target as HTMLElement).scrollTop;

    let lastY = getY();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = getY();
        const dy = y - lastY;
        // Always reveal at the very top so the FAB is reachable on first paint.
        if (y < 8) setHidden(false);
        else if (dy > 6) setHidden(true);
        else if (dy < -6) setHidden(false);
        lastY = y;
      });
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    // Resize/orientation can change which ancestor scrolls — re-evaluate.
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const closeAll = () => setOpen(false);

  return (
    <>
      {/* Tap-outside backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Close actions"
          onClick={closeAll}
          className="absolute inset-0 z-30 bg-transparent"
        />
      )}

      <div
        ref={wrapRef}
        className={`sp2-fab-wrap ${hidden ? "sp2-fab-hidden" : ""}`}
        data-open={open ? "true" : "false"}
      >
        {/* Expanded action pills (rendered above the FAB) */}
        <div className="sp2-fab-menu" role="menu" aria-hidden={!open}>
          <FabAction
            icon={<Users className="w-[18px] h-[18px]" />}
            label="Pay to Contact"
            sub="Send to a saved person"
            onClick={() => { closeAll(); setContactOpen(true); }}
            tone="emerald"
          />
          <FabAction
            icon={<Hash className="w-[18px] h-[18px]" />}
            label="Pay to UPI ID"
            sub="Type any UPI handle"
            onClick={() => { closeAll(); setUpiOpen(true); }}
            tone="violet"
          />
          <FabAction
            icon={<QrCode className="w-[18px] h-[18px]" />}
            label="My QR"
            sub="Receive money instantly"
            onClick={() => { closeAll(); setQrOpen(true); }}
            tone="champagne"
          />
          <label className="sp2-fab-action sp2-fab-tone-slate cursor-pointer">
            <span className="sp2-fab-action-icon"><ImageIcon className="w-[18px] h-[18px]" /></span>
            <span className="sp2-fab-action-text">
              <span className="sp2-fab-action-label">Upload QR</span>
              <span className="sp2-fab-action-sub">Pick from gallery</span>
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { closeAll(); onUpload(e); }}
            />
          </label>
        </div>

        {/* Primary FAB */}
        <button
          type="button"
          aria-label={open ? "Close payment options" : "Open payment options"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="sp2-fab"
        >
          <span className="sp2-fab-halo" aria-hidden="true" />
          <span className="sp2-fab-icon-stack" aria-hidden="true">
            <Plus className="sp2-fab-icon-plus" strokeWidth={2.6} />
            <X className="sp2-fab-icon-close" strokeWidth={2.6} />
          </span>
        </button>
      </div>

      {upiOpen && (
        <PayUpiIdSheet
          onClose={() => setUpiOpen(false)}
          onSubmit={(payload) => { setUpiOpen(false); onPickedPayload(payload); }}
        />
      )}
      {contactOpen && (
        <PayContactSheet
          onClose={() => setContactOpen(false)}
          onSubmit={(payload) => { setContactOpen(false); onPickedPayload(payload); }}
        />
      )}
      {qrOpen && (
        <MyQrSheet onClose={() => setQrOpen(false)} />
      )}
    </>
  );
}

function FabAction({
  icon, label, sub, onClick, tone,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  tone: "emerald" | "violet" | "champagne" | "slate";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sp2-fab-action sp2-fab-tone-${tone}`}
      role="menuitem"
    >
      <span className="sp2-fab-action-icon">{icon}</span>
      <span className="sp2-fab-action-text">
        <span className="sp2-fab-action-label">{label}</span>
        <span className="sp2-fab-action-sub">{sub}</span>
      </span>
    </button>
  );
}

/* Premium "Pay to UPI ID" sheet — slides up from the bottom of the phone shell. */
function PayUpiIdSheet({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (p: UpiPayload) => void;
}) {
  const [upiId, setUpiId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-z0-9.\-_]{2,}@[a-z][a-z0-9.\-]{2,}$/i.test(upiId.trim());

  const submit = () => {
    if (!valid) { setError("Enter a valid UPI ID like name@bank"); return; }
    onSubmit({
      upiId: upiId.trim(),
      payeeName: name.trim() || upiId.split("@")[0],
      amount: null,
      amountRaw: null,
      amountSource: "none",
      note: null,
      currency: "INR",
    });
  };

  return (
    <div className="sp2-sheet-shell" role="dialog" aria-modal="true" aria-label="Pay to UPI ID">
      <button type="button" aria-label="Close" onClick={onClose} className="sp2-sheet-backdrop" />
      <div className="sp2-sheet">
        <div className="sp2-sheet-grabber" aria-hidden="true" />
        <div className="sp2-sheet-head">
          <div className="sp2-sheet-icon sp2-fab-tone-violet"><Hash className="w-5 h-5" /></div>
          <div>
            <h2 className="sp2-sheet-title">Pay to UPI ID</h2>
            <p className="sp2-sheet-sub">Send money to any UPI handle</p>
          </div>
        </div>

        <label className="sp2-field">
          <span className="sp2-field-label">UPI ID</span>
          <div className={`sp2-field-input-wrap ${error && !valid ? "sp2-field-error" : ""}`}>
            <input
              autoFocus
              value={upiId}
              onChange={(e) => { setUpiId(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && valid) submit(); }}
              placeholder="name@bank"
              className="sp2-field-input"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {valid && <Check className="w-4 h-4 text-emerald-400" />}
          </div>
        </label>

        <label className="sp2-field">
          <span className="sp2-field-label">Recipient name <span className="opacity-50">(optional)</span></span>
          <div className="sp2-field-input-wrap">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && valid) submit(); }}
              placeholder="e.g. Riya Sharma"
              className="sp2-field-input"
            />
          </div>
        </label>

        {error && <p className="sp2-field-msg">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="sp2-sheet-cta"
        >
          <Send className="w-4 h-4" />
          Continue
        </button>
      </div>
    </div>
  );
}

/* Pay to a saved contact — picks from the contacts table. */
function PayContactSheet({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (p: UpiPayload) => void;
}) {
  const { userId } = useApp();
  const [rows, setRows] = useState<{ id: string; name: string; upi_id: string; emoji: string | null; verified: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("contacts")
        .select("id,name,upi_id,emoji,verified")
        .order("last_paid_at", { ascending: false, nullsFirst: false })
        .order("name", { ascending: true })
        .limit(50);
      if (cancelled) return;
      setRows(data ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase()) ||
    r.upi_id.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="sp2-sheet-shell" role="dialog" aria-modal="true" aria-label="Pay to contact">
      <button type="button" aria-label="Close" onClick={onClose} className="sp2-sheet-backdrop" />
      <div className="sp2-sheet">
        <div className="sp2-sheet-grabber" aria-hidden="true" />
        <div className="sp2-sheet-head">
          <div className="sp2-sheet-icon sp2-fab-tone-emerald"><Users className="w-5 h-5" /></div>
          <div>
            <h2 className="sp2-sheet-title">Pay to Contact</h2>
            <p className="sp2-sheet-sub">Pick someone from your saved people</p>
          </div>
        </div>

        <div className="sp2-field">
          <div className="sp2-field-input-wrap">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or UPI…"
              className="sp2-field-input"
              autoFocus
            />
          </div>
        </div>

        <div className="sp2-contact-list">
          {loading ? (
            <div className="sp2-contact-empty">Loading contacts…</div>
          ) : filtered.length === 0 ? (
            <div className="sp2-contact-empty">
              <Users className="w-5 h-5 opacity-50" />
              <span>{rows.length === 0 ? "No saved contacts yet" : "No matches"}</span>
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSubmit({
                  upiId: c.upi_id,
                  payeeName: c.name,
                  amount: null,
                  amountRaw: null,
                  amountSource: "none",
                  note: null,
                  currency: "INR",
                })}
                className="sp2-contact-row"
              >
                <span className="sp2-contact-avatar">{c.emoji ?? c.name.charAt(0).toUpperCase()}</span>
                <span className="sp2-contact-info">
                  <span className="sp2-contact-name">
                    {c.name}
                    {c.verified && <ShieldCheck className="w-3 h-3 text-emerald-400 inline-block ml-1" />}
                  </span>
                  <span className="sp2-contact-upi">{c.upi_id}</span>
                </span>
                <ArrowRight className="w-4 h-4 opacity-40" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* My QR — generates the user's UPI QR so others can scan to pay them.
 *
 * The wallet handle is sourced from the user's saved profile (verified phone +
 * full name). If either required field is missing we DO NOT silently fall back
 * to a "user@teenwallet" stub — that would generate a UPI deep-link that
 * routes nowhere. Instead we render a clear validation panel and link the
 * user to their profile so they can complete onboarding first.
 */
function MyQrSheet({ onClose }: { onClose: () => void }) {
  const { userId, fullName } = useApp();
  const [profile, setProfile] = useState<{ phone: string | null; full_name: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("phone,full_name")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      setProfile(data ?? { phone: null, full_name: fullName });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, fullName]);

  // ── Validate required fields BEFORE building the QR ──
  // The wallet handle is the canonical identifier other users will scan and
  // pay to. We require:
  //   • a phone (used as the wallet local-part — Teen Wallet maps phone → user)
  //   • a display name so the payer sees who they're paying
  // Anything missing → show a validation panel instead of a broken QR.
  const phoneDigits = (profile?.phone ?? "").replace(/\D/g, "");
  const displayName = (profile?.full_name || fullName || "").trim();
  const missingFields: string[] = [];
  if (!phoneDigits || phoneDigits.length < 10) missingFields.push("verified phone number");
  if (!displayName) missingFields.push("full name");
  const isValid = missingFields.length === 0;

  // Wallet handle = saved phone @ teenwallet. Built only when valid so the
  // deep-link is guaranteed to be payable.
  const upiId = isValid ? `${phoneDigits}@teenwallet` : "";
  const deepLink = isValid
    ? buildUpiDeepLink({
        upiId,
        payeeName: displayName,
        amount: 0, // amount-less collect QR — payer chooses the amount
        txnRef: `myqr-${(userId ?? "anon").slice(0, 8)}`,
        currency: "INR",
      // Drop "am=0.00" so installed UPI apps prompt the payer for an amount.
      }).replace(/&?am=0\.00/, "")
    : "";

  useEffect(() => {
    if (!deepLink) { setQrDataUrl(null); return; }
    let cancelled = false;
    void QRCode.toDataURL(deepLink, {
      width: 280,
      margin: 1,
      color: { dark: "#0a0a0a", light: "#ffffff" },
      errorCorrectionLevel: "H",
    }).then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => { captureError(err, { where: "myqr.generate" }); });
    return () => { cancelled = true; };
  }, [deepLink]);

  const copyId = async () => {
    if (!isValid) return;
    try { await navigator.clipboard.writeText(upiId); toast.success("UPI ID copied"); }
    catch { toast.error("Couldn't copy"); }
  };
  const share = async () => {
    if (!isValid) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Pay me on Teen Wallet", text: `Pay me at ${upiId}`, url: deepLink }); }
      catch { /* user cancelled */ }
    } else {
      void copyId();
    }
  };
  const download = () => {
    if (!qrDataUrl || !isValid) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `teenwallet-${upiId.replace(/[^a-z0-9]/gi, "-")}.png`;
    a.click();
  };

  return (
    <div className="sp2-sheet-shell" role="dialog" aria-modal="true" aria-label="My UPI QR code">
      <button type="button" aria-label="Close" onClick={onClose} className="sp2-sheet-backdrop" />
      <div className="sp2-sheet sp2-sheet-qr">
        <div className="sp2-sheet-grabber" aria-hidden="true" />
        <div className="sp2-sheet-head">
          <div className="sp2-sheet-icon sp2-fab-tone-champagne"><QrCode className="w-5 h-5" /></div>
          <div>
            <h2 className="sp2-sheet-title">My QR code</h2>
            <p className="sp2-sheet-sub">
              {isValid ? "Anyone can scan this to pay you" : "Finish your profile to generate a QR"}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="sp2-qr-card"><div className="sp2-qr-frame"><div className="sp2-qr-skeleton" /></div></div>
        ) : !isValid ? (
          // ── Validation panel — required profile fields missing ──
          <div
            role="alert"
            style={{
              margin: "8px 4px 4px",
              padding: "14px 14px 16px",
              borderRadius: 18,
              background: "rgba(20,8,8,0.85)",
              border: "1px solid #FF4444",
              color: "#fff",
              display: "flex", flexDirection: "column", gap: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                aria-hidden
                style={{
                  flex: "0 0 auto", width: 32, height: 32, borderRadius: 999,
                  display: "grid", placeItems: "center",
                  background: "rgba(255,68,68,0.18)", color: "#FF4444",
                }}
              >
                <AlertTriangle className="w-4 h-4" strokeWidth={2.4} />
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600 }}>Can't generate your QR yet</p>
                <p style={{ fontSize: 12, marginTop: 4, color: "rgba(255,255,255,0.72)", lineHeight: 1.4 }}>
                  We need your {missingFields.join(" and ")} to build a payable wallet handle. Without these, the QR would route nowhere.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { onClose(); window.location.assign("/preview/profile-help"); }}
              style={{
                alignSelf: "flex-start",
                fontSize: 12, fontWeight: 600,
                padding: "8px 14px", borderRadius: 999,
                background: "#FF4444", color: "#fff",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <UserIcon className="w-3.5 h-3.5" /> Complete profile
            </button>
          </div>
        ) : (
          <>
            <div className="sp2-qr-card">
              <div className="sp2-qr-frame">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Your UPI QR" className="sp2-qr-img" />
                ) : (
                  <div className="sp2-qr-skeleton" />
                )}
              </div>
              <div className="sp2-qr-meta">
                <p className="sp2-qr-name">{displayName}</p>
                <p className="sp2-qr-upi">
                  {upiId}
                  <button type="button" onClick={copyId} className="sp2-qr-copy" aria-label="Copy UPI ID">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </p>
              </div>
            </div>

            <div className="sp2-qr-actions">
              <button type="button" onClick={share} className="sp2-qr-btn" disabled={!qrDataUrl}>
                <Share2 className="w-4 h-4" /> Share
              </button>
              <button type="button" onClick={download} className="sp2-qr-btn" disabled={!qrDataUrl}>
                <Download className="w-4 h-4" /> Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function SlideToPay({ disabled, onComplete, amount }: { disabled: boolean; onComplete: () => void; amount?: number }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startX = useRef(0);

  const knobSize = 64;
  const padding = 4;

  const getMaxX = () => {
    const w = trackRef.current?.offsetWidth ?? 320;
    return w - knobSize - padding * 2;
  };

  const finish = useCallback(() => {
    setDragX(getMaxX());
    setCompleted(true);
    if (navigator.vibrate) navigator.vibrate(50);
    setTimeout(onComplete, 220);
  }, [onComplete]);

  // FPS guard: starts when the user begins dragging, stops on release. If the
  // drag interaction janks (>30% dropped frames over the gesture) the guard
  // auto-reduces motion app-wide so the next slide is buttery on this device.
  const fpsStopRef = useRef<null | (() => unknown)>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || completed) return;
    setDragging(true);
    startX.current = e.clientX - dragX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    fpsStopRef.current = sampleFrames("slide", { minSamples: 20, dropThresholdPct: 0.30 });
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const max = getMaxX();
    const next = Math.max(0, Math.min(max, e.clientX - startX.current));
    setDragX(next);
  };
  const handlePointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    fpsStopRef.current?.();
    fpsStopRef.current = null;
    const max = getMaxX();
    if (dragX >= max - 6) {
      finish();
    } else {
      setDragX(0);
    }
  };


  // Keyboard accessibility — arrow keys nudge the knob, Enter/Space confirms.
  // This matches WAI-ARIA slider pattern and lets keyboard-only users pay.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || completed) return;
    const max = getMaxX();
    const step = Math.max(20, Math.round(max / 8));
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setDragX((x) => Math.min(max, x + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setDragX((x) => Math.max(0, x - step));
    } else if (e.key === "End") {
      e.preventDefault();
      setDragX(max);
    } else if (e.key === "Home") {
      e.preventDefault();
      setDragX(0);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      finish();
    }
  };

  const max = getMaxX();
  const progress = Math.min(1, dragX / (max || 1));
  const valueNow = Math.round(progress * 100);

  return (
    <div
      ref={trackRef}
      className={`sp-slide-track ${disabled ? "sp-slide-track-disabled" : ""} ${completed ? "sp-slide-track-completed" : ""}`}
    >
      <div className="sp-slide-glow" aria-hidden />
      <div
        className="sp-slide-fill"
        style={{
          transform: `scaleX(${completed ? 1 : progress})`,
          opacity: dragX > 4 || completed ? 1 : 0,
        }}
        aria-hidden
      />
      <div
        className="sp-slide-label"
        style={{ opacity: completed ? 0 : Math.max(0, 1 - progress * 1.6) }}
        aria-hidden="true"
      >
        {disabled ? "Enter a valid amount" : amount && amount > 0 ? `Slide to Pay ₹${amount}` : "Swipe to send"}
      </div>

      {/* Animated chevron arrows hint (right side) */}
      <div
        className="sp-slide-hints"
        style={{ opacity: completed ? 0 : Math.max(0, 1 - progress * 2) }}
        aria-hidden
      >
        <ArrowRight className="sp-slide-hint sp-slide-hint-1 w-5 h-5" />
        <ArrowRight className="sp-slide-hint sp-slide-hint-2 w-5 h-5" />
        <ArrowRight className="sp-slide-hint sp-slide-hint-3 w-5 h-5" />
      </div>

      <div
        ref={knobRef}
        className="sp-slide-knob focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        style={{
          transform: `translate3d(${dragX}px, 0, 0)`,
          transition: dragging ? "none" : "transform 520ms cubic-bezier(.16,1,.3,1)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Swipe to send. Use arrow keys or press Enter to confirm payment."
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={completed ? 100 : valueNow}
        aria-valuetext={completed ? "Payment confirmed" : disabled ? "Disabled — enter a valid amount" : `${valueNow} percent`}
        aria-disabled={disabled || undefined}
      >
        {completed ? <Check className="w-6 h-6" strokeWidth={3} /> : <ArrowRight className="w-6 h-6" strokeWidth={2.5} />}
      </div>
    </div>
  );
}

/* ============================================================
   4. PROCESSING
   ============================================================ */

function ProcessingView({ amount }: { amount: number }) {
  // Premium "perspective floor + glowing orb + sine ribbons" payment animation.
  // The floor grid is rendered in CSS (perspective transform on a tiled gradient
  // panel). The colored ribbons are SVG sine paths animated via stroke-dashoffset
  // so they appear to draw across the floor in a smooth, hand-drawn motion.
  //
  // FPS guard: sample frame timing during this view. If sustained jank is
  // detected the guard auto-reduces motion app-wide for the rest of the session.
  useEffect(() => {
    const stop = sampleFrames("processing", { minSamples: 60, dropThresholdPct: 0.22 });
    return () => { stop(); };
  }, []);

  return (
    <div className="sp-pay-root" role="status" aria-live="polite" aria-label={`Processing payment of ${amount} rupees`}>
      {/* Soft top vignette to add depth */}
      <div className="sp-pay-vignette" aria-hidden />

      {/* Handoff chip — rises from where the locked QR frame sat and merges
          into the orb. Pairs with .sp2-frame-locked::after bloom for a
          continuous scan→pay choreography. */}
      <span className="sp-handoff-arc" aria-hidden />

      {/* Perspective grid floor */}
      <div className="sp-pay-floor" aria-hidden>
        <div className="sp-pay-floor-grid" />
        <div className="sp-pay-floor-fade" />
      </div>

      {/* Colored sine ribbons drifting across the floor */}
      <svg className="sp-pay-ribbons" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="sp-rib-y" x1="0" x2="1">
            <stop offset="0" stopColor="#facc15" stopOpacity="0" />
            <stop offset=".25" stopColor="#facc15" stopOpacity=".95" />
            <stop offset=".75" stopColor="#fde68a" stopOpacity=".95" />
            <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sp-rib-w" x1="0" x2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset=".5" stopColor="#ffffff" stopOpacity=".95" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sp-rib-b" x1="0" x2="1">
            <stop offset="0" stopColor="#3b82f6" stopOpacity="0" />
            <stop offset=".5" stopColor="#60a5fa" stopOpacity=".95" />
            <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="sp-rib sp-rib-y"
          d="M -40 110 Q 60 70, 140 110 T 320 110 T 460 110"
          stroke="url(#sp-rib-y)"
        />
        <path
          className="sp-rib sp-rib-w"
          d="M -40 130 Q 70 95, 150 130 T 330 130 T 470 130"
          stroke="url(#sp-rib-w)"
        />
        <path
          className="sp-rib sp-rib-b"
          d="M -40 150 Q 80 120, 160 150 T 340 150 T 480 150"
          stroke="url(#sp-rib-b)"
        />
      </svg>

      {/* The hero: glowing white orb with halo + reflection */}
      <div className="sp-pay-stage">
        <div className="sp-pay-halo" aria-hidden />
        <div className="sp-pay-halo sp-pay-halo-2" aria-hidden />
        <div className="sp-pay-orb-wrap">
          <span className="sp-pay-orb-ring" aria-hidden />
          <span className="sp-pay-orb-ring sp-pay-orb-ring-2" aria-hidden />
          <div className="sp-pay-orb" aria-hidden>
            <span className="sp-pay-orb-spec" />
          </div>
          <div className="sp-pay-orb-shadow" aria-hidden />
        </div>

        {/* Floating particles near the orb for extra premium feel */}
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className="sp-pay-mote"
            style={{
              ["--mx" as string]: `${(i * 37) % 200 - 100}px`,
              ["--my" as string]: `${-30 - (i * 17) % 60}px`,
              animationDelay: `${(i * 0.18).toFixed(2)}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Status copy */}
      <div className="sp-pay-copy">
        <p className="sp-pay-eyebrow">
          <span className="sp-pay-dot" />
          Securely processing
        </p>
        <p className="sp-pay-amount num-mono">
          <span className="sp-pay-rupee">₹</span>{amount.toFixed(2)}
        </p>
        <p className="sp-pay-hint">Encrypted end-to-end · Bank grade security</p>
      </div>
    </div>
  );
}

/* ============================================================
   5. SUCCESS
   ============================================================ */

function SuccessView({
  txn, payerName, payerPhone, onDone, onScanAgain,
}: {
  txn: SavedTxn;
  payerName?: string | null;
  payerPhone?: string | null;
  onDone: () => void;
  onScanAgain: () => void;
}) {
  const refId = txn.id.replace(/-/g, "").slice(0, 12).toUpperCase();
  const dateStr = new Date(txn.createdAt).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const receipt = useCallback((): ReceiptData => ({
    txnId: txn.id,
    amount: txn.amount,
    payee: txn.payee,
    upiId: txn.upiId,
    note: txn.note,
    status: "success",
    createdAt: txn.createdAt,
    payerName,
    payerPhone,
  }), [txn, payerName, payerPhone]);

  // Persisted delivery status for THIS receipt — survives reloads.
  const [lastDelivery, setLastDelivery] = useState<ReceiptDelivery | null>(() => getLastDelivery(txn.id));
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptDelivery>).detail;
      if (detail?.txnId === txn.id) setLastDelivery(detail);
    };
    window.addEventListener("tw-receipt-delivery", onChange);
    return () => window.removeEventListener("tw-receipt-delivery", onChange);
  }, [txn.id]);
  const logDelivery = (channel: ReceiptDelivery["channel"], status: ReceiptDelivery["status"] = "attempted") => {
    setLastDelivery(recordReceiptDelivery(txn.id, channel, status));
  };

  const handleDownload = async () => {
    try {
      await downloadReceiptPdf(receipt());
      logDelivery("download", "sent");
      toast.success("Receipt downloaded");
    } catch {
      logDelivery("download", "failed");
      toast.error("Couldn't generate receipt");
    }
  };

  const handleShare = async () => {
    try {
      const shared = await shareReceiptPdf(receipt());
      logDelivery("share", shared ? "sent" : "attempted");
      if (!shared) toast.success("Receipt downloaded");
    } catch {
      logDelivery("share", "failed");
      toast.error("Share failed");
    }
  };

  // Open the device email composer with the receipt summary pre-filled.
  // Most platforms can't attach a generated File via mailto:, so we lead
  // with the readable summary and offer "Download PDF" alongside.
  const handleEmail = () => {
    try {
      const subject = encodeURIComponent(`Payment receipt · ₹${txn.amount.toFixed(2)} → ${txn.payee}`);
      const body = encodeURIComponent(buildReceiptSummary(receipt()));
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      logDelivery("email", "attempted");
    } catch {
      logDelivery("email", "failed");
    }
  };

  // SMS deep link: works on iOS / Android. We keep the body short to avoid
  // forcing the carrier to split into multiple messages.
  const handleSms = () => {
    try {
      const body = encodeURIComponent(buildReceiptSummary(receipt()));
      // iOS uses `&body=` after `&`; Android uses `?body=`. Both accept `?body=`
      // with no recipient, so we use that.
      window.location.href = `sms:?body=${body}`;
      logDelivery("sms", "attempted");
    } catch {
      logDelivery("sms", "failed");
    }
  };

  // WhatsApp share: PDF file via Web Share when supported, else wa.me deep link.
  const handleWhatsApp = async () => {
    try {
      const result = await shareReceiptToWhatsApp(receipt());
      if (result === "failed") {
        logDelivery("whatsapp", "failed");
        toast.error("Couldn't open WhatsApp");
      } else {
        logDelivery("whatsapp", result === "file" ? "sent" : "attempted");
      }
    } catch {
      logDelivery("whatsapp", "failed");
      toast.error("Couldn't open WhatsApp");
    }
  };

  const copyRef = () => {
    try {
      navigator.clipboard?.writeText(refId);
      toast.success("Reference ID copied");
    } catch {
      // ignore
    }
  };

  return (
    <div className="sp-success-root sp-success-vlines" role="region" aria-label="Payment successful">
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start pt-10 px-6 text-center overflow-y-auto">
        <div className="relative w-[140px] h-[140px] flex items-center justify-center">
          <span className="sp-success-ring" />
          <span className="sp-success-ring delay" />
          <div className="sp-success-badge">
            <svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="#1a1208" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 33 L28 45 L48 22" className="sp-success-check" />
            </svg>
          </div>
          {Array.from({ length: 14 }).map((_, i) => {
            const angle = (i / 14) * Math.PI * 2;
            const dist = 80 + (i % 3) * 10;
            return (
              <span
                key={i}
                className="sp-burst-particle"
                style={{
                  ["--bx" as string]: `${Math.cos(angle) * dist}px`,
                  ["--by" as string]: `${Math.sin(angle) * dist}px`,
                  animationDelay: `${0.6 + (i % 5) * 0.05}s`,
                } as React.CSSProperties}
              />
            );
          })}
        </div>

        <h2 className="mt-6 text-[22px] font-bold text-white tracking-tight kyc-fade-up">Payment successful</h2>
        <p className="mt-1 text-[13px] text-white/65 kyc-fade-up" style={{ animationDelay: "120ms" }}>
          to <span className="text-white/90 font-medium">{txn.payee || "recipient"}</span>
        </p>

        {/* Receipt card */}
        <div className="sp-receipt-card kyc-fade-up" style={{ animationDelay: "180ms" }}>
          <div className="sp-receipt-amount">
            <span className="text-white/55 text-[12px] mr-2">Amount paid</span>
            <span className="num-mono text-[28px] font-bold text-white">₹{txn.amount.toFixed(2)}</span>
          </div>
          <div className="sp-receipt-divider" />
          <dl className="sp-receipt-grid">
            <dt>Reference ID</dt>
            <dd>
              <button
                type="button"
                onClick={copyRef}
                className="num-mono inline-flex items-center gap-1.5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1"
                aria-label={`Reference ID ${refId}. Click to copy.`}
              >
                {refId}
                <Copy className="w-3 h-3 opacity-60" />
              </button>
            </dd>
            <dt>UPI ID</dt>
            <dd className="truncate">{txn.upiId}</dd>
            <dt>Date</dt>
            <dd>{dateStr}</dd>
            {txn.note && (<><dt>Note</dt><dd className="truncate">{txn.note}</dd></>)}
            <dt>Status</dt>
            <dd><span className="sp-receipt-status-ok">SUCCESS</span></dd>
          </dl>
        </div>
      </div>

      <div className="relative z-10 px-5 pt-3 pb-6 flex flex-col gap-2 safe-bottom">
        {txn.upiDeepLink && (
          <a
            href={txn.upiDeepLink}
            className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary justify-center"
            aria-label="Open this payment in your UPI app"
            onClick={() => {
              if (!canOpenUpiApp()) {
                toast.message("UPI apps work on phones", {
                  description: "Open this page on your phone to hand off to GPay/PhonePe/Paytm.",
                });
              }
            }}
          >
            <ExternalLink className="w-4 h-4" />
            Open in UPI app
          </a>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleDownload}
            className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Download receipt as PDF"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </button>
          <button
            onClick={handleShare}
            className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Share receipt"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleEmail}
            className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Email this receipt"
          >
            <Mail className="w-4 h-4" />
            Email
          </button>
          <button
            onClick={handleSms}
            className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Send receipt by SMS"
          >
            <MessageCircle className="w-4 h-4" />
            SMS
          </button>
        </div>
        <button
          onClick={handleWhatsApp}
          className="sp-receipt-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full"
          aria-label="Share receipt via WhatsApp"
        >
          <Phone className="w-4 h-4" />
          Share via WhatsApp
        </button>
        {lastDelivery && (
          <p
            className="text-[11px] text-white/60 text-center -mt-1"
            aria-live="polite"
          >
            Last delivery:{" "}
            <span className={lastDelivery.status === "failed" ? "text-rose-300" : "text-emerald-300"}>
              {channelLabel(lastDelivery.channel)} · {statusLabel(lastDelivery.status)}
            </span>{" "}
            · {relativeTime(lastDelivery.attemptedAt)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onScanAgain}
            className="sp-receipt-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Scan again
          </button>
          <button onClick={onDone} className="pv-btn">
            <span className="pv-btn-shine" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FAILED — shows the real result + reference (when present) +
   a retry that re-attempts the same payment without re-scanning.
   ============================================================ */

function FailedView({
  kind, message, amount, payee, onRetry, onScanAgain, onCancel,
}: {
  kind: FailKind;
  message: string;
  amount: number;
  payee: string;
  onRetry: () => void;
  onScanAgain: () => void;
  onCancel: () => void;
}) {
  const isBalance = kind === "balance_changed";
  const isBlocked = kind === "blocked";
  const isInsufficient = kind === "insufficient";
  const heading =
    isBalance ? "Balance changed" :
    isBlocked ? "Payment blocked" :
    isInsufficient ? "Insufficient balance" :
    "Payment failed";

  // For balance/blocked failures, retrying the same charge doesn't help —
  // user needs to re-scan or top up. Hide the inline retry in those cases.
  const canInlineRetry = !isBalance && !isBlocked;

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center px-6 text-center tw-slide-up bg-background"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-20 h-20 rounded-full bg-destructive/15 border border-destructive/40 flex items-center justify-center tw-shake">
        <X className="w-10 h-10 text-destructive" strokeWidth={2} />
      </div>
      <h2 className="mt-6 text-2xl font-bold">{heading}</h2>
      {message && <p className="mt-2 text-sm text-muted-foreground max-w-xs">{message}</p>}

      {/* Real result summary */}
      {(amount > 0 || payee) && (
        <div className="sp-fail-summary">
          <div className="flex items-center justify-between">
            <span className="text-white/55 text-[12px]">Attempted</span>
            <span className="num-mono text-white text-[15px] font-semibold">₹{amount.toFixed(2)}</span>
          </div>
          {payee && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-white/55 text-[12px]">To</span>
              <span className="text-white/90 text-[13px] truncate max-w-[60%]">{payee}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1">
            <span className="text-white/55 text-[12px]">Status</span>
            <span className="sp-fail-status">FAILED</span>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-2 w-full max-w-xs">
        {canInlineRetry && (
          <button
            onClick={onRetry}
            className="btn-primary inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Retry the same payment"
          >
            <RotateCcw className="w-4 h-4" />
            Retry payment
          </button>
        )}
        <button
          onClick={onScanAgain}
          className={`${canInlineRetry ? "btn-ghost" : "btn-primary"} focus-visible:ring-2 focus-visible:ring-primary`}
        >
          Scan a new QR
        </button>
        <button onClick={onCancel} className="text-[12px] text-white/55 hover:text-white py-2">
          Back to home
        </button>
      </div>
    </div>
  );
}
