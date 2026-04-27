// Full-screen lock overlay. Mounted from __root.tsx. When `locked` is true, it
// blocks all interaction with the app behind it and prompts for PIN/biometric.
import { useEffect, useState } from "react";
import { Fingerprint, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callAppLock, useAppLock, verifyBiometricUnlock } from "@/lib/appLock";
import { PinPad } from "./PinPad";

export function AppLockGate() {
  const { locked, status, markUnlocked } = useAppLock();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownEnds, setCooldownEnds] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const visible = locked && !!status?.enabled;
  const inCooldown = cooldownEnds !== null && cooldownEnds > now;
  const secondsLeft = inCooldown ? Math.ceil((cooldownEnds! - now) / 1000) : 0;

  useEffect(() => {
    if (!cooldownEnds) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [cooldownEnds]);

  // Auto-prompt biometric on first show, if enrolled
  useEffect(() => {
    if (!visible) return;
    if (status?.biometric_enrolled && !busy && !inCooldown) {
      void tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Clear cooldown when it expires
  useEffect(() => {
    if (cooldownEnds && now >= cooldownEnds) {
      setCooldownEnds(null);
      setMessage(null);
    }
  }, [now, cooldownEnds]);

  const tryBiometric = async () => {
    if (busy || inCooldown) return;
    if (!status?.biometric_credential_id) return;
    setBusy(true);
    setMessage(null);
    try {
      const ok = await verifyBiometricUnlock();
      if (!ok) { setMessage("Biometric cancelled"); return; }
      markUnlocked();
    } catch (e) {
      setMessage((e as Error).message);
      setErrorKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

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

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] text-white flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* Premium emerald + gold ambient backdrop */}
      <div className="absolute inset-0 bg-[#05100c]" />
      <div
        className="absolute inset-0 opacity-95"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, rgba(201,162,74,0.20) 0%, rgba(201,162,74,0) 55%), radial-gradient(90% 70% at 50% 110%, rgba(16,80,58,0.55) 0%, rgba(5,16,12,0) 60%), linear-gradient(180deg, #06120e 0%, #04100c 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      {/* Soft animated halo */}
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(201,162,74,0.18) 0%, rgba(201,162,74,0) 70%)",
          animation: "applock-halo 14s ease-in-out infinite",
        }}
      />

      <div className="relative w-full max-w-sm flex flex-col items-center gap-7">
        <div className="w-[72px] h-[72px] rounded-2xl bg-gradient-to-br from-emerald-300/20 to-emerald-700/5 border border-emerald-300/20 flex items-center justify-center shadow-[0_10px_36px_-10px_rgba(16,185,129,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
          <ShieldCheck className="w-9 h-9 text-emerald-200" strokeWidth={1.4} />
        </div>
        <div className="text-center">
          <p className="text-[10px] tracking-[0.32em] uppercase text-[#c9a24a]/80 font-medium mb-2">Secure</p>
          <h1 className="text-3xl font-serif tracking-tight">App Locked</h1>
          <p className="text-sm text-white/55 mt-2">
            {status.biometric_enrolled
              ? "Use biometric or enter your PIN to continue"
              : `Enter your ${status.pin_length ?? 6}-digit PIN`}
          </p>
          <div
            className="mx-auto mt-3 h-px w-16"
            style={{ background: "linear-gradient(90deg, transparent, rgba(201,162,74,0.6), transparent)" }}
          />
        </div>

        <PinPad
          length={(status.pin_length === 4 ? 4 : 6)}
          onComplete={onPin}
          disabled={busy || inCooldown}
          errorKey={errorKey}
          extraButton={status.biometric_enrolled ? {
            label: "Biometric",
            onClick: tryBiometric,
            icon: <Fingerprint className="w-5 h-5 text-[#f0d98a]" />,
          } : null}
        />

        <div className="min-h-[22px] text-center">
          {inCooldown ? (
            <p className="text-sm text-amber-300/90">Try again in {secondsLeft}s</p>
          ) : message ? (
            <p className="text-sm text-red-300/90">{message}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={signOut}
          className="text-[11px] tracking-[0.18em] uppercase text-white/45 hover:text-[#f0d98a] inline-flex items-center gap-1.5 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Forgot PIN? Sign out
        </button>
      </div>

      <style>{`
        @keyframes applock-halo {
          0%, 100% { transform: translate(-50%, 0) scale(1); opacity: 0.9; }
          50% { transform: translate(-50%, 12px) scale(1.06); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .applock-halo { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
