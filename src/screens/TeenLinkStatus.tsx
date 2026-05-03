import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Shield, CheckCircle2, Loader2, Link2, Sparkles, WifiOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { useApp } from "@/lib/store";

interface Props {
  onBack: () => void;
  onLinked: () => void;
}

type Phase = "polling" | "shimmer" | "celebrating" | "error";

const BASE_INTERVAL = 3000;
const MAX_INTERVAL = 30000;
const BACKOFF_FACTOR = 1.4;

export function TeenLinkStatus({ onBack, onLinked }: Props) {
  const userId = useApp((s) => s.userId);
  const [phase, setPhase] = useState<Phase>("polling");
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef(BASE_INTERVAL);
  const attemptRef = useRef(0);
  const acceptedRef = useRef(false);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkLink = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { data, error } = await supabase
      .from("family_links")
      .select("id, status")
      .eq("teen_user_id", userId)
      .eq("status", "active")
      .limit(1);

    if (error) throw error;
    return !!(data && data.length > 0);
  }, [userId]);

  const handleAccepted = useCallback(() => {
    if (acceptedRef.current) return;
    acceptedRef.current = true;
    clearPoll();
    haptics.press();

    // Shimmer transition before celebration
    setPhase("shimmer");

    // Update profile — use userId from store directly
    if (userId) {
      supabase
        .from("profiles")
        .update({ family_link_status: "accepted" as any })
        .eq("id", userId)
        .then(() => {});
    }

    setTimeout(() => {
      setPhase("celebrating");
    }, 800);

    setTimeout(() => {
      onLinked();
    }, 4300);
  }, [clearPoll, userId, onLinked]);

  const startPolling = useCallback(() => {
    setPhase("polling");
    setErrorMsg("");
    intervalRef.current = BASE_INTERVAL;
    attemptRef.current = 0;

    const poll = async () => {
      if (acceptedRef.current) return;
      try {
        const linked = await checkLink();
        if (linked) {
          handleAccepted();
          return;
        }
        // Exponential backoff
        attemptRef.current += 1;
        if (attemptRef.current > 3) {
          intervalRef.current = Math.min(
            intervalRef.current * BACKOFF_FACTOR,
            MAX_INTERVAL
          );
        }
        setPhase("polling");
        pollRef.current = setTimeout(poll, intervalRef.current);
      } catch (err: any) {
        clearPoll();
        setErrorMsg(err?.message || "Network error — check your connection");
        setPhase("error");
      }
    };

    poll();
  }, [checkLink, handleAccepted, clearPoll]);

  useEffect(() => {
    startPolling();
    return clearPoll;
  }, [startPolling, clearPoll]);

  const handleRetry = () => {
    haptics.tap();
    startPolling();
  };

  return (
    <div className="flex-1 flex flex-col tls-root overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tls-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tls-heading">Family Link Status</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Polling / Waiting */}
        {phase === "polling" && (
          <div className="tls-waiting-container tls-fade-in">
            <div className="tls-ring-outer">
              <div className="tls-ring-inner">
                <Shield className="w-12 h-12" style={{ color: "oklch(0.82 0.06 85)" }} />
              </div>
            </div>

            <div className="tls-pulse-ring" />

            <h2 className="text-xl font-bold tls-heading mt-8">Waiting for Parent</h2>
            <p className="text-sm tls-sub mt-2 text-center max-w-[280px]">
              Your parent needs to accept the family link invitation. This page will update automatically.
            </p>

            <div className="tls-status-pill mt-6">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "oklch(0.82 0.06 85)" }} />
              <span className="text-[13px] tls-sub">Checking every few seconds…</span>
            </div>

            <button onClick={() => { haptics.tap(); onBack(); }} className="tls-link-btn mt-8">
              <Link2 className="w-4 h-4" /> Enter code manually
            </button>
          </div>
        )}

        {/* Error state */}
        {phase === "error" && (
          <div className="tls-waiting-container tls-fade-in">
            <div className="tls-ring-outer tls-ring-error">
              <div className="tls-ring-inner tls-ring-error-inner">
                <WifiOff className="w-10 h-10" style={{ color: "oklch(0.65 0.08 30)" }} />
              </div>
            </div>

            <h2 className="text-xl font-bold tls-heading mt-8">Connection Issue</h2>
            <p className="text-sm tls-sub mt-2 text-center max-w-[280px]">
              {errorMsg || "Unable to check link status. Please try again."}
            </p>

            <button onClick={handleRetry} className="tls-retry-btn mt-6">
              <RefreshCw className="w-4 h-4" />
              <span>Retry</span>
              <div className="tls-retry-shimmer" />
            </button>

            <button onClick={() => { haptics.tap(); onBack(); }} className="tls-link-btn mt-4">
              <ArrowLeft className="w-4 h-4" /> Go back
            </button>
          </div>
        )}

        {/* Shimmer transition */}
        {phase === "shimmer" && (
          <div className="tls-waiting-container tls-fade-in">
            <div className="tls-shimmer-ring">
              <div className="tls-shimmer-glow" />
            </div>
            <div className="tls-shimmer-bar mt-8" style={{ width: 180 }} />
            <div className="tls-shimmer-bar mt-3" style={{ width: 240 }} />
          </div>
        )}

        {/* Celebration */}
        {phase === "celebrating" && (
          <div className="tls-celebrate-container tls-scale-in">
            <div className="tls-success-ring tls-glass-glow">
              <CheckCircle2 className="w-14 h-14 tls-success-check" />
            </div>

            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="tls-particle"
                style={{
                  "--angle": `${i * 45}deg`,
                  "--delay": `${i * 0.08}s`,
                } as React.CSSProperties}
              />
            ))}

            <h2 className="text-xl font-bold tls-heading mt-8 tls-slide-up" style={{ animationDelay: "0.3s" }}>
              <Sparkles className="w-5 h-5 inline mr-1" style={{ color: "oklch(0.82 0.06 85)" }} />
              Family Linked!
            </h2>
            <p className="text-sm tls-sub mt-2 text-center max-w-[280px] tls-slide-up" style={{ animationDelay: "0.5s" }}>
              Your parent is now connected. All wallet features are unlocked.
            </p>

            <div className="flex gap-2 mt-6 tls-slide-up" style={{ animationDelay: "0.7s" }}>
              {["Scan & Pay", "History", "Insights"].map((f) => (
                <span key={f} className="tls-unlock-pill">{f}</span>
              ))}
            </div>

            <p className="text-[11px] tls-sub mt-6 tls-slide-up" style={{ animationDelay: "0.9s" }}>
              Redirecting to dashboard…
            </p>
          </div>
        )}
      </div>

      <style>{tslStyles}</style>
    </div>
  );
}

const tslStyles = `
  .tls-root { background: var(--background); position: relative; }
  .tls-heading { color: var(--foreground); }
  .tls-sub { color: oklch(0.55 0.01 250); }

  .tls-back-btn {
    width: 40px; height: 40px; border-radius: 14px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.7 0.01 250); cursor: pointer;
  }

  .tls-ring-outer {
    width: 110px; height: 110px; border-radius: 999px;
    background: oklch(0.82 0.06 85 / 0.06);
    border: 2px solid oklch(0.82 0.06 85 / 0.15);
    display: flex; align-items: center; justify-content: center;
    position: relative; z-index: 2;
  }
  .tls-ring-inner {
    width: 80px; height: 80px; border-radius: 999px;
    background: oklch(0.82 0.06 85 / 0.1);
    border: 1.5px solid oklch(0.82 0.06 85 / 0.25);
    display: flex; align-items: center; justify-content: center;
  }

  /* Error ring colors */
  .tls-ring-error {
    background: oklch(0.65 0.08 30 / 0.06);
    border-color: oklch(0.65 0.08 30 / 0.15);
  }
  .tls-ring-error-inner {
    background: oklch(0.65 0.08 30 / 0.1);
    border-color: oklch(0.65 0.08 30 / 0.25);
  }

  .tls-pulse-ring {
    width: 130px; height: 130px; border-radius: 999px;
    border: 2px solid oklch(0.82 0.06 85 / 0.1);
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    animation: tls-pulse 2.5s ease-out infinite;
    pointer-events: none; z-index: 1;
  }
  @keyframes tls-pulse {
    0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
  }

  .tls-waiting-container {
    display: flex; flex-direction: column; align-items: center;
    position: relative;
  }

  .tls-status-pill {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 20px; border-radius: 999px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
  }

  .tls-link-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 20px; border-radius: 12px;
    background: oklch(0.82 0.06 85 / 0.1);
    color: oklch(0.82 0.06 85);
    font-size: 13px; font-weight: 600;
    border: 1px solid oklch(0.82 0.06 85 / 0.2);
    cursor: pointer;
  }

  /* Retry button with shimmer */
  .tls-retry-btn {
    position: relative; overflow: hidden;
    display: flex; align-items: center; gap: 8px;
    padding: 12px 28px; border-radius: 14px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
    color: oklch(0.82 0.06 85);
    font-size: 14px; font-weight: 600;
    cursor: pointer;
  }
  .tls-retry-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, oklch(0.82 0.06 85 / 0.08) 50%, transparent 100%);
    animation: tls-shimmer-sweep 2s ease-in-out infinite;
  }

  /* Shimmer transition */
  .tls-shimmer-ring {
    width: 110px; height: 110px; border-radius: 999px;
    background: oklch(0.15 0.005 250);
    position: relative; overflow: hidden;
  }
  .tls-shimmer-glow {
    position: absolute; inset: 0; border-radius: 999px;
    background: linear-gradient(135deg, oklch(0.82 0.06 85 / 0.1), oklch(0.82 0.06 85 / 0.25), oklch(0.82 0.06 85 / 0.1));
    animation: tls-shimmer-sweep 1.2s ease-in-out infinite;
  }
  .tls-shimmer-bar {
    height: 14px; border-radius: 8px;
    background: oklch(0.15 0.005 250);
    position: relative; overflow: hidden;
  }
  .tls-shimmer-bar::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, oklch(0.82 0.06 85 / 0.12) 50%, transparent 100%);
    animation: tls-shimmer-sweep 1.2s ease-in-out infinite;
  }
  @keyframes tls-shimmer-sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  /* Celebration */
  .tls-celebrate-container {
    display: flex; flex-direction: column; align-items: center;
    position: relative;
  }

  .tls-success-ring {
    width: 100px; height: 100px; border-radius: 999px;
    background: linear-gradient(135deg, oklch(0.82 0.06 85 / 0.15), oklch(0.7 0.08 60 / 0.1));
    border: 2.5px solid oklch(0.82 0.06 85 / 0.4);
    display: flex; align-items: center; justify-content: center;
    animation: tls-ring-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 0 40px -8px oklch(0.82 0.06 85 / 0.3);
  }
  .tls-glass-glow {
    box-shadow: 0 0 60px -10px oklch(0.82 0.06 85 / 0.35), inset 0 0 20px oklch(0.82 0.06 85 / 0.05);
  }
  .tls-success-check { color: oklch(0.82 0.06 85); }

  @keyframes tls-ring-pop {
    0% { transform: scale(0.3); opacity: 0; }
    60% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
  }

  .tls-particle {
    position: absolute; top: 50%; left: 50%;
    width: 6px; height: 6px; border-radius: 999px;
    background: oklch(0.82 0.06 85);
    animation: tls-particle-fly 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    animation-delay: var(--delay);
    opacity: 0; z-index: 0;
  }
  @keyframes tls-particle-fly {
    0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateY(0); opacity: 1; }
    100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-70px); opacity: 0; }
  }

  .tls-unlock-pill {
    font-size: 11px; font-weight: 600; padding: 5px 12px;
    border-radius: 999px;
    background: oklch(0.5 0.1 145 / 0.12);
    color: oklch(0.7 0.08 145);
    border: 1px solid oklch(0.5 0.1 145 / 0.2);
  }

  /* Animations */
  .tls-fade-in {
    animation: tls-fade-in 0.5s ease-out;
  }
  @keyframes tls-fade-in {
    0% { opacity: 0; transform: translateY(16px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  .tls-scale-in {
    animation: tls-scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes tls-scale-in {
    0% { opacity: 0; transform: scale(0.85); }
    100% { opacity: 1; transform: scale(1); }
  }

  .tls-slide-up {
    animation: tls-slide-up 0.4s ease-out both;
  }
  @keyframes tls-slide-up {
    0% { opacity: 0; transform: translateY(12px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .tls-pulse-ring, .tls-particle { animation: none; display: none; }
    .tls-success-ring, .tls-fade-in, .tls-scale-in, .tls-slide-up,
    .tls-shimmer-glow, .tls-shimmer-bar::after, .tls-retry-shimmer { animation: none; }
  }
`;
