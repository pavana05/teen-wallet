import { useState, useRef, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { sendOtp, verifyOtp, setStage as persistStage, fetchProfile } from "@/lib/auth";
import { useApp, type Stage } from "@/lib/store";
import { toast } from "sonner";
import { PhoneVerified } from "./PhoneVerified";

type Step = "phone" | "otp" | "verified";

export function AuthPhone({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resendIn, setResendIn] = useState(30);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { setPendingPhone, hydrateFromProfile } = useApp();

  useEffect(() => {
    if (step !== "otp") return;
    setResendIn(30);
    const t = setInterval(() => setResendIn((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step]);

  const valid = /^[6-9]\d{9}$/.test(phone);
  const formatted = phone.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? `${a} ${b}` : a));

  async function handleSendOtp() {
    if (!valid) { setError("Enter a valid Indian mobile number"); return; }
    setError(""); setBusy(true);
    try {
      const r = await sendOtp(phone);
      setPendingPhone("+91" + phone);
      toast.success(`OTP sent — dev code: ${r.devOtp}`);
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally { setBusy(false); }
  }

  function classifyError(e: unknown): { message: string; isNetwork: boolean } {
    const raw = e instanceof Error ? e.message : String(e ?? "");
    const lower = raw.toLowerCase();
    const isNetwork =
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("load failed") ||
      lower.includes("network request failed") ||
      (e instanceof TypeError && lower.includes("fetch"));
    if (isNetwork) {
      return {
        message:
          "Couldn't reach our servers. This often happens in the in-app preview — please check your connection or open the published app and try again.",
        isNetwork: true,
      };
    }
    if (lower.includes("invalid") && lower.includes("otp")) {
      return { message: "That code didn't match. Please re-enter the OTP.", isNetwork: false };
    }
    if (lower.includes("expired")) {
      return { message: "Your OTP expired. Tap Resend to get a new code.", isNetwork: false };
    }
    return { message: raw || "Verification failed. Please try again.", isNetwork: false };
  }

  async function handleVerify(code: string) {
    setBusy(true); setError("");
    try {
      await verifyOtp(phone, code);
      const p = await fetchProfile();
      // Resume from where the user left off. New users start at STAGE_3 (KYC).
      // CRITICAL: if KYC was already approved (e.g. on another device), jump straight to STAGE_5.
      let resumedStage: Stage = "STAGE_3";
      if (p) {
        const profileStage = p.onboarding_stage as Stage;
        const kyc = p.kyc_status as string | null;
        if (kyc === "approved") {
          // KYC done — go home regardless of saved stage.
          resumedStage = "STAGE_5";
        } else if (kyc === "pending") {
          // Awaiting approval — show pending screen.
          resumedStage = "STAGE_4";
        } else if (profileStage === "STAGE_0" || profileStage === "STAGE_1" || profileStage === "STAGE_2") {
          // Pre-auth stage on profile — advance to KYC.
          resumedStage = "STAGE_3";
        } else {
          // Honor whatever stage the profile holds (STAGE_3/4/5).
          resumedStage = profileStage;
        }
        hydrateFromProfile({ id: p.id, full_name: p.full_name, balance: Number(p.balance), onboarding_stage: resumedStage });
      }
      if (!p || p.onboarding_stage !== resumedStage) {
        await persistStage(resumedStage);
      }
      setStep("verified");
    } catch (e) {
      const { message, isNetwork } = classifyError(e);
      setError(message);
      toast.error(isNetwork ? "Network error" : "Verification failed", { description: message });
      // Keep the entered code on network errors so the user can simply tap Try again.
      if (!isNetwork) {
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => inputs.current[0]?.focus(), 0);
      }
    } finally { setBusy(false); }
  }

  function retryVerify() {
    const code = otp.join("");
    if (code.length === 6) void handleVerify(code);
    else inputs.current[otp.findIndex((d) => !d)]?.focus();
  }

  function onOtpChange(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...otp]; next[i] = d; setOtp(next);
    if (d && i < 5) inputs.current[i + 1]?.focus();
    if (next.every((x) => x)) handleVerify(next.join(""));
  }

  if (step === "verified") {
    return <PhoneVerified onContinue={onDone} />;
  }

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex items-center justify-between mb-12">
        <button onClick={() => step === "otp" ? setStep("phone") : null} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm tracking-[0.3em] text-white/80 font-light">TEEN WALLET</span>
        <div className="w-10" />
      </div>

      {step === "phone" ? (
        <>
          <h1 className="text-[32px] font-bold leading-tight">What's your<br/>number?</h1>
          <p className="text-[#888] mt-3 text-sm">We'll send a 6-digit OTP to verify it's really you.</p>

          <div className="mt-12 flex items-end gap-3">
            <div className="px-4 py-3 rounded-full glass flex items-center gap-2 text-sm font-medium">🇮🇳 +91</div>
            <div className="flex-1">
              <input
                inputMode="numeric"
                value={formatted}
                onChange={(e) => { setError(""); setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); }}
                placeholder="98765 43210"
                className="tw-input text-2xl num-mono"
                autoFocus
              />
            </div>
          </div>
          {error && <p className={`text-destructive text-xs mt-3 ${error ? "tw-shake" : ""}`}>{error}</p>}

          <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
            By continuing, you agree to our <span className="text-white/80 underline">Terms</span> & <span className="text-white/80 underline">Privacy Policy</span>.
          </p>

          <div className="flex-1" />
          <button disabled={!valid || busy} onClick={handleSendOtp} className="btn-primary w-full">
            {busy ? "Sending..." : "Send OTP"}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-[32px] font-bold">Enter OTP</h1>
          <p className="text-[#888] mt-3 text-sm">
            Sent to +91 {formatted} — <button onClick={() => setStep("phone")} className="text-primary underline">Edit number</button>
          </p>

          <div className={`mt-12 flex gap-3 ${error ? "tw-shake" : ""}`}>
            {otp.map((v, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                inputMode="numeric"
                maxLength={1}
                value={v}
                onChange={(e) => onOtpChange(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Backspace" && !v && i > 0) inputs.current[i - 1]?.focus(); }}
                className="w-12 h-14 text-center text-2xl font-bold rounded-2xl glass focus:outline-none focus:ring-2 focus:ring-primary num-mono"
              />
            ))}
          </div>
          {error && (
            <div className="mt-3 space-y-2">
              <p className="text-destructive text-xs leading-relaxed">{error}</p>
              {!busy && otp.every((d) => d) && (
                <button
                  onClick={retryVerify}
                  className="text-primary text-xs font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <div className="mt-6 text-sm">
            {resendIn > 0 ? (
              <span className="text-muted-foreground">Resend OTP in {resendIn}s</span>
            ) : (
              <button onClick={handleSendOtp} className="text-primary font-medium">Resend OTP</button>
            )}
          </div>

          <div className="flex-1" />
          {busy && <div className="text-center text-sm text-muted-foreground mb-4">Verifying...</div>}
        </>
      )}
    </div>
  );
}
