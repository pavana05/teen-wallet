import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Zap, ZapOff, X, Share2, Check, Bug } from "lucide-react";
import { parseUpiQr, parseUpiQrWithReason, type UpiPayload, type UpiParseResult } from "@/lib/upi";
import { scanTransaction, logFraudFlags } from "@/lib/fraud";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SCANPAY_PERSIST_KEY = "tw-scanpay-flow-v1";

interface PersistedFlow {
  phase: Phase;
  payload: UpiPayload | null;
  amount: number;
}

type Phase = "scanning" | "confirm" | "processing" | "success" | "failed";
type FailKind = "generic" | "balance_changed" | "insufficient" | "blocked";

export function ScanPay({ onBack }: { onBack: () => void }) {
  const { userId, balance } = useApp();

  // Hydrate persisted flow (scan phase + parsed payload + amount) so a
  // refresh / accidental nav doesn't drop the user back into a broken loop.
  const persisted = readPersisted();
  const [phase, setPhase] = useState<Phase>(persisted?.phase ?? "scanning");
  const [payload, setPayload] = useState<UpiPayload | null>(persisted?.payload ?? null);
  const [amount, setAmount] = useState<number>(persisted?.amount ?? 0);
  const [resultMsg, setResultMsg] = useState("");
  const [failKind, setFailKind] = useState<FailKind>("generic");
  // Bump this to force-remount the ScannerView and dispose its camera + Html5Qrcode instance.
  const [scannerKey, setScannerKey] = useState(0);

  // Keep persistence in sync; clear on terminal states.
  useEffect(() => {
    if (phase === "scanning" || phase === "confirm") {
      writePersisted({ phase, payload, amount });
    } else {
      clearPersisted();
    }
  }, [phase, payload, amount]);

  const navLockRef = useRef(false);
  const handleDecoded = useCallback((parsed: UpiPayload) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    if (navigator.vibrate) navigator.vibrate(40);
    setPayload(parsed);
    setAmount(parsed.amount ?? 0);
    setPhase("confirm");
  }, []);

  const handlePay = useCallback(async () => {
    if (!userId || !payload) return;
    setPhase("processing");
    const amt = amount;

    const finalReport = await scanTransaction({ userId, amount: amt, upiId: payload.upiId });
    if (finalReport.blocked) {
      await logFraudFlags(userId, null, finalReport.flags, "blocked");
      setResultMsg(finalReport.flags.find((f) => f.severity === "block")?.message ?? "Payment blocked");
      setFailKind("blocked");
      setPhase("failed");
      return;
    }
    if (amt > balance) {
      setResultMsg("Insufficient balance");
      setFailKind("insufficient");
      setPhase("failed");
      return;
    }

    // Minimum visible processing window for premium feel
    await new Promise((r) => setTimeout(r, 1600));

    // Final balance re-check just before insert — guards against concurrent
    // spend on another device or a refund landing while we were processing.
    const { data: fresh, error: balErr } = await supabase
      .from("profiles")
      .select("balance")
      .eq("id", userId)
      .single();
    if (balErr || !fresh) {
      setResultMsg("Couldn't verify balance. Please try again.");
      setFailKind("generic");
      setPhase("failed");
      return;
    }
    const liveBalance = Number(fresh.balance);
    if (Math.abs(liveBalance - balance) > 0.001) {
      // Sync local store so the UI shows the truth.
      useApp.setState({ balance: liveBalance });
      if (amt > liveBalance) {
        setResultMsg(`Your balance changed to ₹${liveBalance.toFixed(2)} and is no longer enough for this payment.`);
      } else {
        setResultMsg(`Your wallet balance changed to ₹${liveBalance.toFixed(2)}. Please scan the QR again to confirm.`);
      }
      setFailKind("balance_changed");
      setPhase("failed");
      return;
    }

    const { data: txn, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        amount: amt,
        merchant_name: payload.payeeName,
        upi_id: payload.upiId,
        note: payload.note,
        status: "success",
        fraud_flags: finalReport.flags as never,
      })
      .select()
      .single();

    if (error || !txn) {
      setResultMsg(error?.message ?? "Payment failed");
      setFailKind("generic");
      setPhase("failed");
      return;
    }

    await logFraudFlags(userId, txn.id, finalReport.flags, finalReport.flags.length === 0 ? "auto_passed" : "user_confirmed");
    const newBal = liveBalance - amt;
    await supabase.from("profiles").update({ balance: newBal }).eq("id", userId);
    useApp.setState({ balance: newBal });
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "transaction",
      title: `₹${amt.toFixed(2)} paid to ${payload.payeeName}`,
      body: payload.upiId,
    });
    setResultMsg(`₹${amt.toFixed(0)} sent to ${payload.payeeName}`);
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    setPhase("success");
  }, [userId, payload, amount, balance]);

  const reset = useCallback(() => {
    setPayload(null);
    setAmount(0);
    setResultMsg("");
    setFailKind("generic");
    navLockRef.current = false;
    clearPersisted();
    // Force-remount the ScannerView → its cleanup runs (camera stop + clear),
    // then a fresh Html5Qrcode instance is created. Prevents stale-loop bugs
    // and camera resource leaks observed when re-entering scan after confirm.
    setScannerKey((k) => k + 1);
    setPhase("scanning");
  }, []);

  const handleHardBack = useCallback(() => {
    clearPersisted();
    onBack();
  }, [onBack]);


  if (phase === "processing") return <ProcessingView amount={amount} />;
  if (phase === "success") return <SuccessView message={resultMsg} amount={amount} payee={payload?.payeeName ?? ""} onDone={handleHardBack} />;
  if (phase === "failed") return <FailedView kind={failKind} message={resultMsg} onRetry={reset} onCancel={handleHardBack} />;
  if (phase === "confirm" && payload) {
    return (
      <ConfirmView
        payload={payload}
        amount={amount}
        onAmountChange={setAmount}
        onConfirm={handlePay}
        onBack={reset}
        balance={balance}
      />
    );
  }
  return <ScannerView key={scannerKey} onBack={handleHardBack} onDecoded={handleDecoded} />;
}

/* ============================================================
   Persistence helpers
   ============================================================ */
function readPersisted(): PersistedFlow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SCANPAY_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFlow;
    // Only resume into safe phases — never resume into processing/success/failed.
    if (parsed.phase !== "scanning" && parsed.phase !== "confirm") return null;
    return parsed;
  } catch {
    return null;
  }
}
function writePersisted(p: PersistedFlow) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(SCANPAY_PERSIST_KEY, JSON.stringify(p)); } catch { /* quota — ignore */ }
}
function clearPersisted() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(SCANPAY_PERSIST_KEY); } catch { /* ignore */ }
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
  // Heuristic: low-end devices → smaller fps + smaller scan area to keep
  // each decode pass fast. Detection still triggers within 1–2 frames.
  const cores = (typeof navigator !== "undefined" && Number(navigator.hardwareConcurrency)) || 4;
  const memRaw = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  const mem = typeof memRaw === "number" ? memRaw : 4;
  const isLowEnd = cores <= 4 || mem <= 2;

  // qrbox must be a fixed object for html5-qrcode to honour it reliably.
  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const vh = typeof window !== "undefined" ? window.innerHeight : 640;
  const base = Math.min(vw, vh);
  const edge = Math.min(360, Math.floor(base * (isLowEnd ? 0.62 : 0.74)));

  return {
    fps: isLowEnd ? 12 : 24,
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
  const decodedRef = useRef(false);
  const lastInvalidToastRef = useRef(0);
  const lastDecodeAttemptRef = useRef<number>(Date.now());
  const watchdogRef = useRef<number | null>(null);
  const tuningRef = useRef(pickAdaptiveTuning());

  // Bumping this value forces the scanner-init effect to re-run, which is our
  // "soft reset": dispose the current Html5Qrcode + camera, then start fresh.
  const [restartTick, setRestartTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras.length) throw new Error("No camera available");
        const camId = cameras.find((c) => /back|rear|environment/i.test(c.label))?.id ?? cameras[0].id;
        if (cancelled) return;

        const tuning = tuningRef.current;
        await scanner.start(
          camId,
          {
            fps: tuning.fps,
            qrbox: tuning.qrbox,
            aspectRatio: 1,
            videoConstraints: {
              facingMode: { ideal: "environment" },
              advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
            } as MediaTrackConstraints,
            useBarCodeDetectorIfSupported: true,
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
              return;
            }
            // ✅ Valid UPI QR detected → INSTANT redirect to confirm page.
            // Stop scanner first (fire-and-forget) and hand off synchronously
            // — onDecoded sets phase="confirm" immediately, no extra taps.
            decodedRef.current = true;
            if (watchdogRef.current) { window.clearInterval(watchdogRef.current); watchdogRef.current = null; }
            scanner.stop().catch(() => {});
            onDecoded(result.payload);
          },
          () => {
            // html5-qrcode fires the failure callback on every frame that didn't decode.
            // We piggy-back on it as a heartbeat → if it stops firing, the camera/decoder is stuck.
            lastDecodeAttemptRef.current = Date.now();
          },
        );
        if (!cancelled) {
          setStarting(false);
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
    setStarting(true);
    setRestartTick((t) => t + 1);
  };

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
      const scanner = scannerRef.current ?? new Html5Qrcode(containerId, { verbose: false });
      if (scanner.isScanning) await scanner.stop().catch(() => {});
      const decoded = await scanner.scanFile(file, false);
      const result = parseUpiQrWithReason(decoded);
      setDebug({ raw: decoded, result, at: Date.now() });
      if (result.payload) onDecoded(result.payload);
      else toast.error(result.reason ?? "Not a valid UPI QR code");
    } catch {
      toast.error("Could not read QR from image");
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

  return (
    <div className="flex-1 flex flex-col bg-[#0B0B0B] relative overflow-hidden">
      <div id={containerId} className="absolute inset-0 [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />
      <div className="absolute inset-0 bg-black/55 z-10 pointer-events-none"
        style={{ maskImage: "radial-gradient(circle at 50% 45%, transparent 138px, black 140px)", WebkitMaskImage: "radial-gradient(circle at 50% 45%, transparent 138px, black 140px)" }}
      />
      <div className="absolute top-0 left-0 right-0 z-30 px-5 pt-6 flex items-center justify-between">
        <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-[13px] font-medium tracking-wide text-white/80">Scan to Pay</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDebugOpen((v) => !v)}
            aria-label="Debug overlay"
            className={`w-10 h-10 rounded-full flex items-center justify-center ${debugOpen ? "bg-primary text-primary-foreground" : "glass"}`}
          >
            <Bug className="w-5 h-5" />
          </button>
          <button onClick={toggleTorch} aria-label="Toggle flash" className="w-10 h-10 rounded-full glass flex items-center justify-center">
            {torch ? <Zap className="w-5 h-5 text-[#6ee7a3]" /> : <ZapOff className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
        <div className="sp-scan-frame">
          <div className="sp-scan-glow" />
          <span className="sp-scan-corner top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl" />
          <span className="sp-scan-corner top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl" />
          <span className="sp-scan-corner bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl" />
          <span className="sp-scan-corner bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl" />
          <div className="sp-scan-beam" />
        </div>
        <p className="mt-8 text-[13px] text-white/75 tracking-wide">
          {starting ? "Starting camera…" : "Scan any QR to pay instantly"}
        </p>
        {!starting && (
          <button onClick={manualSoftReset} className="pointer-events-auto mt-3 text-[11px] text-white/55 underline underline-offset-4">
            Camera stuck? Re-tune
          </button>
        )}
      </div>

      {debugOpen && (
        <div className="absolute bottom-24 left-4 right-4 z-30 rounded-2xl bg-black/85 border border-white/10 backdrop-blur-md p-3 text-[11px] font-mono text-white/85 max-h-[40%] overflow-auto">
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

      <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center">
        <label className="btn-ghost cursor-pointer">
          <ImageIcon className="w-4 h-4" /> Upload from gallery
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>
      </div>
    </div>
  );
}

/* ============================================================
   2. CONFIRM + 3. SLIDE TO PAY
   ============================================================ */

function ConfirmView({
  payload, amount, onAmountChange, onConfirm, onBack, balance,
}: {
  payload: UpiPayload;
  amount: number;
  onAmountChange: (n: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  balance: number;
}) {
  const initial = (payload.payeeName || payload.upiId).trim().charAt(0).toUpperCase();
  const canPay = amount > 0;

  return (
    <div className="sp-confirm-root tw-slide-up">
      <div className="sp-confirm-grid" />
      <div className="sp-confirm-spot" />

      <div className="relative z-10 flex items-center justify-between px-5 pt-6">
        <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-[12px] uppercase tracking-[0.18em] text-white/55">Pay to</span>
        <button onClick={onBack} aria-label="Close" className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center px-6 mt-6">
        <div className="sp-avatar">{initial || "?"}</div>
        <p className="mt-4 text-[18px] font-semibold text-white">{payload.payeeName}</p>
        <p className="text-[12px] text-white/50 num-mono">{payload.upiId}</p>
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-3">Amount</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl text-white/55 num-mono">₹</span>
          <input
            autoFocus={!payload.amount}
            inputMode="decimal"
            value={amount === 0 ? "" : amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              onAmountChange(v === "" ? 0 : Number(v));
            }}
            placeholder="0"
            className="sp-amount bg-transparent outline-none text-center w-[200px]"
          />
        </div>
        {payload.note && <p className="mt-3 text-[12px] text-white/55 italic">"{payload.note}"</p>}
        <p className="mt-6 text-[11px] text-white/35">Wallet balance · ₹{balance.toFixed(2)}</p>
      </div>

      <div className="relative z-10 px-5 pb-8">
        <SlideToPay disabled={!canPay} onComplete={onConfirm} />
      </div>
    </div>
  );
}

function SlideToPay({ disabled, onComplete }: { disabled: boolean; onComplete: () => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startX = useRef(0);

  const knobSize = 56;
  const padding = 4;

  const getMaxX = () => {
    const w = trackRef.current?.offsetWidth ?? 320;
    return w - knobSize - padding * 2;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || completed) return;
    setDragging(true);
    startX.current = e.clientX - dragX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
    const max = getMaxX();
    if (dragX >= max - 6) {
      setDragX(max);
      setCompleted(true);
      if (navigator.vibrate) navigator.vibrate(50);
      setTimeout(onComplete, 220);
    } else {
      setDragX(0);
    }
  };

  const fillWidth = `${Math.min(100, ((dragX + knobSize + padding * 2) / (trackRef.current?.offsetWidth || 1)) * 100)}%`;

  return (
    <div
      ref={trackRef}
      className="sp-slide-track"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <div className="sp-slide-fill" style={{ width: completed ? "100%" : fillWidth, opacity: dragX > 4 ? 1 : 0 }} />
      <div className="sp-slide-label" style={{ opacity: dragX > 60 ? 0 : 1 }}>SLIDE TO PAY</div>
      <div
        className="sp-slide-knob"
        style={{ transform: `translateX(${dragX}px)`, transition: dragging ? "none" : "transform 220ms cubic-bezier(.2,.8,.2,1)" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="slider"
        aria-label="Slide to pay"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((dragX / (getMaxX() || 1)) * 100)}
      >
        {completed ? <Check className="w-6 h-6" /> : <ArrowRight className="w-6 h-6" />}
        {!dragging && !completed && <span className="sp-knob-shine" />}
      </div>
    </div>
  );
}

/* ============================================================
   4. PROCESSING
   ============================================================ */

function ProcessingView({ amount }: { amount: number }) {
  return (
    <div className="sp-process-root">
      {Array.from({ length: 6 }).map((_, i) => (
        <span
          key={i}
          className="sp-streak"
          style={{ left: `${20 + i * 12}%`, animationDelay: `${i * 0.25}s` }}
        />
      ))}
      <div className="relative">
        <div className="sp-orb-ring-2" />
        <div className="sp-orb-ring" />
        <div className="sp-orb" />
      </div>
      <p className="mt-12 text-[13px] tracking-[0.22em] uppercase text-white/65">Processing payment</p>
      <p className="mt-2 text-2xl num-mono font-bold text-white">₹{amount.toFixed(2)}</p>
    </div>
  );
}

/* ============================================================
   5. SUCCESS
   ============================================================ */

function SuccessView({ message, amount, payee, onDone }: { message: string; amount: number; payee: string; onDone: () => void }) {
  return (
    <div className="sp-success-root sp-success-vlines">
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="relative w-[160px] h-[160px] flex items-center justify-center">
          <span className="sp-success-ring" />
          <span className="sp-success-ring delay" />
          <div className="sp-success-badge">
            <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="#eafff1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 33 L28 45 L48 22" className="sp-success-check" />
            </svg>
          </div>
          {Array.from({ length: 14 }).map((_, i) => {
            const angle = (i / 14) * Math.PI * 2;
            const dist = 90 + (i % 3) * 10;
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

        <h2 className="mt-10 text-[26px] font-bold text-white tracking-tight kyc-fade-up">Payment successful</h2>
        <p className="mt-2 text-[14px] text-white/65 kyc-fade-up" style={{ animationDelay: "120ms" }}>
          ₹{amount.toFixed(0)} sent to <span className="text-white/90 font-medium">{payee || "recipient"}</span>
        </p>
        {message && <p className="mt-1 text-[11px] text-white/35">{message}</p>}
      </div>

      <div className="relative z-10 px-5 pb-8 flex flex-col gap-3">
        <button onClick={onDone} className="pv-btn">
          <span className="pv-btn-shine" />
          Done
        </button>
        <button
          onClick={() => {
            const text = `Payment of ₹${amount.toFixed(0)} to ${payee} via Teen Wallet`;
            if (navigator.share) navigator.share({ title: "Payment receipt", text }).catch(() => {});
            else { navigator.clipboard?.writeText(text); toast.success("Receipt copied"); }
          }}
          className="text-[13px] text-white/65 hover:text-white inline-flex items-center justify-center gap-2 py-2"
        >
          <Share2 className="w-4 h-4" /> Share receipt
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   FAILED
   ============================================================ */

function FailedView({
  kind, message, onRetry, onCancel,
}: {
  kind: FailKind;
  message: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const isBalance = kind === "balance_changed";
  const heading = isBalance ? "Balance changed" : "Payment failed";
  const primaryLabel = isBalance ? "Scan a new QR" : "Try again";
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center tw-slide-up tw-shake bg-background">
      <div className="w-24 h-24 rounded-full bg-destructive/15 border border-destructive/40 flex items-center justify-center">
        <X className="w-12 h-12 text-destructive" strokeWidth={2} />
      </div>
      <h2 className="mt-8 text-2xl font-bold">{heading}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-10 flex gap-3 w-full max-w-xs">
        <button onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button onClick={onRetry} className="btn-primary flex-1">{primaryLabel}</button>
      </div>
    </div>
  );
}
