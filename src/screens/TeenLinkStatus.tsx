import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Shield, CheckCircle2, Loader2, Link2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";

interface Props {
  onBack: () => void;
  onLinked: () => void;
}

export function TeenLinkStatus({ onBack, onLinked }: Props) {
  const [status, setStatus] = useState<"waiting" | "accepted">("waiting");
  const [phase, setPhase] = useState<"polling" | "celebrating">("polling");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Check initial status
    const checkStatus = async () => {
      const { data } = await supabase
        .from("family_links")
        .select("id, status")
        .eq("status", "active")
        .limit(1);
      if (data && data.length > 0) {
        handleAccepted();
        return true;
      }
      return false;
    };

    const startPolling = async () => {
      const alreadyLinked = await checkStatus();
      if (alreadyLinked) return;

      pollRef.current = setInterval(async () => {
        const { data } = await supabase
          .from("family_links")
          .select("id, status")
          .eq("status", "active")
          .limit(1);
        if (data && data.length > 0) {
          handleAccepted();
        }
      }, 3000);
    };

    startPolling();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleAccepted = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStatus("accepted");
    setPhase("celebrating");
    haptics.press();

    // Update profile link status
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) {
        supabase.from("profiles").update({ family_link_status: "accepted" as any }).eq("id", data.user.id).then(() => {});
      }
    });

    // Auto-navigate after celebration
    setTimeout(() => {
      onLinked();
    }, 3500);
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

        {phase === "celebrating" && (
          <div className="tls-celebrate-container tls-scale-in">
            <div className="tls-success-ring">
              <CheckCircle2 className="w-14 h-14 tls-success-check" />
            </div>

            {/* Particles */}
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
    .tls-success-ring, .tls-fade-in, .tls-scale-in, .tls-slide-up { animation: none; }
  }
`;
