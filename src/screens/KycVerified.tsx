import { useEffect, useState, useRef } from "react";
import { ShieldCheck, Sparkles, Wallet, ArrowRight } from "lucide-react";
import { haptics } from "@/lib/haptics";

const AUTO_REDIRECT_MS = 4500;

export function KycVerified({ onContinue }: { onContinue: () => void }) {
  const [phase, setPhase] = useState<"enter" | "glow" | "ready">("enter");
  const [countdown, setCountdown] = useState(Math.ceil(AUTO_REDIRECT_MS / 1000));
  const continuedRef = useRef(false);

  const handleContinue = () => {
    if (continuedRef.current) return;
    continuedRef.current = true;
    haptics.press();
    onContinue();
  };

  useEffect(() => {
    haptics.press();
    const t1 = setTimeout(() => setPhase("glow"), 600);
    const t2 = setTimeout(() => setPhase("ready"), 1400);
    const tick = setInterval(() => setCountdown((s) => (s > 0 ? s - 1 : 0)), 1000);
    const auto = setTimeout(handleContinue, AUTO_REDIRECT_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearInterval(tick); clearTimeout(auto); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="kv-root">
      {/* Background effects */}
      <div className="kv-bg-glow" />
      <div className="kv-bg-rays" aria-hidden="true" />
      <div className={`kv-shimmer-sweep ${phase === "glow" || phase === "ready" ? "active" : ""}`} aria-hidden="true" />

      {/* Floating particles */}
      <div className="kv-particles" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="kv-particle" style={{ ["--i" as string]: i }} />
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        {/* Shield badge */}
        <div className={`kv-badge ${phase}`}>
          <div className="kv-badge-ring">
            <div className="kv-badge-inner">
              <ShieldCheck className="w-12 h-12" strokeWidth={1.8} />
            </div>
          </div>
          <div className="kv-badge-glow" />
        </div>

        {/* Title */}
        <div className={`kv-text-block ${phase === "ready" ? "visible" : ""}`}>
          <div className="kv-sparkle-row">
            <Sparkles className="w-4 h-4" />
            <span className="kv-eyebrow">Identity Verified</span>
            <Sparkles className="w-4 h-4" />
          </div>
          <h1 className="kv-title">KYC Approved! 🎉</h1>
          <p className="kv-subtitle">
            Your account is fully verified. You can now scan, pay, and track all your transactions.
          </p>
        </div>

        {/* Feature pills */}
        <div className={`kv-features ${phase === "ready" ? "visible" : ""}`}>
          {[
            { icon: Wallet, label: "Scan & Pay Unlocked" },
            { icon: ShieldCheck, label: "Full Wallet Access" },
          ].map(({ icon: Icon, label }, i) => (
            <div key={label} className="kv-feature-pill" style={{ animationDelay: `${1.6 + i * 0.15}s` }}>
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Countdown */}
        <p className={`kv-countdown ${phase === "ready" ? "visible" : ""}`} suppressHydrationWarning>
          {countdown > 0
            ? `Opening your wallet in ${countdown}s…`
            : "Opening your wallet…"}
        </p>
      </div>

      {/* CTA */}
      <div className="relative z-10 px-6 pb-8 safe-bottom">
        <button className={`kv-cta ${phase === "ready" ? "visible" : ""}`} onClick={handleContinue}>
          <span>Continue to Wallet</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>

      <style>{kvStyles}</style>
    </div>
  );
}

const kvStyles = `
  .kv-root {
    position: fixed; inset: 0; z-index: 60;
    display: flex; flex-direction: column;
    background: oklch(0.08 0.005 250);
    overflow: hidden;
  }

  /* Background glow */
  .kv-bg-glow {
    position: absolute; top: 20%; left: 50%;
    width: 400px; height: 400px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, oklch(0.45 0.12 145 / 0.2) 0%, transparent 70%);
    filter: blur(60px);
    animation: kv-glow-pulse 3s ease-in-out infinite;
  }

  .kv-bg-rays {
    position: absolute; inset: 0;
    background: conic-gradient(from 0deg at 50% 35%,
      transparent 0deg, oklch(0.4 0.08 145 / 0.04) 30deg,
      transparent 60deg, oklch(0.5 0.06 85 / 0.03) 120deg,
      transparent 150deg, oklch(0.4 0.08 145 / 0.04) 210deg,
      transparent 240deg, oklch(0.5 0.06 85 / 0.03) 300deg,
      transparent 360deg
    );
    animation: kv-rays-spin 20s linear infinite;
  }

  /* Shimmer sweep */
  .kv-shimmer-sweep {
    position: absolute; inset: 0;
    background: linear-gradient(
      110deg,
      transparent 0%, transparent 40%,
      oklch(0.82 0.06 85 / 0.06) 45%,
      oklch(0.9 0.04 85 / 0.12) 50%,
      oklch(0.82 0.06 85 / 0.06) 55%,
      transparent 60%, transparent 100%
    );
    transform: translateX(-120%);
    pointer-events: none;
  }
  .kv-shimmer-sweep.active {
    animation: kv-shimmer 1.8s ease-out forwards;
  }

  /* Floating particles */
  .kv-particles {
    position: absolute; inset: 0; pointer-events: none;
  }
  .kv-particle {
    position: absolute;
    width: 4px; height: 4px; border-radius: 999px;
    background: oklch(0.82 0.06 85 / 0.5);
    animation: kv-float 4s ease-in-out infinite;
    animation-delay: calc(var(--i) * 0.5s);
    left: calc(10% + var(--i) * 10%);
    top: calc(20% + var(--i) * 8%);
  }

  /* Badge */
  .kv-badge {
    position: relative;
    transform: scale(0.3);
    opacity: 0;
    transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .kv-badge.enter { transform: scale(0.6); opacity: 0.5; }
  .kv-badge.glow, .kv-badge.ready {
    transform: scale(1); opacity: 1;
  }

  .kv-badge-ring {
    width: 120px; height: 120px; border-radius: 999px;
    padding: 3px;
    background: linear-gradient(135deg, oklch(0.55 0.12 145), oklch(0.82 0.06 85));
    animation: kv-ring-spin 6s linear infinite;
  }

  .kv-badge-inner {
    width: 100%; height: 100%; border-radius: 999px;
    background: oklch(0.1 0.005 250);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.82 0.06 85);
  }

  .kv-badge-glow {
    position: absolute; inset: -20px;
    border-radius: 999px;
    background: radial-gradient(circle, oklch(0.55 0.12 145 / 0.25) 0%, transparent 70%);
    filter: blur(20px);
    animation: kv-glow-pulse 2s ease-in-out infinite;
  }

  /* Text */
  .kv-text-block {
    text-align: center; margin-top: 32px;
    opacity: 0; transform: translateY(20px);
    transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s;
  }
  .kv-text-block.visible { opacity: 1; transform: translateY(0); }

  .kv-sparkle-row {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    color: oklch(0.82 0.06 85);
  }
  .kv-eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: 0.18em;
    text-transform: uppercase; color: oklch(0.82 0.06 85);
  }
  .kv-title {
    font-size: 28px; font-weight: 800; letter-spacing: -0.02em;
    color: var(--foreground); margin-top: 10px;
  }
  .kv-subtitle {
    font-size: 14px; color: oklch(0.55 0.01 250);
    margin-top: 8px; max-width: 280px; line-height: 1.5;
  }

  /* Feature pills */
  .kv-features {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
    margin-top: 24px;
    opacity: 0; transform: translateY(16px);
    transition: all 0.5s ease-out 0.4s;
  }
  .kv-features.visible { opacity: 1; transform: translateY(0); }

  .kv-feature-pill {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 999px;
    background: oklch(0.55 0.12 145 / 0.1);
    border: 1px solid oklch(0.55 0.12 145 / 0.2);
    color: oklch(0.7 0.1 145);
    font-size: 12px; font-weight: 600;
    animation: kv-pill-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  /* Countdown */
  .kv-countdown {
    margin-top: 20px;
    font-size: 12px; color: oklch(0.45 0.01 250);
    opacity: 0; transition: opacity 0.5s ease-out 0.6s;
  }
  .kv-countdown.visible { opacity: 1; }

  /* CTA */
  .kv-cta {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 16px; border-radius: 18px;
    background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
    color: oklch(0.12 0.005 250);
    font-size: 16px; font-weight: 700;
    border: none; cursor: pointer;
    opacity: 0; transform: translateY(16px);
    transition: all 0.5s ease-out 0.8s;
  }
  .kv-cta.visible { opacity: 1; transform: translateY(0); }

  /* Keyframes */
  @keyframes kv-glow-pulse {
    0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
    50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
  }
  @keyframes kv-rays-spin { to { transform: rotate(360deg); } }
  @keyframes kv-shimmer { to { transform: translateX(120%); } }
  @keyframes kv-float {
    0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
    50% { transform: translateY(-30px) scale(1.3); opacity: 0.8; }
  }
  @keyframes kv-ring-spin { to { transform: rotate(360deg); } }
  @keyframes kv-pill-pop {
    0% { transform: scale(0.5); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .kv-badge { transition: opacity 0.3s ease; }
    .kv-bg-rays, .kv-badge-ring { animation: none; }
    .kv-shimmer-sweep.active { animation: none; opacity: 0; }
    .kv-particle { animation: none; opacity: 0.4; }
    .kv-bg-glow { animation: none; }
    .kv-badge-glow { animation: none; }
    .kv-feature-pill { animation: none; }
  }
`;
