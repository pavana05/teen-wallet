// One-time bottom sheet shown after login if App Lock isn't set up yet.
// Dismissed forever via the dismiss_app_lock_prompt() Postgres function.
import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppLock } from "@/lib/appLock";
import { AppLockSetup } from "./AppLockSetup";

export function AppLockSetupPrompt() {
  const { ready, status, refresh } = useAppLock();
  const [open, setOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!status) return; // not signed in
    if (status.enabled) return;
    if (status.setup_prompt_dismissed) return;
    // Show after a short delay so we don't appear during initial load animations
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [ready, status]);

  const dismiss = async () => {
    setOpen(false);
    await supabase.rpc("dismiss_app_lock_prompt");
    await refresh();
  };

  if (showSetup) {
    return <AppLockSetup onClose={async () => { setShowSetup(false); setOpen(false); await refresh(); }} />;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={dismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#0e1424] text-white rounded-t-3xl sm:rounded-3xl border border-white/10 p-6 pb-8"
      >
        <div className="flex items-start justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-400/15 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-emerald-300" strokeWidth={1.6} />
          </div>
          <button onClick={dismiss} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <h2 className="text-lg font-semibold">Lock your wallet with a PIN</h2>
        <p className="text-sm text-white/60 mt-1.5 leading-relaxed">
          Add a quick PIN (and fingerprint) so no one can open your wallet — even if they get your phone after you've used GPay or PhonePe.
        </p>

        <div className="flex flex-col gap-2.5 mt-5">
          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className="h-12 rounded-2xl bg-white text-black font-medium"
          >Set up App Lock</button>
          <button
            type="button"
            onClick={dismiss}
            className="h-12 rounded-2xl bg-white/5 text-white/70 text-sm"
          >Not now</button>
        </div>
      </div>
    </div>
  );
}
