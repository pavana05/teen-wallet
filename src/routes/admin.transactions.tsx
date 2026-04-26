import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Search, AlertTriangle, RotateCcw, ShieldCheck, Lock } from "lucide-react";
import { VirtualTable, type Column } from "@/admin/components/VirtualTable";
import { usePersistedState } from "@/admin/lib/usePersistedState";
import { recordPanelLoad, recordRealtime } from "@/admin/lib/perfBus";
import { PermissionBanner, ErrorState } from "@/admin/components/AdminFeedback";

export const Route = createFileRoute("/admin/transactions")({
  component: TransactionsList,
});

interface TxnRow {
  id: string;
  user_id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  status: "success" | "pending" | "failed";
  fraud_flags: any;
  note: string | null;
  created_at: string;
  profile: { full_name: string | null; phone: string | null } | null;
}

const STATUS_BADGE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

function fmtINR(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Filters {
  search: string;
  status: string;
  flagged: boolean;
  minAmount: string;
  maxAmount: string;
}
const PAGE_SIZE = 50;

function TransactionsList() {
  const admin = useMemo(() => readAdminSession()?.admin, []);
  const [filters, setFilters] = usePersistedState<Filters>("tw_admin_txns_v2", {
    search: "", status: "", flagged: false, minAmount: "", maxAmount: "",
  });
  const [searchInput, setSearchInput] = useState(filters.search);
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  const [rows, setRows] = useState<TxnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageVolume, setPageVolume] = useState(0);
  const [pageSuccess, setPageSuccess] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<TxnRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversePassword, setReversePassword] = useState("");
  const [stepUpVerified, setStepUpVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState("");

  const canManage = can(admin?.role, "manageTransactions");
  const canView = can(admin?.role, "viewTransactions") || canManage;

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      setFilters((f) => ({ ...f, search: debouncedSearch }));
    }
  }, [debouncedSearch, filters.search, setFilters]);

  const reqId = useRef(0);
  const fetchPage = useCallback(async (pageNum: number) => {
    const s = readAdminSession(); if (!s) return;
    const myReq = ++reqId.current;
    if (pageNum === 1) setInitialLoading(true);
    else setLoadingMore(true);
    const t0 = performance.now();
    try {
      const r = await callAdminFn<{ rows: TxnRow[]; total: number; pageVolume: number; pageSuccess: number }>({
        action: "transactions_list", sessionToken: s.sessionToken,
        search: filters.search, status: filters.status, flagged: filters.flagged,
        minAmount: filters.minAmount ? Number(filters.minAmount) : 0,
        maxAmount: filters.maxAmount ? Number(filters.maxAmount) : 0,
        page: pageNum, pageSize: PAGE_SIZE,
      });
      if (myReq !== reqId.current) return;
      setTotal(r.total);
      setHasMore(pageNum * PAGE_SIZE < r.total);
      setRows((prev) => pageNum === 1 ? r.rows : [...prev, ...r.rows]);
      if (pageNum === 1) { setPageVolume(r.pageVolume); setPageSuccess(r.pageSuccess); }
      setErr("");
      recordPanelLoad("Transactions · list", performance.now() - t0);
    } catch (e: any) {
      if (myReq === reqId.current) setErr(e.message || "Failed to load");
    } finally {
      if (myReq === reqId.current) { setInitialLoading(false); setLoadingMore(false); }
    }
  }, [filters.search, filters.status, filters.flagged, filters.minAmount, filters.maxAmount]);

  useEffect(() => { setPage(1); void fetchPage(1); }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || initialLoading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    void fetchPage(next);
  }, [page, hasMore, loadingMore, initialLoading, fetchPage]);

  // Realtime — throttled
  const lastRT = useRef(0);
  useEffect(() => {
    const throttled = () => {
      recordRealtime();
      const now = Date.now();
      if (now - lastRT.current < 3000) return;
      lastRT.current = now;
      setPage(1); void fetchPage(1);
    };
    const ch = supabase.channel("admin_txns")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, throttled)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchPage]);

  function closeReverseModal() {
    setReversing(null);
    setReverseReason("");
    setReversePassword("");
    setStepUpVerified(false);
    setErr("");
  }

  async function verifyStepUp() {
    if (!reversePassword) { setErr("Password required"); return; }
    setVerifying(true); setErr("");
    try {
      await callAdminFn({ action: "login_password", email: admin?.email, password: reversePassword });
      setStepUpVerified(true);
    } catch (e: any) {
      setStepUpVerified(false);
      setErr(e?.message || "Step-up verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function commitReverse() {
    if (!reversing) return;
    const s = readAdminSession(); if (!s) return;
    if (!stepUpVerified) { setErr("Re-verify your password before mutating"); return; }
    if (!reverseReason.trim()) { setErr("Reason required"); return; }
    setBusyId(reversing.id); setErr("");
    try {
      await callAdminFn({ action: "transaction_reverse", sessionToken: s.sessionToken, txnId: reversing.id, reason: reverseReason });
      closeReverseModal();
      setPage(1); await fetchPage(1);
    } catch (e: any) { setErr(e.message || "Reverse failed"); }
    finally { setBusyId(null); }
  }

  const columns: Column<TxnRow>[] = useMemo(() => [
    { key: "id", header: "Txn ID", width: "100px", cell: (r) => <span className="a-mono">{r.id.slice(0, 8)}…</span> },
    {
      key: "user", header: "User", width: "1.5fr",
      cell: (r) => (
        <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-fg)", textDecoration: "none" }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.profile?.full_name || "—"}</div>
          <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.profile?.phone || r.user_id.slice(0, 8) + "…"}</div>
        </Link>
      ),
    },
    { key: "amt", header: "Amount", width: "120px", align: "right", cell: (r) => <span className="a-mono">₹{fmtINR(Number(r.amount))}</span> },
    {
      key: "merchant", header: "Merchant", width: "1.4fr",
      cell: (r) => {
        const flags = Array.isArray(r.fraud_flags) ? r.fraud_flags : [];
        return (
          <span>
            {r.merchant_name}
            {flags.length > 0 && <AlertTriangle size={12} style={{ display: "inline-block", marginLeft: 6, color: "#f59e0b", verticalAlign: "-2px" }} />}
          </span>
        );
      },
    },
    { key: "upi", header: "UPI", width: "1.4fr", cell: (r) => <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.upi_id}</span> },
    {
      key: "status", header: "Status", width: "100px",
      cell: (r) => <span className={STATUS_BADGE[r.status]} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>{r.status}</span>,
    },
    { key: "time", header: "Time", width: "1.2fr", cell: (r) => <span style={{ color: "var(--a-muted)", fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</span> },
    {
      key: "act", header: "Actions", width: "110px", align: "right",
      cell: (r) => canManage && r.status !== "failed"
        ? <button className="a-btn-ghost" onClick={() => setReversing(r)}><RotateCcw size={12} /> Reverse</button>
        : null,
    },
  ], [canManage]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Transactions</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            {total} total · showing {rows.length} · Vol <span className="a-mono">₹{fmtINR(pageVolume)}</span> · {pageSuccess} ok
          </p>
        </div>
        <button onClick={() => { setPage(1); void fetchPage(1); }} className="a-btn-ghost"><RefreshCw size={14} /> Refresh</button>
      </div>

      <PermissionBanner
        canView={canView}
        canDecide={canManage}
        decideLabel="reverse"
        resourceLabel="transactions"
      />

      <div className="a-surface" style={{ padding: 16, marginBottom: 12, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Search</div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--a-muted)" }} />
            <input className="a-input" style={{ paddingLeft: 30 }} placeholder="Merchant, UPI ID, user ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Status</div>
          <select className="a-input" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Min ₹</div>
          <input className="a-input" type="number" value={filters.minAmount} onChange={(e) => setFilters((f) => ({ ...f, minAmount: e.target.value }))} />
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Max ₹</div>
          <input className="a-input" type="number" value={filters.maxAmount} onChange={(e) => setFilters((f) => ({ ...f, maxAmount: e.target.value }))} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--a-muted)", cursor: "pointer", paddingBottom: 8 }}>
          <input type="checkbox" checked={filters.flagged} onChange={(e) => setFilters((f) => ({ ...f, flagged: e.target.checked }))} />
          Flagged only
        </label>
      </div>

      <ErrorState
        error={err && !reversing ? err : null}
        retrying={initialLoading}
        onRetry={() => { setPage(1); void fetchPage(1); }}
      />

      <VirtualTable<TxnRow>
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        rowStyle={(r) => {
          const flags = Array.isArray(r.fraud_flags) ? r.fraud_flags : [];
          const borderColor = flags.length > 0 ? "#f59e0b" : r.status === "failed" ? "#ef4444" : "transparent";
          return { borderLeft: `3px solid ${borderColor}` };
        }}
        height={620}
        rowHeight={60}
        initialLoading={initialLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        empty="No transactions match."
      />

      {reversing && (
        <div onClick={() => !busyId && setReversing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 480, width: "100%", padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Reverse transaction</h2>
            <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 16 }}>
              ₹{fmtINR(Number(reversing.amount))} • {reversing.merchant_name} • <span className="a-mono" style={{ fontSize: 11 }}>{reversing.id.slice(0, 8)}…</span>
            </p>
            <div style={{ marginBottom: 12 }}>
              <div className="a-label" style={{ marginBottom: 6 }}>Reason (audit logged)</div>
              <textarea className="a-input" rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g. duplicate charge, disputed by user…" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div className="a-label" style={{ marginBottom: 6 }}>Confirm with your password</div>
              <input className="a-input" type="password" value={reversePassword} onChange={(e) => setReversePassword(e.target.value)} placeholder="Step-up auth" />
            </div>
            {err && <div style={{ marginBottom: 12, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="a-btn-ghost" disabled={!!busyId} onClick={() => { setReversing(null); setReverseReason(""); setReversePassword(""); setErr(""); }}>Cancel</button>
              <button className="a-btn" style={{ background: "#ef4444", color: "white" }} disabled={!!busyId || !reverseReason || !reversePassword} onClick={() => void reverse()}>
                {busyId ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Confirm reverse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
