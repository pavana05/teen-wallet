import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Target, Plus, TrendingUp, Sparkles, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import { offlineCache } from "@/lib/offlineCache";
import { toast } from "sonner";

interface Props { onBack: () => void }

interface Goal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  icon: string;
  completed: boolean;
}

export function TeenSavingsGoals({ onBack }: Props) {
  const { userId } = useApp();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newIcon, setNewIcon] = useState("🎯");
  const [saving, setSaving] = useState(false);

  const ICONS = ["🎯", "🎧", "🎁", "🎮", "📱", "👟", "🎒", "💻", "🎨", "🎵"];

  const load = useCallback(async () => {
    setError(null);
    const cached = offlineCache.get<Goal[]>("savings_goals");
    if (cached) setGoals(cached);
    try {
      const { data, error: err } = await supabase
        .from("savings_goals")
        .select("id, name, target_amount, saved_amount, icon, completed")
        .order("created_at", { ascending: false });
      if (err) throw err;
      const g = (data ?? []) as Goal[];
      setGoals(g);
      offlineCache.set("savings_goals", g);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load goals");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addGoal = async () => {
    if (!userId || !newName.trim() || !newTarget) return;
    const target = Number(newTarget);
    if (target < 1) { toast.error("Set a target above ₹0"); return; }
    setSaving(true);
    haptics.bloom();
    try {
      const { error: err } = await supabase.from("savings_goals").insert({
        user_id: userId,
        name: newName.trim(),
        target_amount: target,
        saved_amount: 0,
        icon: newIcon,
      });
      if (err) throw err;
      toast.success("Goal created!");
      setNewName(""); setNewTarget(""); setNewIcon("🎯"); setShowAdd(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create goal");
    }
    setSaving(false);
  };

  const addSavings = async (goalId: string, addAmt: number) => {
    haptics.tap();
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    const newSaved = Math.min(goal.saved_amount + addAmt, goal.target_amount);
    const completed = newSaved >= goal.target_amount;
    try {
      await supabase.from("savings_goals").update({ saved_amount: newSaved, completed }).eq("id", goalId);
      if (completed) { haptics.success(); toast.success("🎉 Goal reached!"); }
      load();
    } catch { toast.error("Failed to update"); }
  };

  const formatAmt = (n: number) =>
    "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const totalSaved = goals.reduce((s, g) => s + g.saved_amount, 0);

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
            <p className="text-2xl font-bold mt-1 tsg-amount">{formatAmt(totalSaved)}</p>
          </div>
          <div className="tsg-icon-box">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="mx-5 mt-5 tsg-error-card">
          <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "oklch(0.7 0.12 25)" }} />
          <div className="flex-1">
            <p className="text-[13px] font-semibold tsg-heading">Something went wrong</p>
            <p className="text-[11px] tsg-sub mt-0.5">{error}</p>
          </div>
          <button onClick={() => { haptics.tap(); setLoading(true); load(); }} className="tsg-retry-btn">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      <div className="mx-5 mt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium tracking-widest uppercase tsg-label">Your Goals</p>
          <button onClick={() => { haptics.tap(); setShowAdd(!showAdd); }} className="tsg-add-btn">
            <Plus className="w-3.5 h-3.5" /> Add Goal
          </button>
        </div>

        {/* Add Goal Form */}
        {showAdd && (
          <div className="tsg-goal-card mb-3">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {ICONS.map(ic => (
                <button key={ic} onClick={() => setNewIcon(ic)} className={`tsg-icon-pick ${newIcon === ic ? "tsg-icon-pick-active" : ""}`}>{ic}</button>
              ))}
            </div>
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Goal name" className="tsg-input mb-2"
            />
            <input
              type="number" inputMode="numeric"
              value={newTarget} onChange={e => setNewTarget(e.target.value)}
              placeholder="Target amount (₹)" className="tsg-input mb-3"
            />
            <button onClick={addGoal} disabled={saving || !newName.trim() || !newTarget} className="tsg-save-btn">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Goal"}
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && goals.length === 0 && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map(i => <div key={i} className="tsg-skel" />)}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && goals.length === 0 && (
          <div className="tsg-empty">
            <Target className="w-10 h-10" style={{ color: "oklch(0.4 0.03 85)" }} />
            <p className="text-[14px] font-semibold tsg-heading mt-3">No savings goals yet</p>
            <p className="text-[12px] tsg-sub mt-1">Tap "Add Goal" to start saving for something special</p>
          </div>
        )}

        {/* Goals list */}
        <div className="flex flex-col gap-3">
          {goals.map((g) => {
            const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100)) : 0;
            return (
              <div key={g.id} className="tsg-goal-card">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{g.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold tsg-heading truncate">{g.name}</p>
                    <p className="text-[11px] tsg-sub">{formatAmt(g.saved_amount)} of {formatAmt(g.target_amount)}</p>
                  </div>
                  <span className="text-sm font-bold tsg-pct">{pct}%</span>
                </div>
                <div className="tsg-progress-track mt-3">
                  <div className="tsg-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                {!g.completed && (
                  <div className="flex gap-2 mt-3">
                    {[50, 100, 500].map(amt => (
                      <button key={amt} onClick={() => addSavings(g.id, amt)} className="tsg-save-quick">+₹{amt}</button>
                    ))}
                  </div>
                )}
                {g.completed && <p className="text-[11px] font-semibold mt-2" style={{ color: "oklch(0.7 0.14 145)" }}>✓ Goal reached!</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-5 mt-5 mb-6 tsg-tip-card">
        <Sparkles className="w-5 h-5 flex-shrink-0" style={{ color: "oklch(0.82 0.06 85)" }} />
        <div>
          <p className="text-sm font-semibold tsg-heading">Pro Tip</p>
          <p className="text-[12px] tsg-sub mt-1">Save ₹50 daily and you'll build great habits in just a month!</p>
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
        .tsg-progress-track { height: 6px; border-radius: 3px; background: oklch(0.2 0.005 250); }
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
        .tsg-error-card {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.14 0.02 25 / 0.3);
          border: 1px solid oklch(0.5 0.1 25 / 0.25);
        }
        .tsg-retry-btn {
          display: flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 10px;
          background: oklch(0.2 0.01 250); color: oklch(0.8 0.02 250);
          font-size: 11px; font-weight: 600; border: none; cursor: pointer;
        }
        .tsg-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 40px 20px; text-align: center;
        }
        .tsg-input {
          width: 100%; padding: 12px 14px; border-radius: 12px;
          background: oklch(0.1 0.005 250); border: 1px solid oklch(0.22 0.005 250);
          color: white; font-size: 14px; outline: none;
        }
        .tsg-input::placeholder { color: oklch(0.35 0.01 250); }
        .tsg-input:focus { border-color: oklch(0.82 0.06 85 / 0.4); }
        .tsg-save-btn {
          width: 100%; padding: 12px; border-radius: 12px;
          background: linear-gradient(135deg, oklch(0.82 0.06 85), oklch(0.72 0.05 60));
          color: oklch(0.1 0 0); font-size: 14px; font-weight: 700;
          border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .tsg-save-btn:disabled { opacity: 0.4; }
        .tsg-save-quick {
          padding: 5px 12px; border-radius: 8px;
          background: oklch(0.82 0.06 85 / 0.1); color: oklch(0.82 0.06 85);
          font-size: 11px; font-weight: 600; border: none; cursor: pointer;
        }
        .tsg-save-quick:active { transform: scale(0.95); }
        .tsg-icon-pick {
          width: 36px; height: 36px; border-radius: 10px;
          background: oklch(0.1 0.005 250); border: 1px solid oklch(0.2 0.005 250);
          font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .tsg-icon-pick-active {
          border-color: oklch(0.82 0.06 85 / 0.5);
          background: oklch(0.82 0.06 85 / 0.1);
        }
        .tsg-skel {
          height: 80px; border-radius: 16px;
          background: linear-gradient(110deg, oklch(0.14 0.005 250), oklch(0.19 0.015 85) 45%, oklch(0.14 0.005 250) 55%);
          background-size: 200% 100%;
          animation: tsg-shimmer 1.6s ease-in-out infinite;
          margin-bottom: 12px;
        }
        @keyframes tsg-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tsg-skel { animation: none; }
        }
      `}</style>
    </div>
  );
}
