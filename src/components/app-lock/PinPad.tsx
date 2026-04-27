// Numeric PIN pad with masked dots, haptic feedback and shake-on-error.
import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface Props {
  length: 4 | 6;
  onComplete: (pin: string) => void;
  disabled?: boolean;
  errorKey?: number; // bump to trigger shake
  extraButton?: { label: string; onClick: () => void; icon?: React.ReactNode } | null;
}

export function PinPad({ length, onComplete, disabled, errorKey, extraButton }: Props) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (errorKey) {
      setPin("");
      setShake((s) => s + 1);
    }
  }, [errorKey]);

  const append = (d: string) => {
    if (disabled) return;
    void haptics.tap();
    if (pin.length >= length) return;
    const next = pin + d;
    setPin(next);
    if (next.length === length) onComplete(next);
  };
  const backspace = () => {
    if (disabled) return;
    void haptics.select();
    setPin((p) => p.slice(0, -1));
  };

  const dots = Array.from({ length }, (_, i) => i < pin.length);

  const keyBase =
    "relative h-[64px] rounded-2xl text-2xl font-light tracking-wide text-white/95 " +
    "bg-gradient-to-b from-white/[0.08] to-white/[0.02] " +
    "border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_14px_-6px_rgba(0,0,0,0.6)] " +
    "backdrop-blur-md transition-all duration-150 " +
    "hover:from-emerald-300/10 hover:to-white/[0.03] hover:border-emerald-300/30 " +
    "active:scale-[0.96] active:from-emerald-400/20 active:to-emerald-500/5 " +
    "disabled:opacity-40 disabled:active:scale-100";

  return (
    <div className="flex flex-col items-center gap-7 select-none w-full">
      <div
        className="flex gap-3 h-5 items-center"
        key={`dots-${shake}`}
        style={shake ? { animation: "applock-shake 360ms ease" } : undefined}
        aria-label={`${pin.length} of ${length} digits entered`}
      >
        {dots.map((filled, i) => (
          <span
            key={i}
            className={`block rounded-full transition-all duration-200 ${
              filled
                ? "w-3.5 h-3.5 bg-gradient-to-b from-[#f5e7b8] to-[#c9a24a] shadow-[0_0_10px_rgba(201,162,74,0.55)]"
                : "w-2.5 h-2.5 bg-white/15 border border-white/10"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-4 w-full max-w-[300px] px-1">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => append(d)}
            disabled={disabled}
            className={keyBase}
          >{d}</button>
        ))}
        {extraButton ? (
          <button
            type="button"
            onClick={extraButton.onClick}
            disabled={disabled}
            className={`${keyBase} text-[11px] font-medium flex flex-col items-center justify-center gap-1`}
          >
            {extraButton.icon}
            <span>{extraButton.label}</span>
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={() => append("0")}
          disabled={disabled}
          className={keyBase}
        >0</button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled || pin.length === 0}
          aria-label="Backspace"
          className={`${keyBase} !bg-transparent !border-transparent !shadow-none text-white/70 hover:text-white flex items-center justify-center`}
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>

      <style>{`
        @keyframes applock-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-10px); }
          30% { transform: translateX(10px); }
          45% { transform: translateX(-8px); }
          60% { transform: translateX(8px); }
          75% { transform: translateX(-4px); }
          90% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
