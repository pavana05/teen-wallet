// One-time bottom sheet shown after login if App Lock isn't set up yet.
// Dismissed forever via the dismiss_app_lock_prompt() Postgres function.
import { useEffect, useState } from "react";
import { ScanFace } from "lucide-react";
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

  // Lock background scroll while open + close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void dismiss(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    <div
      className="absolute inset-0 z-[140] flex items-center justify-center px-5 bio-prompt-backdrop"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="al-prompt-title"
      aria-describedby="al-prompt-desc"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bio-prompt-card w-full max-w-[360px]"
      >
        {/* Soft ambient glow underneath the card */}
        <span className="bio-prompt-glow" aria-hidden />

        {/* Biometric icon */}
        <div className="bio-prompt-icon-wrap">
          <span className="bio-prompt-icon-pulse" aria-hidden />
          <span className="bio-prompt-icon-pulse bio-prompt-icon-pulse-2" aria-hidden />
          <div className="bio-prompt-icon" aria-hidden>
            <ScanFace className="w-12 h-12" strokeWidth={1.6} />
          </div>
        </div>

        <h2 id="al-prompt-title" className="bio-prompt-title">
          Enable biometric lock
        </h2>
        <p id="al-prompt-desc" className="bio-prompt-desc">
          Unlock your wallet instantly with Face ID or fingerprint — and keep
          your money safe even if someone gets your phone.
        </p>

        <div className="bio-prompt-actions">
          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className="bio-prompt-cta"
            autoFocus
          >
            <span>Enable biometric</span>
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="bio-prompt-skip"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
