import { useState, useRef, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { sendOtp, verifyOtp, setStage as persistStage, fetchProfile } from "@/lib/auth";
import { useApp, type Stage } from "@/lib/store";
import { toast } from "sonner";
import { PhoneVerified } from "./PhoneVerified";
import { isJustVerified } from "@/lib/justVerified";
import { supabase } from "@/integrations/supabase/client";
import {
  classifyOtpError,
  clearOtpState,
  loadOtpState,
  logOtpErrorEvent,
  saveOtpState,
  type OtpErrorKind,
} from "@/lib/otpState";
import { CopyableErrorId } from "@/components/CopyableErrorId";
import { ResendCountdown } from "@/components/ResendCountdown";
import { recordCheckpoint } from "@/lib/navState";
import { maybeInsertWelcome, maybeInsertGreeting } from "@/lib/notify";

type Step = "phone" | "otp" | "verified";

// Escalating cooldown ladder. Each successive resend within the same OTP attempt
// extends the wait so a user (or script) can't hammer the SMS provider. The last
// step is a hard 5-minute lockout treated as rate-limited.
const RESEND_LADDER_S = [30, 60, 120, 300];
const MAX_RESENDS_BEFORE_LOCK = RESEND_LADDER_S.length;
const cooldownForCount = (count: number) =>
  RESEND_LADDER_S[Math.min(count, RESEND_LADDER_S.length - 1)];

export function AuthPhone({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<OtpErrorKind | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resendIn, setResendIn] = useState(RESEND_LADDER_S[0]);
  const [resendBlockedUntil, setResendBlockedUntil] = useState<number | null>(null);
  // Total ms of the currently-running cooldown so the ring can show fill progress.
  const [cooldownTotalMs, setCooldownTotalMs] = useState<number>(RESEND_LADDER_S[0] * 1000);
  // Number of successful resends this attempt — drives the escalating ladder.
  const [resendCount, setResendCount] = useState<number>(0);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const otpRowRef = useRef<HTMLDivElement | null>(null);
  const { setPendingPhone, hydrateFromProfile } = useApp();

  // Restore mid-celebration session, OR a persisted in-progress OTP attempt.
  useEffect(() => {
    if (isJustVerified()) {
      let cancelled = false;
      void (async () => {
        const { data } = await supabase.auth.getUser();
        if (!cancelled && data.user) setStep("verified");
      })();
      return () => { cancelled = true; };
    }
    const persisted = loadOtpState();
    if (persisted && persisted.phone) {
      setPhone(persisted.phone);
      setOtp(persisted.digits.length === 6 ? persisted.digits : ["", "", "", "", "", ""]);
      setError(persisted.error || "");
      setErrorKind(persisted.errorKind);
      setErrorId(persisted.correlationId);
      setResendBlockedUntil(persisted.resendBlockedUntil);
      const rc = persisted.resendCount ?? 0;
      setResendCount(rc);
      const totalMs = persisted.cooldownTotalMs ?? cooldownForCount(rc) * 1000;
      setCooldownTotalMs(totalMs);
      setStep("otp");
    }
  }, []);

  // Resend cooldown ticker — also honors a server-side rate-limit window.
  useEffect(() => {
    if (step !== "otp") return;
    const computeRemaining = () => {
      if (resendBlockedUntil && resendBlockedUntil > Date.now()) {
        return Math.ceil((resendBlockedUntil - Date.now()) / 1000);
      }
      return resendIn;
    };
    setResendIn((v) => (resendBlockedUntil && resendBlockedUntil > Date.now() ? Math.ceil((resendBlockedUntil - Date.now()) / 1000) : v));
    const t = setInterval(() => setResendIn(() => Math.max(0, computeRemaining() - 1)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, resendBlockedUntil]);

  // Persist OTP UX state on every meaningful change so refresh doesn't lose progress.
  useEffect(() => {
    if (step !== "otp") return;
    saveOtpState({
      phone, digits: otp, error, errorKind, correlationId: errorId, busy,
      resendBlockedUntil, resendCount, cooldownTotalMs,
    });
  }, [step, phone, otp, error, errorKind, errorId, busy, resendBlockedUntil, resendCount, cooldownTotalMs]);

  // Auto-focus first empty OTP slot when entering the OTP step.
  useEffect(() => {
    if (step !== "otp") return;
    const idx = otp.findIndex((d) => !d);
    inputs.current[idx === -1 ? 5 : idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const valid = /^[6-9]\d{9}$/.test(phone);
  const formatted = phone.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? `${a} ${b}` : a));
  const resendBlocked = resendIn > 0 || (resendBlockedUntil !== null && resendBlockedUntil > Date.now());
  const lockedOut = resendCount >= MAX_RESENDS_BEFORE_LOCK && resendBlocked;

  /**
   * Start a fresh cooldown window. `escalate=true` advances the ladder (used
   * for resends); `escalate=false` keeps the same step (used for the initial
   * send so the first cooldown is always 30s).
   */
  function startCooldown(escalate: boolean) {
    const nextCount = escalate ? Math.min(resendCount + 1, MAX_RESENDS_BEFORE_LOCK) : resendCount;
    const seconds = cooldownForCount(escalate ? nextCount - 1 : nextCount);
    setResendCount(nextCount);
    setCooldownTotalMs(seconds * 1000);
    setResendIn(seconds);
    setResendBlockedUntil(Date.now() + seconds * 1000);
  }

  async function handleSendOtp() {
    if (!valid) { setError("Enter a valid Indian mobile number"); return; }
    // Hard client-side block — never let a click fire while in cooldown.
    if (step === "otp" && resendBlocked) return;
    setError(""); setErrorKind(null); setErrorId(null); setBusy(true);
    recordCheckpoint({
      screen: "auth",
      action: "auth_phone_entered",
      detail: { phoneTail: phone.slice(-4) },
      stage: "STAGE_2",
    });
    try {
      const r = await sendOtp(phone);
      setPendingPhone("+91" + phone);
      toast.success(`OTP sent — dev code: ${r.devOtp}`);
      // First send keeps the base cooldown; subsequent sends escalate.
      startCooldown(step === "otp");
      recordCheckpoint({
        screen: "auth",
        action: "auth_otp_sent",
        detail: { phoneTail: phone.slice(-4) },
        stage: "STAGE_2",
      });
      setStep("otp");
    } catch (e) {
      const { message, kind, correlationId } = classifyOtpError(e);
      setError(message); setErrorKind(kind); setErrorId(correlationId);
      void logOtpErrorEvent(kind, e instanceof Error ? e.message : String(e), phone, correlationId);
      if (kind === "rate_limited") {
        // Server told us to back off — jump to the longest cooldown step.
        const seconds = RESEND_LADDER_S[RESEND_LADDER_S.length - 1];
        setResendCount(MAX_RESENDS_BEFORE_LOCK);
        setCooldownTotalMs(seconds * 1000);
        setResendIn(seconds);
        setResendBlockedUntil(Date.now() + seconds * 1000);
      }
    } finally { setBusy(false); }
  }

  async function handleVerify(code: string) {
    setBusy(true); setError(""); setErrorKind(null); setErrorId(null);
    try {
      await verifyOtp(phone, code);
      const p = await fetchProfile();
      // Resume from where the user left off. New users start at STAGE_3 (KYC).
      let resumedStage: Stage = "STAGE_3";
      if (p) {
        const profileStage = p.onboarding_stage as Stage;
        const kyc = p.kyc_status as string | null;
        if (kyc === "approved") resumedStage = "STAGE_5";
        else if (kyc === "pending") resumedStage = "STAGE_4";
        else if (profileStage === "STAGE_0" || profileStage === "STAGE_1" || profileStage === "STAGE_2") resumedStage = "STAGE_3";
        else resumedStage = profileStage;
        hydrateFromProfile({ id: p.id, full_name: p.full_name, balance: Number(p.balance), onboarding_stage: resumedStage });
      }
      if (!p || p.onboarding_stage !== resumedStage) {
        await persistStage(resumedStage);
      }
      clearOtpState();
      // Greet the user once per calendar day with an in-app entry notification.
      if (p?.id) {
        void maybeInsertWelcome(p.id, p.full_name ?? null);
      }
      recordCheckpoint({
        screen: "auth",
        action: "auth_otp_verified",
        detail: { resumedStage },
        stage: resumedStage,
      });
      setStep("verified");
    } catch (e) {
      const { message, kind, correlationId } = classifyOtpError(e);
      setError(message); setErrorKind(kind); setErrorId(correlationId);
      void logOtpErrorEvent(kind, e instanceof Error ? e.message : String(e), phone, correlationId);
      toast.error(kind === "network" ? "Network error" : "Verification failed", { description: `${message} (ID: ${correlationId})` });

      if (kind === "rate_limited") {
        const seconds = RESEND_LADDER_S[RESEND_LADDER_S.length - 1];
        setResendCount(MAX_RESENDS_BEFORE_LOCK);
        setCooldownTotalMs(seconds * 1000);
        setResendIn(seconds);
        setResendBlockedUntil(Date.now() + seconds * 1000);
      }

      // Keep entered digits on network errors so the user can just tap Try again.
      // For invalid/expired/unknown, clear and re-focus first slot.
      if (kind !== "network") {
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => inputs.current[0]?.focus(), 0);
      }
    } finally { setBusy(false); }
  }

  function retryVerify() {
    const code = otp.join("");
    setError(""); setErrorKind(null);
    if (code.length === 6) void handleVerify(code);
    else {
      const idx = otp.findIndex((d) => !d);
      inputs.current[idx === -1 ? 0 : idx]?.focus();
    }
  }

  function onOtpChange(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...otp]; next[i] = d; setOtp(next);
    // Editing any digit clears the prior error so the user gets immediate feedback.
    if (error) { setError(""); setErrorKind(null); setErrorId(null); }
    if (d && i < 5) inputs.current[i + 1]?.focus();
    if (next.every((x) => x)) handleVerify(next.join(""));
  }

  // Tapping anywhere on the OTP row auto-focuses the first empty slot.
  function focusOtp() {
    const idx = otp.findIndex((d) => !d);
    inputs.current[idx === -1 ? 5 : idx]?.focus();
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

          <div className="mt-12">
            <label htmlFor="tw-phone" className="text-[10.5px] tracking-[0.18em] uppercase text-white/55 font-medium">
              Mobile number
            </label>
            <label
              htmlFor="tw-phone"
              className={`tw-phone-field tw-phone-field-v2 mt-2 ${error ? "tw-phone-field-error" : ""} ${valid ? "tw-phone-field-valid" : ""}`}
            >
              <span className="tw-phone-aurora" aria-hidden="true" />
              <span className="tw-phone-cc">
                <span className="tw-phone-flag" aria-hidden="true">🇮🇳</span>
                <span className="text-[13px] font-semibold tracking-tight">+91</span>
              </span>
              <span className="tw-phone-divider" aria-hidden="true" />

              {/* Animated digit slots */}
              <span className="tw-phone-slots" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => {
                  const ch = phone[i];
                  const isGap = i === 5;
                  return (
                    <span key={i} className={`tw-slot ${isGap ? "tw-slot-gap" : ""} ${ch ? "tw-slot-filled" : ""}`}>
                      {ch ? (
                        <span key={`${i}-${ch}`} className="tw-slot-digit num-mono">{ch}</span>
                      ) : (
                        <span className="tw-slot-dot" />
                      )}
                    </span>
                  );
                })}
              </span>

              {/* Hidden native input drives state + keyboard */}
              <input
                id="tw-phone"
                inputMode="numeric"
                value={phone}
                onChange={(e) => { setError(""); setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); }}
                className="tw-phone-input-hidden"
                aria-invalid={!!error}
                aria-describedby={error ? "tw-phone-error" : undefined}
                aria-label="10-digit mobile number"
                autoFocus
                maxLength={10}
              />

              {valid && (
                <span className="tw-phone-check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </label>
            <p className="mt-2 text-[11px] text-white/45 tracking-wide">
              We'll never share your number. SMS rates may apply.
            </p>
          </div>
          {error && <p id="tw-phone-error" className={`text-destructive text-xs mt-3 ${error ? "tw-shake" : ""}`}>{error}</p>}

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

          <div
            ref={otpRowRef}
            onClick={focusOtp}
            role="group"
            aria-label="6-digit OTP"
            className={`mt-12 flex gap-3 ${error ? "tw-shake" : ""}`}
          >
            {otp.map((v, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                inputMode="numeric"
                maxLength={1}
                value={v}
                disabled={busy}
                aria-invalid={!!error}
                aria-describedby={error ? "tw-otp-error" : undefined}
                onChange={(e) => onOtpChange(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Backspace" && !v && i > 0) inputs.current[i - 1]?.focus(); }}
                className="w-12 h-14 text-center text-2xl font-bold rounded-2xl glass focus:outline-none focus:ring-2 focus:ring-primary num-mono disabled:opacity-60"
              />
            ))}
          </div>
          {error && (
            <div id="tw-otp-error" className="mt-3 space-y-2" role="alert">
              <p className="text-destructive text-xs leading-relaxed">
                {errorKind === "invalid" ? "Re-enter the 6-digit code — that one didn't match." : error}
              </p>
              <div className="flex items-center gap-3">
                {!busy && (
                  <button
                    onClick={retryVerify}
                    className="text-primary text-xs font-semibold underline underline-offset-2"
                  >
                    Try again
                  </button>
                )}
                {errorId && <CopyableErrorId id={errorId} />}
              </div>
            </div>
          )}

          <div className="mt-7">
            <ResendCountdown
              resendIn={resendIn}
              cooldownTotalMs={cooldownTotalMs}
              blocked={resendBlocked}
              busy={busy}
              lockedOut={lockedOut}
              rateLimited={errorKind === "rate_limited"}
              resendCount={resendCount}
              maxResends={MAX_RESENDS_BEFORE_LOCK}
              onResend={handleSendOtp}
            />
          </div>

          <div className="flex-1" />
          {busy && <div className="text-center text-sm text-muted-foreground mb-4">Verifying...</div>}
        </>
      )}
    </div>
  );
}
