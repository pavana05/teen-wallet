import { Bell, Home as HomeIcon, ScanLine, ShoppingBag, CreditCard, ArrowUpRight, Building2, Wallet, History, Plus, ArrowDownLeft, SlidersHorizontal } from "lucide-react";
import { useApp } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { ScanPay } from "@/screens/ScanPay";

type Txn = Tables<"transactions">;
type StatusFilter = "all" | "success" | "pending" | "failed";

export function Home() {
  const { fullName, balance, userId } = useApp();
  const first = fullName?.split(" ")[0] ?? "Friend";
  const [view, setView] = useState<"home" | "scan">("home");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [minAmt, setMinAmt] = useState<string>("");
  const [maxAmt, setMaxAmt] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  const loadTxns = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setTxns(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadTxns();
    if (!userId) return;
    const ch = supabase
      .channel("txns")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` }, () => loadTxns())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const filtered = useMemo(() => {
    const min = minAmt ? Number(minAmt) : null;
    const max = maxAmt ? Number(maxAmt) : null;
    return txns.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      const amt = Number(t.amount);
      if (min !== null && amt < min) return false;
      if (max !== null && amt > max) return false;
      return true;
    });
  }, [txns, status, minAmt, maxAmt]);

  if (view === "scan") return <ScanPay onBack={() => { setView("home"); loadTxns(); }} />;

  return (
    <div className="flex-1 flex flex-col tw-slide-up pb-28">
      {/* Header */}
      <div className="px-6 pt-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-white">Hey, {first} 👋</p>
          <p className="text-xs text-muted-foreground">Good to see you back!</p>
        </div>
        <button className="w-10 h-10 rounded-full glass flex items-center justify-center relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full" />
        </button>
      </div>

      {/* Wallet Card */}
      <div className="px-6 mt-6">
        <div className="relative rounded-3xl p-6 overflow-hidden lime-glow"
          style={{ background: "linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-30" style={{ background: "var(--color-primary)" }} />
          <div className="relative flex items-start justify-between">
            <span className="text-[10px] tracking-[0.3em] text-white/60 font-light">TEEN WALLET</span>
            <span className="text-xs text-white/80">{first}</span>
          </div>
          <div className="relative mt-8">
            <p className="text-[11px] text-muted-foreground">Available balance</p>
            <p className="text-4xl font-bold num-mono mt-1 text-white">
              ₹ {balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="relative mt-8 flex items-end justify-between">
            <span className="text-xs text-white/70 num-mono tracking-widest">**** **** **** 4521</span>
            <span className="text-[10px] text-white/60 tracking-widest">VIRTUAL · RUPAY</span>
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button className="btn-ghost flex-1"><Plus className="w-4 h-4" /> Add Money</button>
          <button className="btn-ghost flex-1"><ArrowDownLeft className="w-4 h-4" /> Withdraw</button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-6 mt-8">
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: ScanLine, label: "Scan & Pay", primary: true, onClick: () => setView("scan") },
            { icon: ArrowUpRight, label: "Send" },
            { icon: Building2, label: "To Bank" },
            { icon: History, label: "History" },
          ].map(({ icon: Icon, label, primary, onClick }) => (
            <button key={label} onClick={onClick} className="flex flex-col items-center gap-2">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${primary ? "bg-primary text-primary-foreground lime-glow" : "glass"}`}>
                <Icon className="w-6 h-6" strokeWidth={primary ? 2.4 : 1.6} />
              </div>
              <span className="text-[11px] text-center text-muted-foreground leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Activity */}
      <div className="px-6 mt-8 flex-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">Recent Activity</h3>
          <button onClick={() => setShowFilters((s) => !s)} className="flex items-center gap-1 text-xs text-primary">
            <SlidersHorizontal className="w-3.5 h-3.5" /> {showFilters ? "Hide" : "Filter"}
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="glass rounded-2xl p-3 mb-3 space-y-3 tw-slide-up">
            <div className="flex gap-2 overflow-x-auto">
              {(["all","success","pending","failed"] as StatusFilter[]).map((s) => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-full text-[11px] capitalize whitespace-nowrap border ${
                    status === s ? "bg-primary text-primary-foreground border-primary" : "border-white/10 text-muted-foreground"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={minAmt} onChange={(e) => setMinAmt(e.target.value.replace(/[^0-9]/g,""))} placeholder="Min ₹" className="tw-input text-xs flex-1" inputMode="numeric" />
              <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value.replace(/[^0-9]/g,""))} placeholder="Max ₹" className="tw-input text-xs flex-1" inputMode="numeric" />
              {(minAmt || maxAmt || status !== "all") && (
                <button onClick={() => { setMinAmt(""); setMaxAmt(""); setStatus("all"); }} className="text-[11px] text-primary px-2">Clear</button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0,1,2].map((i) => <div key={i} className="h-16 rounded-2xl tw-shimmer" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-3xl p-8 text-center">
            <Wallet className="w-10 h-10 mx-auto text-muted-foreground mb-3" strokeWidth={1.4} />
            <p className="text-sm text-white">{txns.length === 0 ? "No transactions yet" : "No matches"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {txns.length === 0 ? "Make your first payment to see it here." : "Try clearing the filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => (
              <div key={t.id} className="glass rounded-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold text-xs shrink-0">
                  {t.merchant_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{t.merchant_name}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm num-mono ${t.status === "failed" ? "text-muted-foreground line-through" : "text-destructive"}`}>
                    −₹{Number(t.amount).toFixed(2)}
                  </p>
                  <span className={`text-[9px] uppercase tracking-wide ${
                    t.status === "success" ? "text-primary" : t.status === "pending" ? "text-yellow-400" : "text-destructive"
                  }`}>{t.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating bottom nav */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[400px] z-50">
        <div className="flex items-center gap-2">
          <div className="flex-1 glass rounded-full px-2 py-2 flex items-center justify-around">
            {[
              { icon: HomeIcon, label: "Home", active: true },
              { icon: ShoppingBag, label: "Shop" },
              { icon: CreditCard, label: "Card" },
            ].map(({ icon: Icon, label, active }) => (
              <button key={label} className={`flex flex-col items-center px-5 py-1 rounded-full ${active ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className="w-5 h-5" />
                <span className="text-[10px] mt-0.5">{label}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setView("scan")} className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center lime-glow shadow-lg">
            <ScanLine className="w-6 h-6" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
