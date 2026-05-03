import { useState } from "react";
import { ArrowLeft, Target, Plus, TrendingUp, Sparkles } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface Props { onBack: () => void }

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  icon: string;
}

const DEMO_GOALS: Goal[] = [
  { id: "1", name: "New Headphones", target: 3000, saved: 1200, icon: "🎧" },
  { id: "2", name: "Birthday Gift", target: 1500, saved: 900, icon: "🎁" },
  { id: "3", name: "Gaming Fund", target: 5000, saved: 500, icon: "🎮" },
];

export function TeenSavingsGoals({ onBack }: Props) {
  const [goals] = useState<Goal[]>(DEMO_GOALS);

  const formatAmt = (n: number) =>
    "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="flex-1 flex flex-col tsg-root overflow-y-auto">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tsg-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tsg-heading">Savings Goals</h1>
      </div>

      <div className="mx-5 mt-2 tsg-overview-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-wider uppercase tsg-label">Total Saved</p>
            <p className="text-2xl font-bold mt-1 tsg-amount">{formatAmt(goals.reduce((s, g) => s + g.saved, 0))}</p>
          </div>
          <div className="tsg-icon-box">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium tracking-widest uppercase tsg-label">Your Goals</p>
          <button onClick={() => haptics.tap()} className="tsg-add-btn">
            <Plus className="w-3.5 h-3.5" /> Add Goal
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
            return (
              <div key={g.id} className="tsg-goal-card">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{g.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold tsg-heading truncate">{g.name}</p>
                    <p className="text-[11px] tsg-sub">{formatAmt(g.saved)} of {formatAmt(g.target)}</p>
                  </div>
                  <span className="text-sm font-bold tsg-pct">{pct}%</span>
                </div>
                <div className="tsg-progress-track mt-3">
                  <div className="tsg-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-5 mt-5 mb-6 tsg-tip-card">
        <Sparkles className="w-5 h-5 flex-shrink-0" style={{ color: "oklch(0.82 0.06 85)" }} />
        <div>
          <p className="text-sm font-semibold tsg-heading">Pro Tip</p>
          <p className="text-[12px] tsg-sub mt-1">Save ₹50 daily and you'll reach your headphones goal in 36 days!</p>
        </div>
      </div>

      <style>{`
        .tsg-root { background: var(--background); }
        .tsg-heading { color: var(--foreground); }
        .tsg-sub { color: oklch(0.55 0.01 250); }
        .tsg-label { color: oklch(0.82 0.06 85); }
        .tsg-amount { color: oklch(0.92 0.04 85); }
        .tsg-pct { color: oklch(0.82 0.06 85); }
        .tsg-back-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250); border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center; color: oklch(0.7 0.01 250); cursor: pointer;
        }
        .tsg-overview-card {
          padding: 20px; border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
        }
        .tsg-icon-box {
          width: 48px; height: 48px; border-radius: 14px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          display: flex; align-items: center; justify-content: center;
        }
        .tsg-add-btn {
          display: flex; align-items: center; gap: 4px; padding: 6px 14px; border-radius: 10px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          font-size: 12px; font-weight: 600; border: none; cursor: pointer;
        }
        .tsg-goal-card {
          padding: 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250); border: 1px solid oklch(0.22 0.005 250);
        }
        .tsg-progress-track {
          height: 6px; border-radius: 3px; background: oklch(0.2 0.005 250);
        }
        .tsg-progress-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
          transition: width 0.4s ease;
        }
        .tsg-tip-card {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250); border: 1px solid oklch(0.82 0.06 85 / 0.15);
        }
      `}</style>
    </div>
  );
}
