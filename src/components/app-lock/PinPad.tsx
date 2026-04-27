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

  return (
    <div className="flex flex-col items-center gap-8 select-none">
      <div
        className="flex gap-3"
        key={`dots-${shake}`}
        style={shake ? { animation: "applock-shake 360ms ease" } : undefined}
        aria-label={`${pin.length} of ${length} digits entered`}
      >
        {dots.map((filled, i) => (
          <span
            key={i}
            className={`block rounded-full transition-all ${filled ? "bg-white w-3.5 h-3.5" : "bg-white/25 w-3 h-3"}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => append(d)}
            disabled={disabled}
            className="h-16 rounded-2xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white text-2xl font-medium transition disabled:opacity-40"
          >{d}</button>
        ))}
        {extraButton ? (
          <button
            type="button"
            onClick={extraButton.onClick}
            disabled={disabled}
            className="h-16 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium flex flex-col items-center justify-center gap-1 disabled:opacity-40"
          >
            {extraButton.icon}
            <span>{extraButton.label}</span>
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={() => append("0")}
          disabled={disabled}
          className="h-16 rounded-2xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white text-2xl font-medium transition disabled:opacity-40"
        >0</button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled || pin.length === 0}
          aria-label="Backspace"
          className="h-16 rounded-2xl bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition disabled:opacity-30"
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
