// Full-screen lock overlay. Mounted from __root.tsx. When `locked` is true, it
// blocks all interaction with the app behind it and prompts for PIN/biometric.
//
// SECURITY UX:
// - Backdrop is opaque (not just blurred) so screenshots / accessibility tree
//   don't leak the underlying screen.
// - Failed attempts come back from the server with a `seconds_remaining` value
//   that we use to drive a live countdown.
import { useEffect, useState } from "react";
import { Fingerprint, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callAppLock, getBiometricAssertion, useAppLock } from "@/lib/appLock";
import { PinPad } from "./PinPad";

export function AppLockGate() {
  const { locked, status, markUnlocked } = useAppLock();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownEnds, setCooldownEnds] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!cooldownEnds) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [cooldownEnds]);

  if (!locked || !status?.enabled) return null;

  const inCooldown = cooldownEnds !== null && cooldownEnds > now;
  const secondsLeft = inCooldown ? Math.ceil((cooldownEnds! - now) / 1000) : 0;

  const tryBiometric = async () => {
    if (busy || inCooldown) return;
    if (!status.biometric_credential_id) return;
    setBusy(true);
    setMessage(null);
    try {
      const credId = await getBiometricAssertion(status.biometric_credential_id);
      if (!credId) {
        setMessage("Biometric cancelled");
        return;
      }
      const { error } = await callAppLock({ action: "verify_biometric", credential_id: credId });
      if (error) {
        setMessage(error.message);
        setErrorKey((k) => k + 1);
        return;
      }
      markUnlocked();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-prompt biometric on first show, if enrolled
  useEffect(() => {
    if (status.biometric_enrolled && !busy && !inCooldown) {
      void tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPin = async (pin: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const { error } = await callAppLock<{ ok: true }>({ action: "verify_pin", pin });
    setBusy(false);
    if (!error) {
      markUnlocked();
      return;
    }
    const payload = error.payload as { locked_until?: string; attempts_until_cooldown?: number } | undefined;
    if (payload?.locked_until) {
      const ends = new Date(payload.locked_until).getTime();
      setCooldownEnds(ends);
      setMessage(`Too many attempts — try again in ${Math.ceil((ends - Date.now()) / 1000)}s`);
    } else if (typeof payload?.attempts_until_cooldown === "number") {
      setMessage(`Incorrect PIN — ${payload.attempts_until_cooldown} ${payload.attempts_until_cooldown === 1 ? "try" : "tries"} left`);
    } else {
      setMessage(error.message);
    }
    setErrorKey((k) => k + 1);
  };

  const signOut = async () => {
    await supabase.auth.signOut().catch(() => {});
    sessionStorage.removeItem("tw_app_unlocked");
    toast.success("Signed out");
  };

  // Clear cooldown when it expires
  useEffect(() => {
    if (cooldownEnds && now >= cooldownEnds) {
      setCooldownEnds(null);
      setMessage(null);
    }
  }, [now, cooldownEnds]);

  return (
    <div className="fixed inset-0 z-[200] bg-[#0a0e1a] text-white flex flex-col items-center justify-center px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_60%)]" />

      <div className="relative w-full max-w-sm flex flex-col items-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-emerald-300" strokeWidth={1.6} />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold">App Locked</h1>
          <p className="text-sm text-white/60 mt-1">
            {status.biometric_enrolled
              ? "Use fingerprint or enter your PIN to continue"
              : `Enter your ${status.pin_length ?? 6}-digit PIN`}
          </p>
        </div>

        <PinPad
          length={(status.pin_length === 4 ? 4 : 6)}
          onComplete={onPin}
          disabled={busy || inCooldown}
          errorKey={errorKey}
          extraButton={status.biometric_enrolled ? {
            label: "Biometric",
            onClick: tryBiometric,
            icon: <Fingerprint className="w-5 h-5" />,
          } : null}
        />

        <div className="min-h-[20px] text-center">
          {inCooldown ? (
            <p className="text-sm text-amber-300">Try again in {secondsLeft}s</p>
          ) : message ? (
            <p className="text-sm text-red-300">{message}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={signOut}
          className="text-xs text-white/50 hover:text-white/80 inline-flex items-center gap-1.5 mt-2"
        >
          <LogOut className="w-3.5 h-3.5" /> Forgot PIN? Sign out
        </button>
      </div>
    </div>
  );
}
