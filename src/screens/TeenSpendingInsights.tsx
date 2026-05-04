import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, BarChart3, TrendingDown, TrendingUp, ShoppingBag, Coffee, Gamepad2, Bus, AlertCircle, RefreshCw, Wallet } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";
import { offlineCache } from "@/lib/offlineCache";

interface Props { onBack: () => void }

interface TxnRow {
  merchant_name: string;
  amount: number;
  created_at: string;
}

const CATEGORY_MAP: Record<string, { icon: typeof Coffee; color: string }> = {
  "food": { icon: Coffee, color: "#f59e0b" },
  "shopping": { icon: ShoppingBag, color: "#6366f1" },
  "gaming": { icon: Gamepad2, color: "#ef4444" },
  "transport": { icon: Bus, color: "#10b981" },
};

function categorize(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("food") || n.includes("cafe") || n.includes("restaurant") || n.includes("swiggy") || n.includes("zomato")) return "food";
  if (n.includes("shop") || n.includes("store") || n.includes("amazon") || n.includes("flipkart")) return "shopping";
  if (n.includes("game") || n.includes("steam") || n.includes("play")) return "gaming";
  if (n.includes("uber") || n.includes("ola") || n.includes("metro") || n.includes("bus")) return "transport";
  return "other";
}

export function TeenSpendingInsights({ onBack }: Props) {
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const cached = offlineCache.get<TxnRow[]>("spending_txns");
    if (cached) setTxns(cached);
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error: err } = await supabase
        .from("transactions")
        .select("merchant_name, amount, created_at")
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false });
      if (err) throw err;
      const t = (data ?? []) as TxnRow[];
      setTxns(t);
      offlineCache.set("spending_txns", t);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load insights");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const spent = txns.filter(t => t.amount < 0);
  const weekTotal = spent.reduce((s, t) => s + Math.abs(t.amount), 0);

  // Group by category
  const catTotals: Record<string, number> = {};
  spent.forEach(t => {
    const cat = categorize(t.merchant_name);
    catTotals[cat] = (catTotals[cat] ?? 0) + Math.abs(t.amount);
  });
  const categories = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => {
      const mapped = CATEGORY_MAP[name] ?? { icon: ShoppingBag, color: "#6366f1" };
      const pct = weekTotal > 0 ? Math.round((amount / weekTotal) * 100) : 0;
      return { name: name.charAt(0).toUpperCase() + name.slice(1), icon: mapped.icon, amount, color: mapped.color, pct };
    });

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
        {loading ? (
          <div className="tsi-skel" style={{ width: 120, height: 28, marginTop: 8 }} />
        ) : (
          <p className="text-2xl font-bold mt-1 tsi-amount">₹{weekTotal.toLocaleString("en-IN")}</p>
        )}
        {!loading && weekTotal === 0 && (
          <p className="text-[11px] tsi-sub mt-1">No spending this week</p>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 tsi-error-card">
          <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "oklch(0.7 0.12 25)" }} />
          <p className="flex-1 text-[12px] tsi-heading">{error}</p>
          <button onClick={() => { haptics.tap(); setLoading(true); load(); }} className="tsi-retry">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {!loading && !error && categories.length === 0 && (
        <div className="mx-5 mt-10 flex flex-col items-center text-center">
          <Wallet className="w-10 h-10" style={{ color: "oklch(0.4 0.03 85)" }} />
          <p className="text-[14px] font-semibold tsi-heading mt-3">No spending data yet</p>
          <p className="text-[12px] tsi-sub mt-1">Your spending categories will appear here</p>
        </div>
      )}

      {categories.length > 0 && (
        <div className="mx-5 mt-5">
          <p className="text-[11px] font-medium tracking-widest uppercase tsi-label mb-3">By Category</p>
          <div className="flex flex-col gap-2">
            {categories.map(({ name, icon: Icon, amount, color, pct }) => (
              <div key={name} className="tsi-cat-row">
                <div className="tsi-cat-icon" style={{ background: `${color}15`, color }}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium tsi-heading">{name}</p>
                    <p className="text-sm font-semibold tsi-heading">₹{amount.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="tsi-bar-track mt-2">
                    <div className="tsi-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && categories.length === 0 && (
        <div className="mx-5 mt-5 flex flex-col gap-3">
          {[0, 1, 2].map(i => <div key={i} className="tsi-skel" style={{ height: 60, borderRadius: 16 }} />)}
        </div>
      )}

      <div className="h-8" />
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
        .tsi-error-card {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px; border-radius: 14px;
          background: oklch(0.14 0.02 25 / 0.3);
          border: 1px solid oklch(0.5 0.1 25 / 0.2);
        }
        .tsi-retry {
          display: flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 8px;
          background: oklch(0.2 0.01 250); color: oklch(0.8 0.02 250);
          font-size: 11px; font-weight: 600; border: none; cursor: pointer;
        }
        .tsi-skel {
          display: block; border-radius: 12px;
          background: linear-gradient(110deg, oklch(0.14 0.005 250), oklch(0.19 0.015 85) 45%, oklch(0.14 0.005 250) 55%);
          background-size: 200% 100%;
          animation: tsi-shimmer 1.6s ease-in-out infinite;
        }
        @keyframes tsi-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { .tsi-skel { animation: none; } }
      `}</style>
    </div>
  );
}
