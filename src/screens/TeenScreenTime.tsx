import { ArrowLeft, Clock, Smartphone, Monitor, Gamepad2, BookOpen } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface Props { onBack: () => void }

const USAGE_DATA = [
  { label: "Social Media", hours: 2.5, icon: Smartphone, color: "#6366f1" },
  { label: "Gaming", hours: 1.8, icon: Gamepad2, color: "#f59e0b" },
  { label: "Education", hours: 1.2, icon: BookOpen, color: "#10b981" },
  { label: "Entertainment", hours: 0.8, icon: Monitor, color: "#ef4444" },
];

export function TeenScreenTime({ onBack }: Props) {
  const totalHours = USAGE_DATA.reduce((s, d) => s + d.hours, 0);

  return (
    <div className="flex-1 flex flex-col tst-root overflow-y-auto">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tst-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tst-heading">Screen Time</h1>
      </div>

      <div className="mx-5 mt-2 tst-overview-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-wider uppercase tst-label">Today's Usage</p>
            <p className="text-2xl font-bold mt-1 tst-amount">{totalHours.toFixed(1)}h</p>
            <p className="text-[11px] tst-sub mt-1">Daily limit: 4h</p>
          </div>
          <div className="tst-icon-box">
            <Clock className="w-6 h-6" />
          </div>
        </div>
        <div className="tst-progress-track mt-4">
          <div className="tst-progress-fill" style={{ width: `${Math.min(100, (totalHours / 4) * 100)}%` }} />
        </div>
      </div>

      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase tst-label mb-3">Breakdown</p>
        <div className="flex flex-col gap-2">
          {USAGE_DATA.map(({ label, hours, icon: Icon, color }) => (
            <div key={label} className="tst-row">
              <div className="tst-row-icon" style={{ background: `${color}15`, color }}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium tst-heading">{label}</p>
                <div className="tst-bar-track mt-1.5">
                  <div className="tst-bar-fill" style={{ width: `${(hours / totalHours) * 100}%`, background: color }} />
                </div>
              </div>
              <span className="text-sm font-semibold tst-heading">{hours}h</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .tst-root { background: var(--background); }
        .tst-heading { color: var(--foreground); }
        .tst-sub { color: oklch(0.55 0.01 250); }
        .tst-label { color: oklch(0.82 0.06 85); }
        .tst-amount { color: oklch(0.92 0.04 85); }
        .tst-back-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250); border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center; color: oklch(0.7 0.01 250); cursor: pointer;
        }
        .tst-overview-card {
          padding: 20px; border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
        }
        .tst-icon-box {
          width: 48px; height: 48px; border-radius: 14px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          display: flex; align-items: center; justify-content: center;
        }
        .tst-progress-track { height: 6px; border-radius: 3px; background: oklch(0.2 0.005 250); }
        .tst-progress-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
        }
        .tst-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250); border: 1px solid oklch(0.2 0.005 250);
        }
        .tst-row-icon {
          width: 42px; height: 42px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .tst-bar-track { height: 4px; border-radius: 2px; background: oklch(0.2 0.005 250); }
        .tst-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
      `}</style>
    </div>
  );
}
