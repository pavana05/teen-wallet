// App Lock settings panel — shown from inside ProfilePanel.
// Lets the user: change PIN, manage biometric, set auto-lock timing,
// toggle "lock after every payment", or disable App Lock entirely (PIN-protected).
import { useState } from "react";
import { ArrowLeft, Fingerprint, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import {
  callAppLock,
  enrollBiometric as runEnrollBiometric,
  isBiometricSupported,
  useAppLock,
} from "@/lib/appLock";
import { AppLockSetup } from "./AppLockSetup";
import { PinPad } from "./PinPad";

interface Props { onBack: () => void; }

const AUTO_LOCK_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Immediately" },
  { value: 30,  label: "After 30 seconds" },
  { value: 120, label: "After 2 minutes" },
  { value: 300, label: "After 5 minutes" },
  { value: -1,  label: "Only on cold start" },
];

export function AppLockSettings({ onBack }: Props) {
  const { userId, fullName } = useApp();
  const { status, refresh } = useAppLock();
  const [showSetup, setShowSetup] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [changePin, setChangePin] = useState<null | "current" | "new" | "confirm">(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);

  if (showSetup) {
    return <AppLockSetup onClose={() => { setShowSetup(false); void refresh(); }} />;
  }

  const enabled = !!status?.enabled;

  const updateSetting = async (patch: Record<string, unknown>, label: string) => {
    const { error } = await callAppLock({ action: "update_settings", ...patch });
    if (error) { toast.error(`Couldn't save ${label}`, { description: error.message }); return; }
    await refresh();
  };

  const enrollBiometric = async () => {
    if (!userId) return;
    try {
      const ok = await runEnrollBiometric();
      if (!ok) { toast.message("Biometric setup cancelled"); return; }
      await refresh();
      toast.success("Biometric enrolled");
    } catch (e) {
      toast.error("Couldn't enroll biometric", { description: (e as Error).message });
    }
  };

  const removeBiometric = async () => {
    const { error } = await callAppLock({ action: "remove_biometric" });
    if (error) { toast.error("Couldn't remove", { description: error.message }); return; }
    await refresh();
    toast.success("Biometric removed");
  };

  // ===== Disable flow =====
  const submitDisable = async (pin: string) => {
    setBusy(true);
    const { error } = await callAppLock({ action: "disable", pin });
    setBusy(false);
    if (error) {
      toast.error("Couldn't disable", { description: error.message });
      setErrorKey((k) => k + 1);
      return;
    }
    toast.success("App Lock disabled");
    setConfirmDisable(false);
    await refresh();
  };

  // ===== Change PIN flow =====
  const submitChangePin = async (current: string, next: string) => {
    setBusy(true);
    const { error } = await callAppLock({ action: "change_pin", current_pin: current, new_pin: next });
    setBusy(false);
    if (error) {
      toast.error("Couldn't change PIN", { description: error.message });
      setChangePin("current");
      setCurrentPin(""); setNewPin("");
      setErrorKey((k) => k + 1);
      return;
    }
    toast.success("PIN updated");
    setChangePin(null);
    setCurrentPin(""); setNewPin("");
    await refresh();
  };

  // ===== Sub-screens =====
  if (confirmDisable) {
    return (
      <div className="absolute inset-0 z-[155] bg-[#0a0e1a] text-white flex flex-col">
        <div className="flex items-center px-5 py-4">
          <button onClick={() => setConfirmDisable(false)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="ml-3 text-sm font-medium">Disable App Lock</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <p className="text-sm text-white/60 text-center max-w-xs">Enter your current PIN to turn off App Lock.</p>
          <PinPad
            length={(status?.pin_length === 4 ? 4 : 6)}
            onComplete={submitDisable}
            disabled={busy}
            errorKey={errorKey}
          />
        </div>
      </div>
    );
  }

  if (changePin) {
    const len = (status?.pin_length === 4 ? 4 : 6) as 4 | 6;
    return (
      <div className="absolute inset-0 z-[155] bg-[#0a0e1a] text-white flex flex-col">
        <div className="flex items-center px-5 py-4">
          <button onClick={() => { setChangePin(null); setCurrentPin(""); setNewPin(""); }} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <p className="ml-3 text-sm font-medium">Change PIN</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          {changePin === "current" && (
            <>
              <p className="text-sm text-white/60">Enter your current PIN</p>
              <PinPad length={len} onComplete={(p) => { setCurrentPin(p); setChangePin("new"); }} errorKey={errorKey} />
            </>
          )}
          {changePin === "new" && (
            <>
              <p className="text-sm text-white/60">Choose a new {len}-digit PIN</p>
              <PinPad length={len} onComplete={(p) => { setNewPin(p); setChangePin("confirm"); }} />
            </>
          )}
          {changePin === "confirm" && (
            <>
              <p className="text-sm text-white/60">Re-enter your new PIN</p>
              <PinPad length={len} onComplete={(p) => {
                if (p !== newPin) {
                  toast.error("PINs don't match");
                  setNewPin(""); setChangePin("new"); setErrorKey((k) => k + 1);
                  return;
                }
                void submitChangePin(currentPin, newPin);
              }} disabled={busy} />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[150] bg-background text-foreground flex flex-col overflow-hidden">
      <div className="flex items-center px-5 py-4 border-b border-white/10">
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <p className="ml-3 text-sm font-medium">App Lock & Security</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {!enabled ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-400/15 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <p className="font-medium">App Lock is off</p>
                <p className="text-xs text-white/55">Add a PIN to lock the wallet between sessions.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="w-full h-11 rounded-xl bg-white text-black text-sm font-medium"
            >Set up App Lock</button>
          </div>
        ) : (
          <>
            <div className="rounded-3xl border border-emerald-400/30 bg-emerald-400/5 p-4 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
              <p className="text-sm">App Lock is on</p>
            </div>

            <Section title="PIN">
              <Row icon={<Lock className="w-4 h-4" />} label="Change PIN" onClick={() => setChangePin("current")} />
            </Section>

            <Section title="Biometric">
              {isBiometricSupported() ? (
                status?.biometric_enrolled ? (
                  <Row icon={<Fingerprint className="w-4 h-4" />} label="Remove fingerprint / Face ID" onClick={removeBiometric} destructive />
                ) : (
                  <Row icon={<Fingerprint className="w-4 h-4" />} label="Enable fingerprint / Face ID" onClick={enrollBiometric} />
                )
              ) : (
                <p className="px-4 py-3 text-xs text-white/50">This device doesn't support biometric unlock.</p>
              )}
            </Section>

            <Section title="When to lock">
              <div className="rounded-2xl border border-white/10 overflow-hidden">
                {AUTO_LOCK_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateSetting({ auto_lock_seconds: opt.value }, "auto-lock")}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm text-left ${i > 0 ? "border-t border-white/10" : ""} ${status?.auto_lock_seconds === opt.value ? "bg-white/[0.06]" : ""}`}
                  >
                    <span>{opt.label}</span>
                    {status?.auto_lock_seconds === opt.value && <span className="text-emerald-300 text-xs">Selected</span>}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Extra security">
              <label className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 cursor-pointer">
                <div>
                  <p className="text-sm">Lock after every payment</p>
                  <p className="text-xs text-white/50 mt-0.5">Re-prompts PIN right after a transaction completes.</p>
                </div>
                <input
                  type="checkbox"
                  checked={!!status?.lock_after_payment}
                  onChange={(e) => updateSetting({ lock_after_payment: e.target.checked }, "preference")}
                  className="w-5 h-5 accent-emerald-400"
                />
              </label>
            </Section>

            <button
              type="button"
              onClick={() => setConfirmDisable(true)}
              className="w-full h-12 rounded-2xl border border-red-400/40 text-red-300 text-sm flex items-center justify-center gap-2"
            >
              <ShieldOff className="w-4 h-4" /> Disable App Lock
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-white/45 mb-2 px-1">{title}</p>
      {children}
    </div>
  );
}

function Row({ icon, label, onClick, destructive }: { icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/10 text-sm text-left ${destructive ? "text-red-300" : ""}`}
    >
      <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
