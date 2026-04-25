import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowLeft, Image as ImageIcon, ShieldAlert, ShieldCheck, Zap, ZapOff, X, CheckCircle2 } from "lucide-react";
import { parseUpiQr, type UpiPayload } from "@/lib/upi";
import { scanTransaction, logFraudFlags, type FraudReport } from "@/lib/fraud";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Phase = "scanning" | "review" | "processing" | "success" | "failed";

export function ScanPay({ onBack }: { onBack: () => void }) {
  const { userId, balance } = useApp();
  const containerId = "tw-qr-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [torch, setTorch] = useState(false);
  const [payload, setPayload] = useState<UpiPayload | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [report, setReport] = useState<FraudReport | null>(null);
  const [warnAcknowledged, setWarnAcknowledged] = useState(false);
  const [paying, setPaying] = useState(false);
  const [resultMsg, setResultMsg] = useState<string>("");

  // Boot scanner
  useEffect(() => {
    if (phase !== "scanning") return;
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
            const parsed = parseUpiQr(decoded);
            if (parsed) handleDecoded(parsed);
          },
          () => {},
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Camera unavailable";
        toast.error(msg);
      }
    };
    start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s && s.isScanning) {
        s.stop().then(() => s.clear()).catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [phase]);

  const handleDecoded = async (parsed: UpiPayload) => {
    if (navigator.vibrate) navigator.vibrate(40);
    const s = scannerRef.current;
    if (s && s.isScanning) await s.stop().catch(() => {});
    setPayload(parsed);
    if (parsed.amount) setAmount(parsed.amount.toString());
    setNote(parsed.note ?? "");
    setPhase("review");
    if (userId) {
      const r = await scanTransaction({
        userId,
        amount: parsed.amount ?? 0,
        upiId: parsed.upiId,
      });
      setReport(r);
    }
  };

  // Re-run fraud check when amount changes in review
  useEffect(() => {
    if (phase !== "review" || !userId || !payload) return;
    const amt = Number(amount) || 0;
    let active = true;
    scanTransaction({ userId, amount: amt, upiId: payload.upiId }).then((r) => {
      if (active) setReport(r);
    });
    return () => { active = false; };
  }, [amount, phase, userId, payload]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const scanner = scannerRef.current ?? new Html5Qrcode(containerId, { verbose: false });
      if (scanner.isScanning) await scanner.stop().catch(() => {});
      const decoded = await scanner.scanFile(file, false);
      const parsed = parseUpiQr(decoded);
      if (parsed) handleDecoded(parsed);
      else toast.error("Not a valid UPI QR code");
    } catch {
      toast.error("Could not read QR from image");
    }
  };

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

  const blocked = report?.blocked ?? false;
  const warns = report?.flags.filter((f) => f.severity === "warn") ?? [];
  const amt = Number(amount) || 0;
  const canPay = !!payload && amt > 0 && !blocked && (warns.length === 0 || warnAcknowledged) && !paying;

  const handlePay = async () => {
    if (!userId || !payload) return;
    setPaying(true);
    setPhase("processing");

    // Final fraud check
    const finalReport = await scanTransaction({ userId, amount: amt, upiId: payload.upiId });
    if (finalReport.blocked) {
      await logFraudFlags(userId, null, finalReport.flags, "blocked");
      setResultMsg(finalReport.flags.find((f) => f.severity === "block")?.message ?? "Payment blocked");
      setPhase("failed");
      setPaying(false);
      return;
    }

    if (amt > balance) {
      setResultMsg("Insufficient balance");
      setPhase("failed");
      setPaying(false);
      return;
    }

    // Simulated UPI settlement (kept here so real PSP can be swapped in)
    await new Promise((r) => setTimeout(r, 1400));

    const { data: txn, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        amount: amt,
        merchant_name: payload.payeeName,
        upi_id: payload.upiId,
        note: note || null,
        status: "success",
        fraud_flags: finalReport.flags as never,
      })
      .select()
      .single();

    if (error || !txn) {
      setResultMsg(error?.message ?? "Payment failed");
      setPhase("failed");
      setPaying(false);
      return;
    }

    await logFraudFlags(
      userId,
      txn.id,
      finalReport.flags,
      finalReport.flags.length === 0 ? "auto_passed" : "user_confirmed",
    );

    // Update wallet balance
    const newBal = balance - amt;
    await supabase.from("profiles").update({ balance: newBal }).eq("id", userId);
    useApp.setState({ balance: newBal });

    // Notification
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "transaction",
      title: `₹${amt.toFixed(2)} paid to ${payload.payeeName}`,
      body: payload.upiId,
    });

    setResultMsg(`₹${amt.toFixed(2)} paid to ${payload.payeeName}`);
    setPhase("success");
    setPaying(false);
  };

  // ============ RENDER ============

  if (phase === "processing") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background relative">
        <div className="relative w-32 h-32 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full border-2 border-primary/40 tw-pulse-ring" />
          <span className="absolute inset-0 rounded-full border-2 border-primary/40 tw-pulse-ring" style={{ animationDelay: "0.4s" }} />
          <span className="absolute inset-0 rounded-full border-2 border-primary/40 tw-pulse-ring" style={{ animationDelay: "0.8s" }} />
          <div className="w-16 h-16 rounded-full bg-primary lime-glow" />
        </div>
        <p className="mt-10 text-sm tracking-widest text-muted-foreground">PROCESSING PAYMENT…</p>
        <p className="mt-2 text-2xl num-mono font-bold">₹{amt.toFixed(2)}</p>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center tw-slide-up">
        <div className="w-24 h-24 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center lime-glow">
          <CheckCircle2 className="w-12 h-12 text-primary" strokeWidth={2} />
        </div>
        <h2 className="mt-8 text-2xl font-bold">Payment Successful</h2>
        <p className="mt-2 text-sm text-muted-foreground">{resultMsg}</p>
        <button onClick={onBack} className="btn-primary mt-10 w-full max-w-xs">Done</button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center tw-slide-up tw-shake">
        <div className="w-24 h-24 rounded-full bg-destructive/15 border border-destructive/40 flex items-center justify-center">
          <X className="w-12 h-12 text-destructive" strokeWidth={2} />
        </div>
        <h2 className="mt-8 text-2xl font-bold">Payment Failed</h2>
        <p className="mt-2 text-sm text-muted-foreground">{resultMsg}</p>
        <div className="mt-10 flex gap-3 w-full max-w-xs">
          <button onClick={onBack} className="btn-ghost flex-1">Cancel</button>
          <button onClick={() => { setPhase("scanning"); setPayload(null); setReport(null); setWarnAcknowledged(false); }} className="btn-primary flex-1">Try Again</button>
        </div>
      </div>
    );
  }

  // SCANNING + REVIEW share the camera area; review pulls up bottom sheet
  return (
    <div className="flex-1 flex flex-col bg-black relative">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 px-5 pt-6 flex items-center justify-between">
        <button onClick={onBack} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium">Scan QR Code</span>
        <button onClick={toggleTorch} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          {torch ? <Zap className="w-5 h-5 text-primary" /> : <ZapOff className="w-5 h-5" />}
        </button>
      </div>

      {/* Camera region */}
      <div id={containerId} className="absolute inset-0 [&_video]:object-cover [&_video]:w-full [&_video]:h-full" />

      {/* Scan overlay */}
      {phase === "scanning" && (
        <>
          <div className="absolute inset-0 bg-black/40 z-10 pointer-events-none"
            style={{ maskImage: "radial-gradient(circle at 50% 45%, transparent 130px, black 132px)", WebkitMaskImage: "radial-gradient(circle at 50% 45%, transparent 130px, black 132px)" }}
          />
          <div className="absolute inset-0 z-20 flex flex-col items-center pointer-events-none">
            <div className="mt-[35%] relative w-64 h-64">
              {/* corner brackets */}
              {(["tl","tr","bl","br"] as const).map((corner) => (
                <span key={corner} className={`absolute w-8 h-8 border-primary ${
                  corner === "tl" ? "top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl" :
                  corner === "tr" ? "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl" :
                  corner === "bl" ? "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl" :
                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl"
                }`} />
              ))}
              {/* sweeping beam */}
              <div className="absolute inset-x-0 top-0 h-0.5 bg-primary lime-glow tw-scan-beam" />
            </div>
            <p className="mt-6 text-xs text-white/80 tracking-wide">Point at any UPI QR code</p>
          </div>

          <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center">
            <label className="btn-ghost cursor-pointer">
              <ImageIcon className="w-4 h-4" /> Upload from gallery
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
          </div>
        </>
      )}

      {/* Review bottom sheet */}
      {phase === "review" && payload && (
        <div className="absolute inset-0 z-40 bg-black/70 flex items-end">
          <div className="w-full glass rounded-t-3xl p-6 tw-slide-up max-h-[88%] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Paying to</p>
                <p className="text-lg font-semibold">{payload.payeeName}</p>
                <p className="text-[11px] text-muted-foreground num-mono">{payload.upiId}</p>
              </div>
              <button onClick={() => { setPhase("scanning"); setPayload(null); setReport(null); setWarnAcknowledged(false); }} className="w-8 h-8 rounded-full glass flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-6">
              <label className="text-[11px] text-muted-foreground tracking-wide uppercase">Amount</label>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl text-muted-foreground">₹</span>
                <input
                  autoFocus={!payload.amount}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setWarnAcknowledged(false); }}
                  placeholder="0"
                  className="tw-input text-3xl font-bold num-mono flex-1 border-b-0"
                />
              </div>
              {report && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Daily limit: ₹{report.remainingDailyLimit.toLocaleString("en-IN")} remaining
                </p>
              )}
            </div>

            <div className="mt-4">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (optional)"
                className="tw-input text-sm"
                maxLength={80}
              />
            </div>

            {/* Fraud flags */}
            {report && report.flags.length > 0 && (
              <div className="mt-4 space-y-2">
                {report.flags.map((f, i) => (
                  <div key={i} className={`rounded-2xl p-3 flex gap-3 items-start border ${
                    f.severity === "block" ? "bg-destructive/10 border-destructive/40" : "bg-yellow-500/5 border-yellow-500/30"
                  }`}>
                    <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${f.severity === "block" ? "text-destructive" : "text-yellow-400"}`} />
                    <div className="flex-1">
                      <p className="text-[11px] tracking-wide uppercase opacity-70">{f.rule.replace("_", " ")}</p>
                      <p className="text-xs">{f.message}</p>
                    </div>
                  </div>
                ))}
                {warns.length > 0 && !blocked && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <input type="checkbox" checked={warnAcknowledged} onChange={(e) => setWarnAcknowledged(e.target.checked)} className="accent-primary" />
                    I've reviewed the warnings and want to continue
                  </label>
                )}
              </div>
            )}

            {report && report.flags.length === 0 && amt > 0 && (
              <div className="mt-4 rounded-2xl p-3 flex gap-2 items-center bg-primary/5 border border-primary/20">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">No risk flags. Looks safe.</span>
              </div>
            )}

            <button disabled={!canPay} onClick={handlePay} className="btn-primary w-full mt-6">
              Pay ₹{amt > 0 ? amt.toFixed(2) : "0.00"}
            </button>
            <p className="text-[10px] text-center text-muted-foreground mt-2">Wallet balance: ₹{balance.toFixed(2)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
