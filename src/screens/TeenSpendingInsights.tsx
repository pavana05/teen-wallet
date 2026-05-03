import { useState, useEffect } from "react";
import { ArrowLeft, BarChart3, TrendingDown, TrendingUp, ShoppingBag, Coffee, Gamepad2, Bus } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";

interface Props { onBack: () => void }

const CATEGORIES = [
  { name: "Food & Drinks", icon: Coffee, amount: 450, color: "#f59e0b", pct: 35 },
  { name: "Shopping", icon: ShoppingBag, amount: 320, color: "#6366f1", pct: 25 },
  { name: "Gaming", icon: Gamepad2, amount: 280, color: "#ef4444", pct: 22 },
  { name: "Transport", icon: Bus, amount: 230, color: "#10b981", pct: 18 },
];

export function TeenSpendingInsights({ onBack }: Props) {
  const [weekTotal, setWeekTotal] = useState(1280);
  const [prevWeek] = useState(1450);
  const saved = prevWeek - weekTotal;
  const savedPct = Math.round((saved / prevWeek) * 100);

  return (
    <div className="flex-1 flex flex-col tsi-root overflow-y-auto">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tsi-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tsi-heading">Spending Insights</h1>
      </div>

      <div className="mx-5 mt-2 tsi-overview-card">
        <p className="text-[11px] font-medium tracking-wider uppercase tsi-label">This Week</p>
        <p className="text-2xl font-bold mt-1 tsi-amount">₹{weekTotal.toLocaleString("en-IN")}</p>
        <div className="flex items-center gap-2 mt-2">
          {saved > 0 ? (
            <>
              <TrendingDown className="w-4 h-4" style={{ color: "oklch(0.7 0.1 145)" }} />
              <span className="text-[12px] font-medium" style={{ color: "oklch(0.7 0.1 145)" }}>
                ₹{saved} less than last week ({savedPct}%)
              </span>
            </>
          ) : (
            <>
              <TrendingUp className="w-4 h-4" style={{ color: "oklch(0.65 0.08 25)" }} />
              <span className="text-[12px] font-medium" style={{ color: "oklch(0.65 0.08 25)" }}>
                ₹{Math.abs(saved)} more than last week
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase tsi-label mb-3">By Category</p>
        <div className="flex flex-col gap-2">
          {CATEGORIES.map(({ name, icon: Icon, amount, color, pct }) => (
            <div key={name} className="tsi-cat-row">
              <div className="tsi-cat-icon" style={{ background: `${color}15`, color }}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium tsi-heading">{name}</p>
                  <p className="text-sm font-semibold tsi-heading">₹{amount}</p>
                </div>
                <div className="tsi-bar-track mt-2">
                  <div className="tsi-bar-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .tsi-root { background: var(--background); }
        .tsi-heading { color: var(--foreground); }
        .tsi-sub { color: oklch(0.55 0.01 250); }
        .tsi-label { color: oklch(0.82 0.06 85); }
        .tsi-amount { color: oklch(0.92 0.04 85); }
        .tsi-back-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250); border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center; color: oklch(0.7 0.01 250); cursor: pointer;
        }
        .tsi-overview-card {
          padding: 20px; border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
        }
        .tsi-cat-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250); border: 1px solid oklch(0.2 0.005 250);
        }
        .tsi-cat-icon {
          width: 42px; height: 42px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .tsi-bar-track { height: 4px; border-radius: 2px; background: oklch(0.2 0.005 250); }
        .tsi-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
      `}</style>
    </div>
  );
}
