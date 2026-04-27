// PIN setup flow: choose length → enter → confirm → optional biometric enroll.
import { useState } from "react";
import { ArrowLeft, Fingerprint, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { callAppLock, enrollBiometric as runEnrollBiometric, isBiometricSupported, useAppLock } from "@/lib/appLock";
import { PinPad } from "./PinPad";

interface Props {
  onClose: () => void;
}

type Step = "choose-length" | "enter" | "confirm" | "biometric" | "done";

export function AppLockSetup({ onClose }: Props) {
  const { userId, fullName } = useApp();
  const refresh = useAppLock((s) => s.refresh);
  const markUnlocked = useAppLock((s) => s.markUnlocked);

  const [step, setStep] = useState<Step>("choose-length");
  const [length, setLength] = useState<4 | 6>(6);
  const [first, setFirst] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const submitPin = async (pin: string) => {
    setBusy(true);
    const { error } = await callAppLock({ action: "set_pin", pin });
    setBusy(false);
    if (error) {
      toast.error("Couldn't set PIN", { description: error.message });
      setStep("enter");
      setFirst("");
      setErrorKey((k) => k + 1);
      return;
    }
    await refresh();
    markUnlocked(); // they just authenticated
    if (isBiometricSupported()) setStep("biometric");
    else setStep("done");
  };

  const enrollBiometric = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const ok = await runEnrollBiometric();
      if (!ok) { toast.message("Biometric setup cancelled"); setStep("done"); return; }
      await refresh();
      toast.success("Biometric enrolled");
      setStep("done");
    } catch (e) {
      toast.error("Biometric setup failed", { description: (e as Error).message });
      setStep("done");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] text-white flex flex-col overflow-hidden">
      {/* Premium emerald + gold ambient backdrop */}
      <div className="absolute inset-0 -z-10 bg-[#05100c]" />
      <div
        className="absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, rgba(201,162,74,0.18) 0%, rgba(201,162,74,0) 55%), radial-gradient(90% 70% at 50% 110%, rgba(16,80,58,0.55) 0%, rgba(5,16,12,0) 60%), linear-gradient(180deg, #06120e 0%, #04100c 100%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-[0.06] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <button
          type="button"
          onClick={() => {
            if (step === "enter") setStep("choose-length");
            else if (step === "confirm") { setStep("enter"); setFirst(""); }
            else onClose();
          }}
          className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md flex items-center justify-center hover:bg-white/10 transition active:scale-95"
          aria-label="Back"
        >
          {step === "choose-length" || step === "done" ? <X className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
        </button>
        <p className="text-[11px] tracking-[0.22em] uppercase text-[#c9a24a]/80 font-medium">App Lock</p>
        <span className="w-10" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-start pt-4 px-6 pb-8 overflow-y-auto">
        {step === "choose-length" && (
          <div className="w-full max-w-sm flex flex-col items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-400/15 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-emerald-300" strokeWidth={1.6} />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold">Choose PIN length</h2>
              <p className="text-sm text-white/60 mt-1">A longer PIN is more secure.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              {[4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setLength(n as 4 | 6); setStep("enter"); }}
                  className={`h-20 rounded-2xl border text-left px-4 ${length === n ? "border-emerald-400/60 bg-emerald-400/10" : "border-white/15 bg-white/5"}`}
                >
                  <p className="text-2xl font-semibold">{n} digits</p>
                  <p className="text-[11px] text-white/50 mt-1">{n === 4 ? "Quick" : "Recommended"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "enter" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold">Set your {length}-digit PIN</h2>
              <p className="text-sm text-white/60 mt-1">You'll use this every time the app locks.</p>
            </div>
            <PinPad
              length={length}
              onComplete={(p) => { setFirst(p); setStep("confirm"); }}
              disabled={busy}
            />
          </div>
        )}

        {step === "confirm" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold">Confirm your PIN</h2>
              <p className="text-sm text-white/60 mt-1">Re-enter the same PIN.</p>
            </div>
            <PinPad
              length={length}
              onComplete={(p) => {
                if (p !== first) {
                  toast.error("PINs don't match", { description: "Let's start over." });
                  setFirst(""); setStep("enter"); setErrorKey((k) => k + 1);
                  return;
                }
                void submitPin(p);
              }}
              disabled={busy}
              errorKey={errorKey}
            />
          </div>
        )}

        {step === "biometric" && (
          <div className="flex flex-col items-center gap-6 max-w-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-400/15 flex items-center justify-center">
              <Fingerprint className="w-7 h-7 text-indigo-300" strokeWidth={1.6} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Add fingerprint or Face ID?</h2>
              <p className="text-sm text-white/60 mt-1">Unlock faster — your PIN still works as a backup.</p>
            </div>
            <div className="flex flex-col gap-3 w-full">
              <button
                type="button"
                onClick={enrollBiometric}
                disabled={busy}
                className="h-12 rounded-2xl bg-white text-black font-medium disabled:opacity-50"
              >{busy ? "Enrolling…" : "Use biometric"}</button>
              <button
                type="button"
                onClick={() => setStep("done")}
                className="h-12 rounded-2xl bg-white/10 text-white font-medium"
              >Skip for now</button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-6 max-w-sm text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-400/15 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-300" strokeWidth={1.6} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">App Lock is on</h2>
              <p className="text-sm text-white/60 mt-1">Your wallet will lock when you switch away or reopen the app.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-12 px-8 rounded-2xl bg-white text-black font-medium"
            >Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
