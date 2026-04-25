import { useMemo } from "react";

export function PhoneVerified({ onContinue }: { onContinue: () => void }) {
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

  return (
    <div className="pv-root">
      <div className="pv-spotlight" />

      {/* Floating particles */}
      <div className="pv-particles">
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

      {/* Header brand */}
      <div className="relative z-10 pt-8 px-6 flex items-center justify-center">
        <span className="text-[11px] tracking-[0.35em] text-white/60 font-light">TEEN WALLET</span>
      </div>

      {/* Hero */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <div className="pv-badge-wrap">
          <div className="pv-ripple" />
          <div className="pv-ring" />
          <div className="pv-ring delay" />
          <div className="pv-badge">
            <div className="pv-streak" />
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

      {/* CTA */}
      <div className="relative z-10 px-6 pb-10">
        <button onClick={onContinue} className="pv-btn">
          <span className="pv-btn-shine" />
          Continue
        </button>
      </div>
    </div>
  );
}
