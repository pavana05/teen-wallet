import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, RefreshCw, Inbox, Search, Filter,
  Wallet, Clock, CheckCircle2, XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import { haptics } from "@/lib/haptics";
import { TransactionDetail } from "@/components/TransactionDetail";

interface Txn {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

type FilterKind = "all" | "pending" | "complete";

interface Props {
  onBack: () => void;
}

/** Heuristic: classify a transaction row as credit or debit without a schema change.
 *  Real PSP integrations would set a `direction` column; for now we infer from
 *  the merchant/note strings (refunds, cashback, wallet top-ups are credits). */
function isCredit(t: Txn): boolean {
  const hay = `${t.merchant_name} ${t.note ?? ""}`.toLowerCase();
  return /refund|cashback|top[-\s]?up|added|received|credit|reversal/.test(hay);
}

function fmtINR(n: number) {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateGroup(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === yest.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function Transactions({ onBack }: Props) {
  const { userId, balance } = useApp();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [query, setQuery] = useState("");
  const [openTxn, setOpenTxn] = useState<{ txn: Txn; credit: boolean; balanceAfter: number } | null>(null);

  const fetchAll = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const { data, error: err } = await supabase
      .from("transactions")
      .select("id,amount,merchant_name,upi_id,note,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (err) setError(err.message);
    else { setError(null); setTxns((data ?? []) as Txn[]); }
    setLoading(false);
  }, [userId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Realtime: any new transaction or status change refreshes the list.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("txns-screen")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` },
        () => { void fetchAll(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    void haptics.swipe();
    await fetchAll();
    setTimeout(() => setRefreshing(false), 400);
  }, [fetchAll]);

  // Compute running balance walking BACKWARDS from current balance.
  // current balance reflects state AFTER all successful transactions, so:
  //   balanceAfter[latest] = current
  //   balanceAfter[prev]   = current - (signedAmount of latest if successful)
  const enriched = useMemo(() => {
    // chronologically newest first already; we'll set running balance after each row.
    let running = Number(balance);
    return txns.map((t) => {
      const credit = isCredit(t);
      const signed = credit ? Number(t.amount) : -Number(t.amount);
      const after = running;
      // Only successful transactions actually moved the balance.
      if (t.status === "success") running = running - signed;
      return { txn: t, credit, signed, balanceAfter: after };
    });
  }, [txns, balance]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter(({ txn }) => {
      if (filter === "pending" && txn.status !== "pending") return false;
      if (filter === "complete" && txn.status !== "success") return false;
      if (!q) return true;
      return (
        txn.merchant_name.toLowerCase().includes(q) ||
        txn.upi_id.toLowerCase().includes(q) ||
        (txn.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [enriched, filter, query]);

  // Group by date for sticky-style headers.
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const key = fmtDateGroup(new Date(row.txn.created_at));
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totals = useMemo(() => {
    let credits = 0, debits = 0, pending = 0;
    for (const { txn, credit, signed } of enriched) {
      if (txn.status === "pending") pending += 1;
      if (txn.status !== "success") continue;
      if (credit) credits += Math.abs(signed); else debits += Math.abs(signed);
    }
    return { credits, debits, pending };
  }, [enriched]);

  return (
    <div className="hp-root flex-1 flex flex-col tw-slide-up overflow-y-auto pb-20" role="region" aria-label="Transactions">
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <button
            type="button"
            onClick={() => { void haptics.tap(); onBack(); }}
            aria-label="Back"
            className="qa-icon-btn"
          >
            <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
          </button>
          <h1 className="text-[15px] font-semibold text-white tracking-tight">Transactions</h1>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={refreshing ? "Refreshing" : "Refresh"}
            className="qa-icon-btn"
          >
            <RefreshCw className={`w-4 h-4 text-white ${refreshing ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        </div>

        {/* Summary pills */}
        <div className="px-5 pb-3 flex items-center gap-2 overflow-x-auto hp-scroll">
          <SummaryPill icon={Wallet} label="Balance" value={fmtINR(Number(balance))} tone="neutral" />
          <SummaryPill icon={ArrowDownLeft} label="Debits" value={fmtINR(totals.debits)} tone="debit" />
          <SummaryPill icon={ArrowUpRight} label="Credits" value={fmtINR(totals.credits)} tone="credit" />
          {totals.pending > 0 && (
            <SummaryPill icon={Clock} label="Pending" value={String(totals.pending)} tone="pending" />
          )}
        </div>

        {/* Search + filter */}
        <div className="px-5 pb-3 flex items-center gap-2">
          <label className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" aria-hidden />
            <input
              type="search"
              inputMode="search"
              placeholder="Search merchant, UPI, note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-full bg-white/5 border border-white/10 text-[12.5px] text-white placeholder:text-white/35 focus:outline-none focus:border-primary/60"
              aria-label="Search transactions"
            />
          </label>
        </div>
        <div className="px-5 pb-3 flex items-center gap-2" role="tablist" aria-label="Status filter">
          <FilterChip active={filter === "all"} onClick={() => { setFilter("all"); void haptics.select(); }}>
            <Filter className="w-3 h-3" /> All
            <span className="ml-1 text-[10px] text-white/55 num-mono">{enriched.length}</span>
          </FilterChip>
          <FilterChip active={filter === "complete"} onClick={() => { setFilter("complete"); void haptics.select(); }}>
            <CheckCircle2 className="w-3 h-3" /> Complete
            <span className="ml-1 text-[10px] text-white/55 num-mono">
              {enriched.filter((e) => e.txn.status === "success").length}
            </span>
          </FilterChip>
          <FilterChip active={filter === "pending"} onClick={() => { setFilter("pending"); void haptics.select(); }}>
            <Clock className="w-3 h-3" /> Pending
            <span className="ml-1 text-[10px] text-white/55 num-mono">{totals.pending}</span>
          </FilterChip>
        </div>
      </header>

      {/* Body */}
      <div className="px-5 pt-4">
        {loading ? (
          <div className="space-y-2" aria-hidden>
            {[0,1,2,3,4].map((i) => <div key={i} className="hp-skeleton-row" />)}
          </div>
        ) : error ? (
          <div role="alert" className="hp-empty">
            <div className="hp-empty-illu"><RefreshCw className="w-7 h-7 text-white/85" strokeWidth={1.6} /></div>
            <p className="hp-empty-title">Couldn't load transactions</p>
            <p className="hp-empty-sub">{error}</p>
            <button type="button" onClick={() => { setLoading(true); void fetchAll(); }} className="hp-cta-pill">
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} /> Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="hp-empty">
            <div className="hp-empty-illu"><Inbox className="w-7 h-7 text-white/85" strokeWidth={1.6} /></div>
            <p className="hp-empty-title">No transactions</p>
            <p className="hp-empty-sub">
              {filter === "pending" ? "No payments are currently being processed."
                : filter === "complete" ? "You haven't completed any payments yet."
                : "Start by scanning a QR or sending money — your activity will land here."}
            </p>
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Grouped transactions">
            {groups.map(([day, rows]) => (
              <li key={day}>
                <p className="text-[10.5px] uppercase tracking-[.18em] text-white/45 font-semibold px-1 mb-2">{day}</p>
                <div className="space-y-2">
                  {rows.map(({ txn, credit, balanceAfter }) => (
                    <TxnDetailRow
                      key={txn.id}
                      txn={txn}
                      credit={credit}
                      balanceAfter={balanceAfter}
                      onOpen={() => { void haptics.tap(); setOpenTxn({ txn, credit, balanceAfter }); }}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function SummaryPill({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string; value: string;
  tone: "neutral" | "credit" | "debit" | "pending";
}) {
  const map = {
    neutral: "text-white/85 border-white/10 bg-white/5",
    credit: "text-emerald-300 border-emerald-400/25 bg-emerald-400/10",
    debit: "text-orange-200 border-orange-400/25 bg-orange-400/10",
    pending: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  } as const;
  return (
    <div className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-2xl border ${map[tone]}`}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
      <div className="flex flex-col leading-tight">
        <span className="text-[9.5px] uppercase tracking-wider text-white/55">{label}</span>
        <span className="text-[12.5px] font-semibold num-mono">{value}</span>
      </div>
    </div>
  );
}

function FilterChip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-colors border ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-[0_0_0_1px_var(--primary)]"
          : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function TxnDetailRow({
  txn, credit, balanceAfter, onOpen,
}: { txn: Txn; credit: boolean; balanceAfter: number; onOpen: () => void }) {
  const d = new Date(txn.created_at);
  const sign = credit ? "+" : "−";
  const StatusIcon = txn.status === "success" ? CheckCircle2 : txn.status === "pending" ? Clock : XCircle;
  const statusTone =
    txn.status === "success" ? "text-emerald-300" :
    txn.status === "pending" ? "text-amber-300" :
    "text-red-300";
  const failed = txn.status === "failed";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="hp-row w-full text-left transition-transform active:scale-[.99]"
      aria-label={`${credit ? "Credit" : "Debit"} ${sign}${fmtINR(txn.amount)} ${credit ? "from" : "to"} ${txn.merchant_name}, status ${txn.status}. View details.`}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
          credit ? "bg-emerald-400/15" : failed ? "bg-destructive/15" : "bg-primary/15"
        }`}
        aria-hidden
      >
        {credit
          ? <ArrowUpRight className="w-5 h-5 text-emerald-300" strokeWidth={2} />
          : <ArrowDownLeft className={`w-5 h-5 ${failed ? "text-destructive" : "text-primary"}`} strokeWidth={2} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-white truncate">{txn.merchant_name}</p>
          <span className={`inline-flex items-center gap-1 text-[9.5px] uppercase tracking-wider ${statusTone}`}>
            <StatusIcon className="w-2.5 h-2.5" strokeWidth={2.4} />
            {txn.status}
          </span>
        </div>
        <p className="text-[11px] text-white/50 truncate">
          {txn.note ? txn.note : txn.upi_id} · {fmtTime(d)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-[14px] font-semibold num-mono ${
          credit ? "text-emerald-300" : failed ? "text-destructive line-through" : "text-white"
        }`}>
          {sign}{fmtINR(txn.amount)}
        </p>
        <p className="text-[10px] text-white/45 num-mono">
          Bal {fmtINR(balanceAfter)}
        </p>
      </div>
    </button>
  );
}
