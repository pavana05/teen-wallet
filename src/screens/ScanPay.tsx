import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, ArrowRight, Image as ImageIcon, Zap, ZapOff, X, Share2, Check } from "lucide-react";
import { parseUpiQr, type UpiPayload } from "@/lib/upi";
import { scanTransaction, logFraudFlags } from "@/lib/fraud";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Phase = "scanning" | "confirm" | "processing" | "success" | "failed";
type FailKind = "generic" | "balance_changed" | "insufficient" | "blocked";

export function ScanPay({ onBack }: { onBack: () => void }) {
  const { userId, balance } = useApp();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [payload, setPayload] = useState<UpiPayload | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [resultMsg, setResultMsg] = useState("");
  const [failKind, setFailKind] = useState<FailKind>("generic");

  const navLockRef = useRef(false);
  const handleDecoded = (parsed: UpiPayload) => {
    // Guardrail: ignore duplicate decodes / double-fires that race the camera stop.
    if (navLockRef.current) return;
    navLockRef.current = true;
    if (navigator.vibrate) navigator.vibrate(40);
    setPayload(parsed);
    setAmount(parsed.amount ?? 0);
    setPhase("confirm");
  };

  const handlePay = useCallback(async () => {
    if (!userId || !payload) return;
    setPhase("processing");
    const amt = amount;

    const finalReport = await scanTransaction({ userId, amount: amt, upiId: payload.upiId });
    if (finalReport.blocked) {
      await logFraudFlags(userId, null, finalReport.flags, "blocked");
      setResultMsg(finalReport.flags.find((f) => f.severity === "block")?.message ?? "Payment blocked");
      setPhase("failed");
      return;
    }
    if (amt > balance) {
      setResultMsg("Insufficient balance");
      setPhase("failed");
      return;
    }

    // Minimum visible processing window for premium feel
    await new Promise((r) => setTimeout(r, 1600));

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
      setPhase("failed");
      return;
    }

    await logFraudFlags(userId, txn.id, finalReport.flags, finalReport.flags.length === 0 ? "auto_passed" : "user_confirmed");
    const newBal = balance - amt;
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

  const reset = () => {
    setPayload(null);
    setAmount(0);
    setResultMsg("");
    setPhase("scanning");
  };

  if (phase === "processing") return <ProcessingView amount={amount} />;
  if (phase === "success") return <SuccessView message={resultMsg} amount={amount} payee={payload?.payeeName ?? ""} onDone={onBack} />;
  if (phase === "failed") return <FailedView message={resultMsg} onRetry={reset} onCancel={onBack} />;
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
  return <ScannerView onBack={onBack} onDecoded={handleDecoded} />;
}

/* ============================================================
   1. SCANNER
   ============================================================ */

function ScannerView({ onBack, onDecoded }: { onBack: () => void; onDecoded: (p: UpiPayload) => void }) {
  const containerId = "tw-qr-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [torch, setTorch] = useState(false);
  const decodedRef = useRef(false);

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
        await scanner.start(
          camId,
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (decodedRef.current) return;
            const parsed = parseUpiQr(decoded);
            if (parsed) {
              decodedRef.current = true;
              scanner.stop().catch(() => {});
              onDecoded(parsed);
            }
          },
          () => {},
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Camera unavailable");
      }
    };
    void start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s && s.isScanning) s.stop().then(() => s.clear()).catch(() => {});
      scannerRef.current = null;
    };
  }, [onDecoded]);

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      // @ts-expect-error torch is a non-standard track constraint
      await s.applyVideoConstraints({ advanced: [{ torch: !torch }] });
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
      const parsed = parseUpiQr(decoded);
      if (parsed) onDecoded(parsed);
      else toast.error("Not a valid UPI QR code");
    } catch {
      toast.error("Could not read QR from image");
    }
  };

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
        <button onClick={toggleTorch} aria-label="Toggle flash" className="w-10 h-10 rounded-full glass flex items-center justify-center">
          {torch ? <Zap className="w-5 h-5 text-[#6ee7a3]" /> : <ZapOff className="w-5 h-5" />}
        </button>
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
        <p className="mt-8 text-[13px] text-white/75 tracking-wide">Scan any QR to pay instantly</p>
      </div>

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

function FailedView({ message, onRetry, onCancel }: { message: string; onRetry: () => void; onCancel: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center tw-slide-up tw-shake bg-background">
      <div className="w-24 h-24 rounded-full bg-destructive/15 border border-destructive/40 flex items-center justify-center">
        <X className="w-12 h-12 text-destructive" strokeWidth={2} />
      </div>
      <h2 className="mt-8 text-2xl font-bold">Payment failed</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-10 flex gap-3 w-full max-w-xs">
        <button onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
        <button onClick={onRetry} className="btn-primary flex-1">Try again</button>
      </div>
    </div>
  );
}
