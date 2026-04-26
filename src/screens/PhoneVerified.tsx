import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { playSuccessCue, prefersReducedMotion, readSoundPrefs, setSoundPrefs } from "@/lib/successCue";
import { markJustVerified, clearJustVerified, resolveStageFromProfile } from "@/lib/justVerified";
import { fetchProfile, sendOtp, setStage as persistStage } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { toast } from "sonner";

interface PhoneVerifiedProps {
  /**
   * Called once the user is ready to leave this screen. The caller is
   * responsible for routing — we just hand back the freshly-resolved stage
   * so the parent can route to the right place.
   */
  onContinue: (resolvedStage?: Stage) => void;
}

export function PhoneVerified({ onContinue }: PhoneVerifiedProps) {
  // Honor the OS reduced-motion setting reactively. Reduced motion swaps the
  // particle / ripple / streak animation for a single static success badge.
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    // Safari < 14 uses addListener
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  // Sound + haptic toggle, mirrored to the same ProfilePanel pref so a change
  // here is visible in Settings and vice-versa.
  const [soundsOn, setSoundsOn] = useState<boolean>(() => readSoundPrefs().sounds);
  const toggleSounds = () => {
    const next = !soundsOn;
    setSoundsOn(next);
    setSoundPrefs({ sounds: next });
  };

  // Fire success cue + persist the just-verified flag exactly once on mount.
  // The flag survives a refresh for a few seconds so users don't get bumped
  // back into the OTP UI mid-celebration.
  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    markJustVerified();
    playSuccessCue();
    return () => {
      // We deliberately don't clear the flag on unmount — Continue clears it
      // explicitly so a fast refresh during the animation still re-lands here.
    };
  }, []);

  // Visual-only success cue that plays regardless of sound settings — a
  // single, accessible "tick" pulse that meets the brief without needing
  // animations beyond a tiny opacity/transform that reduced-motion users
  // won't be bothered by (it stops after one cycle).
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPulse(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Particles only when motion is allowed — generated once.
  const particles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({
      left: `${5 + Math.random() * 90}%`,
      delay: `${Math.random() * 4}s`,
      duration: `${3.5 + Math.random() * 2.5}s`,
      size: 2 + Math.random() * 3,
      key: i,
    })),
    []
  );
  const sparks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({
      left: `${30 + Math.random() * 40}%`,
      top: `${20 + Math.random() * 50}%`,
      delay: `${0.8 + Math.random() * 1.8}s`,
      key: i,
    })),
    []
  );

  // ---- Continue: refresh stage from backend before routing -------------
  const [continuing, setContinuing] = useState(false);
  const handleContinue = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      // Always hit the backend so a stage update from elsewhere (admin
      // approving KYC while we celebrated, e.g.) is honored on the way out.
      const p = await fetchProfile();
      const resolved = resolveStageFromProfile(
        p ? { onboarding_stage: p.onboarding_stage, kyc_status: p.kyc_status } : null
      );
      // If the backend disagrees with what we'd show, write the resolved
      // stage so a subsequent reopen lands on the same screen.
      if (p && p.onboarding_stage !== resolved) {
        try { await persistStage(resolved); } catch { /* non-fatal */ }
      }
      useApp.getState().setStageLocal(resolved);
      clearJustVerified();
      onContinue(resolved);
    } catch (err) {
      // Even if profile fetch fails, let the user proceed — the parent
      // router will fall back to its current stage.
      clearJustVerified();
      onContinue();
    } finally {
      setContinuing(false);
    }
  };

  // ---- Fallback: session expired? Resend OTP without losing stage ------
  const { pendingPhone } = useApp();
  const [resending, setResending] = useState(false);
  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    try {
      // Detect "OTP succeeded but session is gone" — rare but recoverable.
      const { data: u } = await supabase.auth.getUser();
      const phone10 = (pendingPhone || "").replace(/^\+91/, "").replace(/\D/g, "");
      if (!phone10 || phone10.length !== 10) {
        toast.error("We've lost your number from this session", {
          description: "Please go back and re-enter your mobile number to continue.",
        });
        return;
      }
      await sendOtp(phone10);
      toast.success("OTP resent", {
        description: u.user
          ? "Just in case — your session is still active. Tap Continue when ready."
          : "Your session expired. Enter the new code on the previous screen to recover.",
      });
    } catch (err) {
      toast.error("Couldn't resend OTP", {
        description: err instanceof Error ? err.message : "Please try again in a moment.",
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className={`pv-root ${reducedMotion ? "pv-reduced-motion" : ""}`}>
      <div className="pv-spotlight" aria-hidden="true" />

      {/* Floating particles — visual only, suppressed under reduced-motion */}
      {!reducedMotion && (
        <div className="pv-particles" aria-hidden="true">
          {particles.map((p) => (
            <span
              key={p.key}
              className="pv-particle"
              style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration, width: p.size, height: p.size }}
            />
          ))}
          {sparks.map((s) => (
            <span key={`s${s.key}`} className="pv-spark" style={{ left: s.left, top: s.top, animationDelay: s.delay }} />
          ))}
        </div>
      )}

      {/* Header brand + sound toggle */}
      <div className="relative z-10 pt-8 px-6 flex items-center justify-between">
        <span className="text-[11px] tracking-[0.35em] text-white/60 font-light">TEEN WALLET</span>
        <button
          type="button"
          onClick={toggleSounds}
          className="w-9 h-9 rounded-full glass flex items-center justify-center text-white/70 hover:text-white transition-colors"
          aria-pressed={soundsOn}
          aria-label={soundsOn ? "Mute success sounds and haptics" : "Unmute success sounds and haptics"}
          title={soundsOn ? "Sounds & haptics on" : "Sounds & haptics off"}
        >
          {soundsOn
            ? <Volume2 className="w-4 h-4" strokeWidth={2.2} />
            : <VolumeX className="w-4 h-4" strokeWidth={2.2} />}
        </button>
      </div>

      {/* Hero */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <div className={`pv-badge-wrap ${pulse ? "pv-badge-wrap-pulse" : ""}`}>
          {!reducedMotion && (
            <>
              <div className="pv-ripple" aria-hidden="true" />
              <div className="pv-ring" aria-hidden="true" />
              <div className="pv-ring delay" aria-hidden="true" />
            </>
          )}
          <div className="pv-badge" role="img" aria-label="Phone number verified">
            {!reducedMotion && <div className="pv-streak" aria-hidden="true" />}
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <path
                d="M16 33 L28 45 L48 22"
                stroke="white"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <h1 className="pv-title mt-10">Phone number verified</h1>
        <p className="pv-sub">Your account is ready to go</p>
      </div>

      {/* CTA + recovery link */}
      <div className="relative z-10 px-6 pb-10 flex flex-col items-center gap-3">
        <button
          onClick={handleContinue}
          className="pv-btn"
          disabled={continuing}
          aria-busy={continuing}
        >
          {!reducedMotion && <span className="pv-btn-shine" aria-hidden="true" />}
          {continuing
            ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Continuing…</span>
            : "Continue"}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="text-[12px] text-white/55 hover:text-white/85 underline underline-offset-2 disabled:opacity-50"
        >
          {resending ? "Sending a fresh code…" : "Session expired? Resend OTP"}
        </button>
      </div>
    </div>
  );
}
