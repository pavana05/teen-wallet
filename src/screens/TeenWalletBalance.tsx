/**
 * TeenWalletBalance — premium wallet overview with balance, recent activity,
 * and quick money actions. Champagne/warm-gold on premium dark.
 */
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, ArrowUpRight, ArrowDownLeft, Eye, EyeOff,
  TrendingUp, TrendingDown, RefreshCw, Send, Plus, Wallet
} from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { offlineCache } from "@/lib/offlineCache";
import { toast } from "sonner";

interface Props { onBack: () => void; onSendMoney?: () => void }

interface MiniTxn {
  id: string;
  merchant_name: string;
  amount: number;
  created_at: string;
  status: string;
}

export function TeenWalletBalance({ onBack, onSendMoney }: Props) {
  const { userId, balance } = useApp();
  const [liveBalance, setLiveBalance] = useState<number>(balance);
  const [hideBalance, setHideBalance] = useState(false);
  const [txns, setTxns] = useState<MiniTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const cachedBal = offlineCache.get<number>("teen_balance");
    if (cachedBal != null) setLiveBalance(cachedBal);
    try {
      const { data: profile } = await supabase.from("profiles").select("balance").single();
      if (profile) { const b = Number(profile.balance); setLiveBalance(b); offlineCache.set("teen_balance", b); }
      const { data: t } = await supabase
        .from("transactions")
        .select("id, merchant_name, amount, created_at, status")
        .order("created_at", { ascending: false })
        .limit(5);
      if (t) { setTxns(t as MiniTxn[]); offlineCache.set("teen_mini_txns", t); }
    } catch { /* offline fallback */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setTimeout(() => setRefreshing(false), 400);
  };

  const formatAmt = (n: number) => "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const income = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spent = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="flex-1 flex flex-col twb-root overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-2">
        <button onClick={() => { haptics.tap(); onBack(); }} className="twb-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[15px] font-bold twb-title">Wallet</h1>
        <button onClick={() => { haptics.tap(); refresh(); }} className="twb-refresh">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Balance Card */}
      <div className="mx-5 mt-4 twb-balance-card">
        <div className="twb-balance-orb twb-orb-1" />
        <div className="twb-balance-orb twb-orb-2" />
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider twb-label">Available Balance</p>
            <button onClick={() => { haptics.tap(); setHideBalance(!hideBalance); }} className="twb-eye">
              {hideBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="twb-balance-amt">
            {loading ? (
              <span className="twb-skel" style={{ width: 120, height: 36 }} />
            ) : hideBalance ? "₹ ••••" : formatAmt(liveBalance)}
          </p>

          <div className="flex gap-3 mt-5">
            <button onClick={() => { haptics.bloom(); onSendMoney?.(); }} className="twb-action-btn twb-send">
              <Send className="w-4 h-4" /> Send
            </button>
            <button onClick={() => { haptics.tap(); toast.info("Add money coming soon"); }} className="twb-action-btn twb-add">
              <Plus className="w-4 h-4" /> Add Money
            </button>
          </div>
        </div>
      </div>

      {/* Income / Spent Summary */}
      <div className="flex gap-3 mx-5 mt-5">
        <div className="flex-1 twb-stat-card">
          <div className="twb-stat-icon twb-stat-green">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider twb-stat-label">Income</p>
            <p className="text-[15px] font-bold twb-stat-val">{formatAmt(income)}</p>
          </div>
        </div>
        <div className="flex-1 twb-stat-card">
          <div className="twb-stat-icon twb-stat-red">
            <TrendingDown className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider twb-stat-label">Spent</p>
            <p className="text-[15px] font-bold twb-stat-val">{formatAmt(spent)}</p>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-5 mt-8">
        <h2 className="text-[13px] font-semibold twb-section-title">Recent Activity</h2>
        <div className="mt-3 space-y-2">
          {loading ? (
            [0, 1, 2].map(i => <div key={i} className="twb-skel twb-skel-row" />)
          ) : txns.length === 0 ? (
            <div className="twb-empty">
              <Wallet className="w-8 h-8 twb-empty-icon" />
              <p className="text-[13px] font-medium twb-empty-text">No transactions yet</p>
              <p className="text-[11px] twb-empty-sub">Your activity will appear here</p>
            </div>
          ) : txns.map(tx => (
            <div key={tx.id} className="twb-txn-row">
              <div className={`twb-txn-icon ${tx.amount >= 0 ? "twb-txn-in" : "twb-txn-out"}`}>
                {tx.amount >= 0
                  ? <ArrowDownLeft className="w-4 h-4" />
                  : <ArrowUpRight className="w-4 h-4" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium twb-txn-name truncate">{tx.merchant_name}</p>
                <p className="text-[10px] twb-txn-date">
                  {new Date(tx.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
              </div>
              <p className={`text-[14px] font-semibold ${tx.amount >= 0 ? "twb-amt-green" : "twb-amt-red"}`}>
                {tx.amount >= 0 ? "+" : "-"}{formatAmt(tx.amount)}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="h-8" />
      <style>{twbStyles}</style>
    </div>
  );
}

const twbStyles = `
  .twb-root { background: oklch(0.08 0.005 250); color: white; }
  .twb-back, .twb-refresh {
    width: 38px; height: 38px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    background: oklch(0.14 0.005 250); color: oklch(0.8 0.02 85);
    border: 1px solid oklch(0.2 0.01 250);
    transition: transform 120ms ease;
  }
  .twb-back:active, .twb-refresh:active { transform: scale(0.93); }
  .twb-title { color: oklch(0.92 0.01 85); }

  .twb-balance-card {
    position: relative; overflow: hidden;
    padding: 28px 24px; border-radius: 24px;
    background: linear-gradient(145deg, oklch(0.16 0.02 85), oklch(0.11 0.01 250));
    border: 1px solid oklch(0.82 0.06 85 / 0.15);
    box-shadow: 0 12px 40px -12px oklch(0.82 0.06 85 / 0.08);
  }
  .twb-balance-orb {
    position: absolute; border-radius: 50%; filter: blur(50px);
    animation: twb-float 6s ease-in-out infinite alternate;
  }
  .twb-orb-1 { width: 120px; height: 120px; top: -30px; right: -20px; background: oklch(0.75 0.08 85 / 0.15); }
  .twb-orb-2 { width: 80px; height: 80px; bottom: -20px; left: 10px; background: oklch(0.7 0.06 60 / 0.1); animation-delay: -3s; }
  @keyframes twb-float {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(8px, -8px) scale(1.1); }
  }

  .twb-label { color: oklch(0.65 0.03 85); }
  .twb-eye { color: oklch(0.6 0.03 85); padding: 4px; border-radius: 8px; }
  .twb-eye:active { transform: scale(0.9); }
  .twb-balance-amt {
    font-size: 34px; font-weight: 800; letter-spacing: -1px;
    margin-top: 6px;
    background: linear-gradient(135deg, oklch(0.95 0.02 85), oklch(0.82 0.06 85));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .twb-action-btn {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 12px 0; border-radius: 14px;
    font-size: 13px; font-weight: 700; border: none; cursor: pointer;
    transition: transform 120ms ease;
  }
  .twb-action-btn:active { transform: scale(0.96); }
  .twb-send {
    background: linear-gradient(135deg, oklch(0.82 0.06 85), oklch(0.72 0.05 60));
    color: oklch(0.1 0.005 250);
  }
  .twb-add {
    background: oklch(0.16 0.01 250);
    color: oklch(0.82 0.06 85);
    border: 1px solid oklch(0.82 0.06 85 / 0.25);
  }

  .twb-stat-card {
    display: flex; align-items: center; gap: 12px;
    padding: 16px; border-radius: 18px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.18 0.008 250);
  }
  .twb-stat-icon {
    width: 38px; height: 38px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
  }
  .twb-stat-green { background: oklch(0.45 0.12 145 / 0.15); color: oklch(0.7 0.14 145); }
  .twb-stat-red { background: oklch(0.45 0.12 25 / 0.15); color: oklch(0.7 0.1 25); }
  .twb-stat-label { color: oklch(0.5 0.01 250); }
  .twb-stat-val { color: oklch(0.92 0.01 250); }

  .twb-section-title { color: oklch(0.65 0.03 85); text-transform: uppercase; letter-spacing: 0.05em; }

  .twb-txn-row {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; border-radius: 16px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.16 0.005 250);
    transition: transform 120ms ease;
  }
  .twb-txn-row:active { transform: scale(0.98); }
  .twb-txn-icon {
    width: 38px; height: 38px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
  }
  .twb-txn-in { background: oklch(0.45 0.12 145 / 0.12); color: oklch(0.7 0.14 145); }
  .twb-txn-out { background: oklch(0.45 0.1 25 / 0.12); color: oklch(0.7 0.1 25); }
  .twb-txn-name { color: oklch(0.9 0.01 250); }
  .twb-txn-date { color: oklch(0.5 0.01 250); }
  .twb-amt-green { color: oklch(0.7 0.14 145); }
  .twb-amt-red { color: oklch(0.7 0.1 25); }

  .twb-empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 32px; text-align: center;
  }
  .twb-empty-icon { color: oklch(0.4 0.02 85); margin-bottom: 12px; }
  .twb-empty-text { color: oklch(0.7 0.01 250); }
  .twb-empty-sub { color: oklch(0.45 0.01 250); margin-top: 4px; }

  .twb-skel {
    display: block; border-radius: 12px;
    background: linear-gradient(110deg, oklch(0.14 0.005 250), oklch(0.19 0.015 85) 45%, oklch(0.14 0.005 250) 55%);
    background-size: 200% 100%;
    animation: twb-shimmer 1.6s ease-in-out infinite;
  }
  .twb-skel-row { height: 56px; border-radius: 16px; }
  @keyframes twb-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .twb-balance-orb { animation: none; }
    .twb-skel { animation: none; }
    @keyframes twb-float { 0%, 100% { transform: none; } }
  }
`;
