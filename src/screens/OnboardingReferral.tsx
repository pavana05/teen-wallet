/**
 * Optional onboarding step that asks the user if a friend invited them.
 *
 * Shown once per user (via shouldShowReferralPrompt) right after authentication
 * succeeds, before KYC. The user can:
 *   - Enter a friend's referral code → redeems server-side, credits both wallets
 *   - Tap "Skip for now" → flow continues, prompt is marked done so we don't nag
 *
 * The full Referral Program is also accessible later from the profile menu,
 * so skipping here doesn't lock the user out of the feature.
 */
import { useEffect, useState } from "react";
import { Gift, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { redeemReferralCode, markReferralPromptDone } from "@/lib/referral";
import { haptics } from "@/lib/haptics";

interface Props { onDone: () => void }

export function OnboardingReferral({ onDone }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-warm the chunks for the screens that follow this one (Permissions,
  // KycFlow). KycFlow is large and is the typical "after referral, app
  // stops loading" culprit on slow connections — by the time the user
  // taps Skip / Apply, those chunks are already in cache.
  useEffect(() => {
    void import("@/screens/Permissions").catch(() => {});
    void import("@/screens/KycFlow").catch(() => {});
  }, []);

  const finish = () => {
    markReferralPromptDone();
    onDone();
  };

  const skip = () => {
    void haptics.tap();
    finish();
  };

  const apply = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError("Enter at least 4 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await redeemReferralCode(trimmed);
      if (!res.ok) {
        setError(res.message || "Couldn't apply code");
        void haptics.tap();
        return;
      }
      void haptics.swipe();
      toast.success(`₹${res.reward.toFixed(0)} welcome bonus added`, {
        description: "You can refer your friends from your profile too.",
        icon: "🎉",
      });
      finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0B0B] text-white px-6 pt-10 pb-8">
      <div className="flex-1 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-fuchsia-500/30 to-amber-400/30 flex items-center justify-center mb-6 ring-1 ring-white/10">
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
            className="mt-2 w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-[16px] tracking-[0.18em] font-mono text-center placeholder:text-white/25 focus:outline-none focus:border-amber-300/60 focus:bg-white/[.07] transition"
            aria-invalid={error ? "true" : undefined}
          />
          {error && (
            <p className="mt-2 text-[12px] text-rose-300" role="alert">{error}</p>
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
          onClick={apply}
          disabled={busy || code.trim().length < 4}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-300 to-fuchsia-400 text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:from-white/15 disabled:to-white/15 disabled:text-white/40 transition active:scale-[.98]"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>Apply code <ArrowRight className="w-4 h-4" /></>
          )}
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
    </div>
  );
}
