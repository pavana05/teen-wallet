import { useState } from "react";
import { ArrowLeft, Vibrate, Volume2 } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface Props {
  onBack: () => void;
}

const PATTERNS: Array<{ key: string; label: string; desc: string; fn: () => void }> = [
  { key: "tap", label: "Tap", desc: "Micro-tap for tiles & icons", fn: () => haptics.tap() },
  { key: "select", label: "Select", desc: "Crisp click for toggles & tabs", fn: () => haptics.select() },
  { key: "press", label: "Press", desc: "Medium thump for primary CTAs", fn: () => haptics.press() },
  { key: "success", label: "Success", desc: "Rising two-beat for payments", fn: () => haptics.success() },
  { key: "warning", label: "Warning", desc: "Firm thump for near-limit", fn: () => haptics.warning() },
  { key: "error", label: "Error", desc: "Triple stutter for rejections", fn: () => haptics.error() },
  { key: "bloom", label: "Bloom", desc: "Expanding swell for FAB launch", fn: () => haptics.bloom() },
  { key: "swipe", label: "Swipe", desc: "Soft swoosh for page transitions", fn: () => haptics.swipe() },
  { key: "heartbeat", label: "Heartbeat", desc: "Double-pulse greeting", fn: () => haptics.heartbeat() },
];

export function HapticsSettings({ onBack }: Props) {
  const [enabled, setEnabled] = useState(haptics.isEnabled());
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const toggle = () => {
    const next = !enabled;
    haptics.setEnabled(next);
    setEnabled(next);
    if (next) haptics.tap();
  };

  const play = async (pattern: typeof PATTERNS[number]) => {
    setPlayingKey(pattern.key);
    await pattern.fn();
    setTimeout(() => setPlayingKey(null), 400);
  };

  return (
    <div className="hs-root">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="hs-back" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold" style={{ color: "var(--foreground)" }}>Haptics</h1>
      </div>

      <div className="px-5 pb-8 flex-1 overflow-y-auto">
        {/* Toggle */}
        <div className="hs-toggle-card">
          <div className="hs-toggle-icon">
            <Vibrate className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="hs-toggle-label">Haptic Feedback</p>
            <p className="hs-toggle-sub">
              {enabled ? "Vibrations enabled for interactions" : "All vibrations disabled"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            className={`hs-switch ${enabled ? "hs-switch-on" : ""}`}
          >
            <span className="hs-switch-thumb" />
          </button>
        </div>

        {/* Pattern list */}
        <div className="mt-6">
          <p className="hs-section-label">
            <Volume2 className="w-3.5 h-3.5 inline mr-1.5" />
            Test Patterns
          </p>
          <div className="hs-patterns">
            {PATTERNS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => play(p)}
                disabled={!enabled}
                className={`hs-pattern-btn ${playingKey === p.key ? "hs-playing" : ""}`}
              >
                <div className="flex-1 min-w-0 text-left">
                  <p className="hs-pattern-name">{p.label}</p>
                  <p className="hs-pattern-desc">{p.desc}</p>
                </div>
                <span className="hs-play-dot" />
              </button>
            ))}
          </div>
        </div>

        <p className="hs-footer">
          Haptics are automatically disabled when your device has "Reduce Motion" enabled in accessibility settings.
        </p>
      </div>
      <style>{hsStyles}</style>
    </div>
  );
}

const hsStyles = `
  .hs-root {
    flex: 1; display: flex; flex-direction: column;
    background: var(--background);
    min-height: 100%;
  }
  .hs-back {
    width: 40px; height: 40px; border-radius: 14px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.7 0.01 250); cursor: pointer;
  }

  .hs-toggle-card {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 18px; border-radius: 18px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.2 0.005 250);
  }
  .hs-toggle-icon {
    width: 44px; height: 44px; border-radius: 14px;
    background: oklch(0.82 0.06 85 / 0.1);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.82 0.06 85);
  }
  .hs-toggle-label { font-size: 14px; font-weight: 600; color: var(--foreground); }
  .hs-toggle-sub { font-size: 11px; color: oklch(0.55 0.01 250); margin-top: 2px; }

  .hs-switch {
    width: 48px; height: 28px; border-radius: 999px;
    background: oklch(0.2 0.005 250);
    border: 1px solid oklch(0.3 0.005 250);
    position: relative; cursor: pointer;
    transition: background 200ms ease;
  }
  .hs-switch-on { background: oklch(0.65 0.06 85); border-color: oklch(0.7 0.06 85); }
  .hs-switch-thumb {
    position: absolute; top: 2px; left: 2px;
    width: 22px; height: 22px; border-radius: 999px;
    background: white;
    transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .hs-switch-on .hs-switch-thumb { transform: translateX(20px); }

  .hs-section-label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.15em;
    text-transform: uppercase;
    color: oklch(0.82 0.06 85); margin-bottom: 10px;
  }

  .hs-patterns {
    display: flex; flex-direction: column; gap: 6px;
  }
  .hs-pattern-btn {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; border-radius: 14px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.2 0.005 250);
    cursor: pointer;
    transition: transform 120ms ease, border-color 150ms ease;
  }
  .hs-pattern-btn:active { transform: scale(0.96); }
  .hs-pattern-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .hs-playing { border-color: oklch(0.82 0.06 85 / 0.4); }
  .hs-pattern-name { font-size: 13px; font-weight: 600; color: var(--foreground); }
  .hs-pattern-desc { font-size: 11px; color: oklch(0.55 0.01 250); margin-top: 1px; }

  .hs-play-dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: oklch(0.82 0.06 85 / 0.5);
    flex-shrink: 0;
  }
  .hs-playing .hs-play-dot {
    background: oklch(0.82 0.06 85);
    animation: hs-pulse 400ms ease-out;
  }
  @keyframes hs-pulse {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(2); opacity: 0; }
  }

  .hs-footer {
    margin-top: 24px; font-size: 11px;
    color: oklch(0.45 0.01 250);
    text-align: center;
    line-height: 1.5;
  }

  @media (prefers-reduced-motion: reduce) {
    .hs-playing .hs-play-dot { animation: none; }
    .hs-switch-thumb { transition: none; }
  }
`;
