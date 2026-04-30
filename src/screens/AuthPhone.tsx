import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { sendOtp, verifyOtp, setStage as persistStage, fetchProfile } from "@/lib/auth";
import {
  isPhoneHintAvailable,
  requestPhoneHint,
  liveNormalizePhoneInput,
  classifyPhoneField,
} from "@/lib/phoneHint";
import { useApp, type Stage } from "@/lib/store";
import { toast } from "sonner";
import { PhoneVerified } from "./PhoneVerified";
import { VerifyGoogleOnNewDevice } from "./VerifyGoogleOnNewDevice";
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
import { maybeInsertWelcome } from "@/lib/notify";
import {
  getLoginRequirements,
  registerCurrentDeviceTrusted,
} from "@/lib/googleLink";

type Step = "phone" | "google-gate" | "otp" | "verified";

// Escalating cooldown ladder. Each successive resend within the same OTP attempt
// extends the wait so a user (or script) can't hammer the SMS provider. The last
// step is a hard 5-minute lockout treated as rate-limited.
const RESEND_LADDER_S = [30, 60, 120, 300];
const MAX_RESENDS_BEFORE_LOCK = RESEND_LADDER_S.length;
const cooldownForCount = (count: number) =>
  RESEND_LADDER_S[Math.min(count, RESEND_LADDER_S.length - 1)];

// Wrong-code attempt limiter. Independent from resend cooldown — protects
// the verify endpoint from brute-force guessing of the 6-digit code.
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_LOCK_MS = 5 * 60 * 1000; // 5-minute hard lock

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
  // Wrong-code attempts within the current OTP — locks verify after MAX_VERIFY_ATTEMPTS.
  const [verifyAttempts, setVerifyAttempts] = useState<number>(0);
  const [verifyLockedUntil, setVerifyLockedUntil] = useState<number | null>(null);
  const [verifyLockTick, setVerifyLockTick] = useState(0);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const otpRowRef = useRef<HTMLDivElement | null>(null);
  const [hintAvailable, setHintAvailable] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  // Google-gate state — populated when get_login_requirements says this phone
  // belongs to an account that has Google linked.
  const [googleEmailHint, setGoogleEmailHint] = useState<string | null>(null);
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
      setVerifyAttempts(persisted.verifyAttempts ?? 0);
      setVerifyLockedUntil(persisted.verifyLockedUntil ?? null);
      setStep("otp");
    }
  }, []);

  // 1s ticker to refresh the verify-lock countdown copy.
  useEffect(() => {
    if (!verifyLockedUntil || verifyLockedUntil <= Date.now()) return;
    const t = setInterval(() => setVerifyLockTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [verifyLockedUntil]);

  // Detect Android Contact-Picker support so we can offer one-tap pre-fill.
  useEffect(() => {
    let cancelled = false;
    void isPhoneHintAvailable().then((ok) => { if (!cancelled) setHintAvailable(ok); });
    return () => { cancelled = true; };
  }, []);

  async function handleUseMyNumber() {
    if (hintBusy) return;
    setHintBusy(true);
    try {
      const r = await requestPhoneHint();
      switch (r.kind) {
        case "ok":
          setPhone(r.phone);
          setError("");
          toast.success("Number filled — review and tap Send OTP");
          break;
        case "cancelled":
          // Silent — user backed out, no toast needed.
          break;
        case "permission":
          toast.error("Permission needed", {
            description: "Enable contacts permission in browser settings, or type your number manually.",
          });
          break;
        case "no_match":
          toast("That contact has no Indian mobile", {
            description: "Pick a contact with a 10-digit number starting 6–9, or type yours below.",
            action: { label: "Try again", onClick: () => void handleUseMyNumber() },
          });
          break;
        case "unsupported":
          toast("One-tap not supported here", {
            description: "Type your 10-digit mobile below — we'll send the OTP.",
          });
          setHintAvailable(false);
          break;
        case "error":
          toast.error("Couldn't open the picker", {
            description: r.detail || "Try again, or type your number manually.",
            action: { label: "Retry", onClick: () => void handleUseMyNumber() },
          });
          break;
      }
    } finally {
      setHintBusy(false);
    }
  }

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
      verifyAttempts, verifyLockedUntil,
    });
  }, [step, phone, otp, error, errorKind, errorId, busy, resendBlockedUntil, resendCount, cooldownTotalMs, verifyAttempts, verifyLockedUntil]);

  // Auto-focus first empty OTP slot when entering the OTP step.
  useEffect(() => {
    if (step !== "otp") return;
    const idx = otp.findIndex((d) => !d);
    inputs.current[idx === -1 ? 5 : idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const phoneState = classifyPhoneField(phone);
  const valid = phoneState === "valid";
  // Live, friendly hint message for the field — only shown when there's something to say.
  const phoneHint =
    phoneState === "bad_prefix"
      ? "Indian mobiles start with 6, 7, 8 or 9."
      : phoneState === "incomplete" && phone.length > 0
        ? `${10 - phone.length} more digit${10 - phone.length === 1 ? "" : "s"} to go`
        : "";
  const formatted = phone.replace(/(\d{5})(\d{0,5})/, (_, a, b) => (b ? `${a} ${b}` : a));
  const resendBlocked = resendIn > 0 || (resendBlockedUntil !== null && resendBlockedUntil > Date.now());
  const lockedOut = resendCount >= MAX_RESENDS_BEFORE_LOCK && resendBlocked;
  // Verify-side lockout: derived live so the UI auto-unlocks when the timer expires.
  // `verifyLockTick` participates in the dep so the derived value re-evaluates each second.
  void verifyLockTick;
  const verifyLocked = verifyLockedUntil !== null && verifyLockedUntil > Date.now();
  const verifyLockSeconds = verifyLocked ? Math.ceil((verifyLockedUntil! - Date.now()) / 1000) : 0;
  const verifyAttemptsLeft = Math.max(0, MAX_VERIFY_ATTEMPTS - verifyAttempts);


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
      // New-device gate: BEFORE sending OTP, check whether this phone is
      // bound to a Google account. If so, the user must complete Google
      // verification on this device first. Skipped on resend (we already
      // passed the gate when we entered the OTP step).
      if (step === "phone") {
        try {
          const req = await getLoginRequirements(phone);
          if (req.requires_google) {
            setGoogleEmailHint(req.google_email_hint);
            setStep("google-gate");
            return;
          }
        } catch (gateErr) {
          // Don't block signup if the lookup itself fails — just log it.
          console.warn("[auth] login requirements lookup failed", gateErr);
        }
      }
      const r = await sendOtp(phone);
      setPendingPhone("+91" + phone);
      toast.success(`OTP sent — dev code: ${r.devOtp}`);
      // First send keeps the base cooldown; subsequent sends escalate.
      startCooldown(step === "otp");
      // A fresh OTP resets the verify-attempt counter (new code, new chances).
      setVerifyAttempts(0);
      setVerifyLockedUntil(null);
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
    // Hard client-side block when the user has burned through their attempts.
    if (verifyLockedUntil !== null && verifyLockedUntil > Date.now()) {
      const secs = Math.ceil((verifyLockedUntil - Date.now()) / 1000);
      setError(`Too many wrong codes. Try again in ${Math.ceil(secs / 60)} min.`);
      setErrorKind("rate_limited");
      return;
    }
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
      // For returning users that already have Google linked, this device just
      // proved itself (Google match was verified pre-OTP, OR the device was
      // already trusted). Mark it trusted so we don't re-prompt next time.
      // Best-effort: failures shouldn't block sign-in.
      void registerCurrentDeviceTrusted().catch((err) => {
        console.warn("[auth] register_trusted_device failed", err);
      });
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

      // Count "invalid" (wrong code) attempts and lock after MAX_VERIFY_ATTEMPTS.
      // Network errors don't count — the user never actually got an answer.
      if (kind === "invalid" || kind === "expired" || kind === "unknown") {
        const next = verifyAttempts + 1;
        setVerifyAttempts(next);
        if (next >= MAX_VERIFY_ATTEMPTS) {
          const lockUntil = Date.now() + VERIFY_LOCK_MS;
          setVerifyLockedUntil(lockUntil);
          setErrorKind("rate_limited");
          setError(`Too many wrong codes. Try again in ${Math.ceil(VERIFY_LOCK_MS / 60_000)} min, or resend a new OTP.`);
        } else if (kind === "invalid") {
          // Make the remaining-attempts count visible without overwriting the toast.
          const left = MAX_VERIFY_ATTEMPTS - next;
          setError(`Re-enter the 6-digit code — ${left} attempt${left === 1 ? "" : "s"} left.`);
        }
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
    // Don't even let typing happen while locked — keeps the row stable.
    if (verifyLocked) return;
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

  if (step === "google-gate") {
    return (
      <VerifyGoogleOnNewDevice
        phone10={phone}
        emailHint={googleEmailHint}
        onBack={() => {
          setStep("phone");
          setGoogleEmailHint(null);
        }}
        onVerified={() => {
          // Google identity matched the linked account — now actually send
          // the OTP. Reset to phone step internally and re-trigger.
          setStep("phone");
          setGoogleEmailHint(null);
          // Defer one tick so React re-renders the phone step before we send.
          setTimeout(() => { void handleSendOtp(); }, 0);
        }}
      />
    );
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
                onChange={(e) => {
                  setError("");
                  // Live normalization: strips +91, leading 0, spaces, dashes, parens
                  // so pasting "+91 98765 43210" or "098765 43210" Just Works.
                  setPhone(liveNormalizePhoneInput(e.target.value));
                }}
                onPaste={(e) => {
                  // Force-normalize pasted strings even when they include "+" / spaces
                  // that the inputMode=numeric keyboard wouldn't allow.
                  const text = e.clipboardData?.getData("text") ?? "";
                  if (!text) return;
                  e.preventDefault();
                  setError("");
                  setPhone(liveNormalizePhoneInput(text));
                }}
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
            {phoneHint ? (
              <p
                className={`mt-2 text-[11px] tracking-wide ${
                  phoneState === "bad_prefix" ? "text-destructive" : "text-white/55"
                }`}
                aria-live="polite"
              >
                {phoneHint}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-white/45 tracking-wide">
                We'll never share your number. SMS rates may apply.
              </p>
            )}

            {hintAvailable && (
              <button
                type="button"
                onClick={handleUseMyNumber}
                disabled={hintBusy}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] font-medium text-white/85 transition hover:bg-white/[0.07] hover:border-white/20 disabled:opacity-60"
                aria-label="Pre-fill my phone number from contacts"
              >
                <Sparkles className="w-4 h-4 text-[#E8D9B5]" />
                {hintBusy ? "Opening picker…" : "Use my number"}
              </button>
            )}
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

          {verifyLocked && (
            <div
              className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3"
              role="alert"
            >
              <p className="text-[12.5px] font-semibold text-destructive">
                Verification paused for {Math.floor(verifyLockSeconds / 60)}:{String(verifyLockSeconds % 60).padStart(2, "0")}
              </p>
              <p className="text-[11.5px] text-destructive/85 mt-1 leading-relaxed">
                Too many wrong codes on this OTP. Wait it out, or tap <span className="font-semibold">Resend</span> below to get a fresh code (resets your attempts).
              </p>
            </div>
          )}

          {!verifyLocked && verifyAttempts > 0 && verifyAttemptsLeft > 0 && (
            <p className="mt-4 text-[11.5px] text-amber-300/85" aria-live="polite">
              {verifyAttemptsLeft} attempt{verifyAttemptsLeft === 1 ? "" : "s"} left before this OTP locks.
            </p>
          )}

          <div
            ref={otpRowRef}
            onClick={focusOtp}
            role="group"
            aria-label="6-digit OTP"
            className={`mt-8 flex gap-3 ${error ? "tw-shake" : ""} ${verifyLocked ? "opacity-60 pointer-events-none" : ""}`}
            aria-disabled={verifyLocked}
          >
            {otp.map((v, i) => (
              <input
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                inputMode="numeric"
                maxLength={1}
                value={v}
                disabled={busy || verifyLocked}
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
