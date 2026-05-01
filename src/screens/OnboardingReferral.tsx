/**
 * Optional onboarding step that asks the user if a friend invited them.
 *
 * Shown once per user (via shouldShowReferralPrompt) right after authentication
 * succeeds, before KYC. Two-step flow:
 *   1) Enter code → client-side format validation → "Apply"
 *   2) Confirmation sheet showing the rewards that will be unlocked → "Confirm"
 *      → server-side redemption (RPC validates rules and returns mapped error)
 *
 * Skipping marks the prompt done so we don't nag again. The user can also
 * redeem later from the Referral Program screen in the profile menu.
 */
import { useMemo, useState } from "react";
import {
  Gift, Sparkles, ArrowRight, Loader2, AlertCircle, CheckCircle2, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { redeemReferralCode, markReferralPromptDone } from "@/lib/referral";
import { haptics } from "@/lib/haptics";

interface Props { onDone: () => void }

// Mirror server rules from `redeem_referral_code` so most errors are caught
// before we even hit the network.
const CODE_REGEX = /^[A-Z0-9]{4,16}$/;

/** Map raw server messages to friendlier, app-tone copy. */
function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("already used")) return "You've already redeemed a referral code.";
  if (m.includes("doesn't exist") || m.includes("does not exist") || m.includes("invalid")) {
    return "That code doesn't exist. Double-check with your friend.";
  }
  if (m.includes("own code")) return "You can't redeem your own code.";
  if (m.includes("not authenticated")) return "You need to sign in again to redeem.";
  if (m.includes("network") || m.includes("fetch")) return "Network error — please try again.";
  return raw || "Couldn't apply this code. Try again.";
}

type Step = "enter" | "confirm";

export function OnboardingReferral({ onDone }: Props) {
  const [step, setStep] = useState<Step>("enter");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = useMemo(() => code.trim().toUpperCase(), [code]);
  const isValidFormat = CODE_REGEX.test(trimmed);

  const finish = () => {
    markReferralPromptDone();
    onDone();
  };

  const skip = () => {
    void haptics.tap();
    finish();
  };

  /** Step 1 → Step 2: validate format locally, then show confirmation. */
  const proceedToConfirm = () => {
    if (trimmed.length === 0) {
      setError("Enter a referral code to continue.");
      void haptics.tap();
      return;
    }
    if (trimmed.length < 4) {
      setError("Codes are at least 4 characters.");
      void haptics.tap();
      return;
    }
    if (trimmed.length > 16) {
      setError("Codes are at most 16 characters.");
      void haptics.tap();
      return;
    }
    if (!CODE_REGEX.test(trimmed)) {
      setError("Codes only contain letters and numbers.");
      void haptics.tap();
      return;
    }
    setError(null);
    void haptics.tap();
    setStep("confirm");
  };

  /** Step 2: actually redeem on the server. */
  const confirmApply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await redeemReferralCode(trimmed);
      if (!res.ok) {
        setError(friendlyError(res.message));
        void haptics.tap();
        // Send the user back to the entry step so they can fix the code.
        setStep("enter");
        return;
      }
      void haptics.swipe();
      toast.success(`₹${res.reward.toFixed(0)} welcome bonus added`, {
        description: "You can refer your friends from your profile too.",
        icon: "🎉",
      });
      finish();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : ""));
      setStep("enter");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0B0B] text-white px-6 pt-10 pb-8">
      {step === "enter" ? (
        <>
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-300/25 to-amber-500/10 flex items-center justify-center mb-6 ring-1 ring-white/10">
              <Gift className="w-9 h-9 text-amber-300" strokeWidth={1.6} />
            </div>

            <h1 className="text-[26px] leading-tight font-bold mb-2">
              Got an invite?
            </h1>
            <p className="text-[14px] text-white/65 max-w-[280px] mb-8">
              Add a friend's referral code and we'll credit you a welcome bonus instantly. This step is optional.
            </p>

            <label className="w-full max-w-[320px] text-left">
              <span className="text-[11px] uppercase tracking-wider text-white/50 font-medium">
                Referral code
              </span>
              <input
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
                placeholder="e.g. AB23CD45"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                maxLength={16}
                className={`mt-2 w-full bg-white/5 border rounded-2xl px-4 py-3.5 text-[16px] tracking-[0.18em] font-mono text-center placeholder:text-white/25 focus:outline-none focus:bg-white/[.07] transition ${
                  error
                    ? "border-rose-400/70 focus:border-rose-400"
                    : "border-white/10 focus:border-amber-300/60"
                }`}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? "referral-error" : undefined}
              />
              {error && (
                <div
                  id="referral-error"
                  key={error}
                  role="alert"
                  className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-400/30 animate-[shake_280ms_cubic-bezier(.36,.07,.19,.97)_both]"
                  style={{ animationName: "hp-error-shake" }}
                >
                  <AlertCircle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-rose-200 leading-snug">{error}</p>
                </div>
              )}
            </label>

            <div className="mt-6 flex items-center gap-2 text-[12px] text-white/50">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Redeem once — bonus is credited immediately</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <button
              type="button"
              onClick={proceedToConfirm}
              disabled={busy || trimmed.length < 4 || !isValidFormat}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-200 to-amber-400 text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:from-white/15 disabled:to-white/15 disabled:text-white/40 transition active:scale-[.98]"
            >
              Review & apply <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={busy}
              className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-medium hover:bg-white/[.07] transition active:scale-[.98]"
            >
              Skip for now
            </button>
          </div>
        </>
      ) : (
        // ─── Confirmation step ───────────────────────────────────────────
        <>
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400/25 to-amber-300/10 flex items-center justify-center mb-6 ring-1 ring-white/10">
              <CheckCircle2 className="w-9 h-9 text-emerald-300" strokeWidth={1.6} />
            </div>

            <h1 className="text-[24px] leading-tight font-bold mb-2">
              Confirm your invite
            </h1>
            <p className="text-[14px] text-white/65 max-w-[300px] mb-6">
              Here's what happens when you apply this code.
            </p>

            <div className="w-full max-w-[320px] rounded-2xl bg-white/[.04] border border-white/10 p-4 mb-4">
              <p className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">
                Code
              </p>
              <p className="font-mono text-[22px] tracking-[0.22em] text-white">
                {trimmed}
              </p>
            </div>

            <div className="w-full max-w-[320px] space-y-2 text-left">
              <RewardRow
                tint="text-amber-300"
                title="₹50 welcome bonus"
                detail="Credited to your wallet instantly"
              />
              <RewardRow
                tint="text-fuchsia-300"
                title="₹25 to your friend"
                detail="They'll be notified you joined with their code"
              />
              <RewardRow
                tint="text-emerald-300"
                title="One-time use"
                detail="A code can only be redeemed once per account"
              />
            </div>

            <div className="mt-5 flex items-center gap-2 text-[11px] text-white/45">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified securely on our servers</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <button
              type="button"
              onClick={confirmApply}
              disabled={busy}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-200 to-amber-400 text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition active:scale-[.98]"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>Confirm & apply <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
            <button
              type="button"
              onClick={() => { void haptics.tap(); setStep("enter"); }}
              disabled={busy}
              className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-medium hover:bg-white/[.07] transition active:scale-[.98]"
            >
              Edit code
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RewardRow({
  tint, title, detail,
}: { tint: string; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white/[.03] border border-white/10 px-3.5 py-3">
      <span className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full ${tint.replace("text-", "bg-")}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-[13px] font-medium ${tint}`}>{title}</p>
        <p className="text-[11px] text-white/55 leading-snug mt-0.5">{detail}</p>
      </div>
    </div>
  );
}
