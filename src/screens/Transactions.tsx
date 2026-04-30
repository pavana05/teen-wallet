import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, RefreshCw, Inbox, Search,
  Wallet, Clock, CheckCircle2, XCircle, TrendingUp, TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import { haptics } from "@/lib/haptics";
import { TransactionDetail } from "@/components/TransactionDetail";
import { consumePendingDeepLink, type PendingDeepLink } from "@/lib/deepLink";

interface Txn {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

type FilterKind = "all" | "pending" | "complete" | "failed";

interface Props {
  onBack: () => void;
}

function isCredit(t: Txn): boolean {
  const hay = `${t.merchant_name} ${t.note ?? ""}`.toLowerCase();
  return /refund|cashback|top[-\s]?up|added|received|credit|reversal/.test(hay);
}

function fmtINR(n: number) {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtINRCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `₹${(abs / 10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000) return `₹${(abs / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(abs / 1_000).toFixed(1)}k`;
  return `₹${abs.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const enriched = useMemo(() => {
    let running = Number(balance);
    return txns.map((t) => {
      const credit = isCredit(t);
      const signed = credit ? Number(t.amount) : -Number(t.amount);
      const after = running;
      if (t.status === "success") running = running - signed;
      return { txn: t, credit, signed, balanceAfter: after };
    });
  }, [txns, balance]);

  useEffect(() => {
    const tryOpen = (link: PendingDeepLink | null) => {
      if (!link) return;
      if (link.kind === "transaction") {
        const match = enriched.find(({ txn }) => txn.id === link.transactionId);
        if (match) {
          setOpenTxn({ txn: match.txn, credit: match.credit, balanceAfter: match.balanceAfter });
          return;
        }
      }
      const fallback = enriched[0];
      if (fallback) {
        setOpenTxn({ txn: fallback.txn, credit: fallback.credit, balanceAfter: fallback.balanceAfter });
      }
    };
    tryOpen(consumePendingDeepLink());
    const handler = () => tryOpen(consumePendingDeepLink());
    window.addEventListener("tw:deeplink", handler);
    return () => window.removeEventListener("tw:deeplink", handler);
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter(({ txn }) => {
      if (filter === "pending" && txn.status !== "pending") return false;
      if (filter === "complete" && txn.status !== "success") return false;
      if (filter === "failed" && txn.status !== "failed") return false;
      if (!q) return true;
      return (
        txn.merchant_name.toLowerCase().includes(q) ||
        txn.upi_id.toLowerCase().includes(q) ||
        (txn.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [enriched, filter, query]);

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
    let credits = 0, debits = 0, pending = 0, failed = 0, complete = 0;
    for (const { txn, credit, signed } of enriched) {
      if (txn.status === "pending") pending += 1;
      if (txn.status === "failed") failed += 1;
      if (txn.status === "success") complete += 1;
      if (txn.status !== "success") continue;
      if (credit) credits += Math.abs(signed); else debits += Math.abs(signed);
    }
    return { credits, debits, pending, failed, complete };
  }, [enriched]);

  const net = totals.credits - totals.debits;

  return (
    <div className="tx-root absolute inset-0 z-[100] flex flex-col bg-background overflow-hidden tw-slide-up" role="region" aria-label="Transactions">
      {/* Layered premium backdrop — matches TransactionDetail */}
      <div className="td-bg" aria-hidden />
      <div className="td-aurora bg-gradient-to-b from-[color:var(--premium-accent-glow,rgba(212,197,160,.22))] via-white/5 to-transparent" aria-hidden />
      <div className="td-grid" aria-hidden />
      <div className="td-grain" aria-hidden />

      {/* Sticky premium header */}
      <header className="tx-header relative z-10">
        <div className="flex items-center justify-between px-5 pt-7 pb-2">
          <button
            type="button"
            onClick={() => { void haptics.tap(); onBack(); }}
            aria-label="Back"
            className="td-icon-btn"
          >
            <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
          </button>
          <h1 className="text-[13px] font-semibold text-white/85 tracking-[.18em] uppercase">
            Activity
          </h1>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={refreshing ? "Refreshing" : "Refresh"}
            className="td-icon-btn"
          >
            <RefreshCw className={`w-4 h-4 text-white ${refreshing ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="relative z-10 flex-1 overflow-y-auto pb-24 px-5 td-scroll">
        {/* === Summary hero === */}
        <section className="tx-hero td-cascade" style={{ ["--td-i" as string]: 0 }}>
          <p className="td-eyebrow">Wallet balance</p>
          <div className="td-amount-wrap mt-2">
            <span className="td-amount-sign text-white/70">₹</span>
            <span className="td-amount num-mono text-white">
              {Number(balance).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <p className="tx-net mt-3">
            <span className={net >= 0 ? "tx-net-pos" : "tx-net-neg"}>
              {net >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {net >= 0 ? "+" : "−"}{fmtINR(Math.abs(net))}
            </span>
            <span className="text-white/45"> · net across {totals.complete} completed</span>
          </p>
        </section>

        {/* === Stat tiles === */}
        <section className="grid grid-cols-2 gap-2.5 mt-5 td-cascade" style={{ ["--td-i" as string]: 1 }}>
          <StatTile
            icon={ArrowUpRight}
            label="Money in"
            value={fmtINRCompact(totals.credits)}
            tone="credit"
          />
          <StatTile
            icon={ArrowDownLeft}
            label="Money out"
            value={fmtINRCompact(totals.debits)}
            tone="debit"
          />
          <StatTile
            icon={Clock}
            label="Pending"
            value={String(totals.pending)}
            tone="pending"
          />
          <StatTile
            icon={Wallet}
            label="Total"
            value={String(enriched.length)}
            tone="neutral"
          />
        </section>

        {/* === Search === */}
        <div className="mt-5 td-cascade" style={{ ["--td-i" as string]: 2 }}>
          <label className="tx-search">
            <Search className="w-3.5 h-3.5 text-white/45" aria-hidden />
            <input
              type="search"
              inputMode="search"
              placeholder="Search merchant, UPI ID, or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search transactions"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="tx-search-clear"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
        </div>

        {/* === Segmented filter === */}
        <div
          className="tx-seg mt-3 td-cascade"
          style={{ ["--td-i" as string]: 3 }}
          role="tablist"
          aria-label="Status filter"
        >
          <SegBtn active={filter === "all"} onClick={() => { setFilter("all"); void haptics.select(); }} count={enriched.length}>All</SegBtn>
          <SegBtn active={filter === "complete"} onClick={() => { setFilter("complete"); void haptics.select(); }} count={totals.complete}>Complete</SegBtn>
          <SegBtn active={filter === "pending"} onClick={() => { setFilter("pending"); void haptics.select(); }} count={totals.pending}>Pending</SegBtn>
          <SegBtn active={filter === "failed"} onClick={() => { setFilter("failed"); void haptics.select(); }} count={totals.failed}>Failed</SegBtn>
        </div>

        {/* === List === */}
        <div className="mt-5 td-cascade" style={{ ["--td-i" as string]: 4 }}>
          {loading ? (
            <div className="space-y-2.5" aria-hidden>
              {[0,1,2,3,4].map((i) => <div key={i} className="tx-skeleton" />)}
            </div>
          ) : error ? (
            <div role="alert" className="tx-empty">
              <div className="tx-empty-illu"><RefreshCw className="w-7 h-7 text-white/85" strokeWidth={1.6} /></div>
              <p className="tx-empty-title">Couldn't load transactions</p>
              <p className="tx-empty-sub">{error}</p>
              <button type="button" onClick={() => { setLoading(true); void fetchAll(); }} className="tx-cta">
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} /> Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="tx-empty">
              <div className="tx-empty-illu"><Inbox className="w-7 h-7 text-white/85" strokeWidth={1.6} /></div>
              <p className="tx-empty-title">
                {query ? "No matches" : filter === "pending" ? "Nothing pending"
                  : filter === "complete" ? "No completed payments"
                  : filter === "failed" ? "No failed payments"
                  : "No transactions"}
              </p>
              <p className="tx-empty-sub">
                {query ? "Try a different merchant, UPI ID, or note."
                  : filter === "all" ? "Start by scanning a QR or sending money — your activity will land here."
                  : "Switch filter to see other transactions."}
              </p>
            </div>
          ) : (
            <ol className="space-y-6" aria-label="Grouped transactions">
              {groups.map(([day, rows]) => {
                const daySpend = rows.reduce((acc, r) =>
                  r.txn.status === "success" && !r.credit ? acc + Number(r.txn.amount) : acc, 0);
                return (
                  <li key={day}>
                    <div className="flex items-baseline justify-between px-1 mb-2.5">
                      <p className="tx-day">{day}</p>
                      {daySpend > 0 && (
                        <p className="tx-day-total num-mono">−{fmtINR(daySpend)}</p>
                      )}
                    </div>
                    <div className="tx-group">
                      {rows.map(({ txn, credit, balanceAfter }, idx) => (
                        <TxnRowPremium
                          key={txn.id}
                          txn={txn}
                          credit={credit}
                          balanceAfter={balanceAfter}
                          first={idx === 0}
                          last={idx === rows.length - 1}
                          onOpen={() => { void haptics.tap(); setOpenTxn({ txn, credit, balanceAfter }); }}
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {openTxn && (
        <TransactionDetail
          txn={openTxn.txn}
          credit={openTxn.credit}
          balanceAfter={openTxn.balanceAfter}
          onClose={() => setOpenTxn(null)}
        />
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string; value: string;
  tone: "neutral" | "credit" | "debit" | "pending";
}) {
  return (
    <div className={`tx-stat tx-stat-${tone}`}>
      <div className="tx-stat-icon">
        <Icon className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />
      </div>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="tx-stat-label">{label}</span>
        <span className="tx-stat-value num-mono">{value}</span>
      </div>
    </div>
  );
}

function SegBtn({
  children, active, onClick, count,
}: {
  children: React.ReactNode; active: boolean; onClick: () => void; count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`tx-seg-btn ${active ? "tx-seg-on" : ""}`}
    >
      <span>{children}</span>
      <span className="tx-seg-count num-mono">{count}</span>
    </button>
  );
}

function TxnRowPremium({
  txn, credit, balanceAfter, first, last, onOpen,
}: {
  txn: Txn; credit: boolean; balanceAfter: number;
  first: boolean; last: boolean; onOpen: () => void;
}) {
  const d = new Date(txn.created_at);
  const sign = credit ? "+" : "−";
  const StatusIcon = txn.status === "success" ? CheckCircle2 : txn.status === "pending" ? Clock : XCircle;
  const failed = txn.status === "failed";

  const initials = (() => {
    const parts = txn.merchant_name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "•";
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  })();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`tx-row ${first ? "tx-row-first" : ""} ${last ? "tx-row-last" : ""}`}
      aria-label={`${credit ? "Credit" : "Debit"} ${sign}${fmtINR(txn.amount)} ${credit ? "from" : "to"} ${txn.merchant_name}, status ${txn.status}.`}
    >
      <div className={`tx-avatar ${credit ? "tx-avatar-credit" : failed ? "tx-avatar-failed" : "tx-avatar-debit"}`} aria-hidden>
        <span className="tx-avatar-initials">{initials}</span>
        <span className={`tx-avatar-dir ${credit ? "tx-dir-credit" : failed ? "tx-dir-failed" : "tx-dir-debit"}`}>
          {credit
            ? <ArrowUpRight className="w-2.5 h-2.5" strokeWidth={3} />
            : <ArrowDownLeft className="w-2.5 h-2.5" strokeWidth={3} />}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="tx-row-name">{txn.merchant_name}</p>
          <span className={`tx-row-pill tx-pill-${txn.status}`}>
            <StatusIcon className="w-2.5 h-2.5" strokeWidth={2.4} />
            {txn.status}
          </span>
        </div>
        <p className="tx-row-sub">
          {txn.note ? txn.note : txn.upi_id} · {fmtTime(d)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`tx-row-amount num-mono ${
          credit ? "tx-amt-credit" : failed ? "tx-amt-failed" : "tx-amt-debit"
        }`}>
          {sign}{fmtINR(txn.amount)}
        </p>
        <p className="tx-row-bal num-mono">Bal {fmtINR(balanceAfter)}</p>
      </div>
    </button>
  );
}
