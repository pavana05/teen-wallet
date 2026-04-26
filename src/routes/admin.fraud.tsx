import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, ShieldAlert, Check, AlertTriangle } from "lucide-react";
import { VirtualTable, type Column } from "@/admin/components/VirtualTable";
import { usePersistedState } from "@/admin/lib/usePersistedState";
import { SavedViewsBar } from "@/admin/components/SavedViewsBar";
import { recordPanelLoad, recordRealtime } from "@/admin/lib/perfBus";

export const Route = createFileRoute("/admin/fraud")({
  component: FraudPage,
});

interface FraudRow {
  id: string;
  user_id: string;
  transaction_id: string | null;
  rule_triggered: string;
  resolution: string | null;
  created_at: string;
  profile: { full_name: string | null; phone: string | null } | null;
  transaction: { amount: number; merchant_name: string; upi_id: string; status: string } | null;
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Filters { status: "open" | "resolved" | "all"; rule: string; }
const PAGE_SIZE = 50;

function FraudPage() {
  const admin = useMemo(() => readAdminSession()?.admin, []);
  const [filters, setFilters] = usePersistedState<Filters>("tw_admin_fraud_v2", { status: "open", rule: "" });

  const [rows, setRows] = useState<FraudRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openByRule, setOpenByRule] = useState<Record<string, number>>({});
  const [openTotal, setOpenTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [resolving, setResolving] = useState<FraudRow | null>(null);
  const [resolution, setResolution] = useState("");

  const canManage = can(admin?.role, "manageFraud" as any);

  const reqId = useRef(0);
  const fetchPage = useCallback(async (pageNum: number) => {
    const s = readAdminSession(); if (!s) return;
    const myReq = ++reqId.current;
    if (pageNum === 1) setInitialLoading(true);
    else setLoadingMore(true);
    const t0 = performance.now();
    try {
      const r = await callAdminFn<{ rows: FraudRow[]; total: number; openByRule: Record<string, number>; openTotal: number }>({
        action: "fraud_list", sessionToken: s.sessionToken,
        status: filters.status, rule: filters.rule, page: pageNum, pageSize: PAGE_SIZE,
      });
      if (myReq !== reqId.current) return;
      setTotal(r.total);
      setHasMore(pageNum * PAGE_SIZE < r.total);
      setRows((prev) => pageNum === 1 ? r.rows : [...prev, ...r.rows]);
      if (pageNum === 1) { setOpenByRule(r.openByRule); setOpenTotal(r.openTotal); }
      setErr("");
      recordPanelLoad("Fraud · list", performance.now() - t0);
    } catch (e: any) { if (myReq === reqId.current) setErr(e.message || "Failed"); }
    finally { if (myReq === reqId.current) { setInitialLoading(false); setLoadingMore(false); } }
  }, [filters.status, filters.rule]);

  useEffect(() => { setPage(1); void fetchPage(1); }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || initialLoading || !hasMore) return;
    const next = page + 1;
    setPage(next); void fetchPage(next);
  }, [page, hasMore, loadingMore, initialLoading, fetchPage]);

  const lastRT = useRef(0);
  useEffect(() => {
    const throttled = () => {
      recordRealtime();
      const now = Date.now();
      if (now - lastRT.current < 3000) return;
      lastRT.current = now;
      setPage(1); void fetchPage(1);
    };
    const ch = supabase.channel("admin_fraud")
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_logs" }, throttled)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchPage]);

  async function resolve() {
    if (!resolving || !resolution.trim()) return;
    const s = readAdminSession(); if (!s) return;
    setBusyId(resolving.id); setErr("");
    try {
      await callAdminFn({ action: "fraud_resolve", sessionToken: s.sessionToken, id: resolving.id, resolution });
      setResolving(null); setResolution("");
      setPage(1); await fetchPage(1);
    } catch (e: any) { setErr(e.message || "Resolve failed"); }
    finally { setBusyId(null); }
  }

  const ruleNames = Object.keys(openByRule);

  const columns: Column<FraudRow>[] = useMemo(() => [
    {
      key: "rule", header: "Rule", width: "1.4fr",
      cell: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ShieldAlert size={14} style={{ color: r.resolution ? "var(--a-muted)" : "var(--a-warn)" }} />
          <span className="a-mono" style={{ fontSize: 12 }}>{r.rule_triggered}</span>
        </div>
      ),
    },
    {
      key: "user", header: "User", width: "1.4fr",
      cell: (r) => (
        <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-fg)", textDecoration: "none" }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.profile?.full_name || "—"}</div>
          <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.profile?.phone || r.user_id.slice(0, 8) + "…"}</div>
        </Link>
      ),
    },
    {
      key: "txn", header: "Transaction", width: "1.3fr",
      cell: (r) => r.transaction ? (
        <div>
          <div className="a-mono" style={{ fontSize: 12 }}>₹{Number(r.transaction.amount).toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "var(--a-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.transaction.merchant_name}</div>
        </div>
      ) : <span style={{ color: "var(--a-muted)", fontSize: 12 }}>—</span>,
    },
    { key: "time", header: "Triggered", width: "120px", cell: (r) => <span style={{ color: "var(--a-muted)", fontSize: 12 }}>{timeAgo(r.created_at)}</span> },
    {
      key: "status", header: "Status", width: "1.2fr",
      cell: (r) => r.resolution
        ? <span style={{ color: "var(--a-success)", fontSize: 12 }}><Check size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {r.resolution.slice(0, 30)}{r.resolution.length > 30 ? "…" : ""}</span>
        : <span style={{ color: "var(--a-warn)", fontSize: 12 }}><AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Open</span>,
    },
    {
      key: "act", header: "Actions", width: "110px", align: "right",
      cell: (r) => !r.resolution && canManage
        ? <button className="a-btn-ghost" onClick={() => { setResolving(r); setResolution(""); }} style={{ fontSize: 12 }}>Resolve</button>
        : null,
    },
  ], [canManage]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Fraud Alerts</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>{openTotal} open · {total} {filters.status} · showing {rows.length}</p>
        </div>
        <button className="a-btn-ghost" onClick={() => { setPage(1); void fetchPage(1); }}><RefreshCw size={14} /> Refresh</button>
      </div>

      {ruleNames.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(ruleNames.length, 4)}, 1fr)`, gap: 8, marginBottom: 12 }}>
          {ruleNames.slice(0, 4).map((r) => (
            <button key={r} onClick={() => setFilters((f) => ({ ...f, rule: f.rule === r ? "" : r }))}
              className="a-elevated" style={{ padding: 12, textAlign: "left", cursor: "pointer", border: filters.rule === r ? "1px solid var(--a-accent)" : "1px solid var(--a-border)", borderRadius: 12 }}>
              <div className="a-label" style={{ marginBottom: 4 }}>{r.replace(/_/g, " ")}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--a-warn)" }}>{openByRule[r]}</div>
            </button>
          ))}
        </div>
      )}

      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["open", "resolved", "all"] as const).map((k) => (
            <button key={k} onClick={() => setFilters((f) => ({ ...f, status: k }))}
              className={filters.status === k ? "a-btn" : "a-btn-ghost"} style={{ textTransform: "capitalize", padding: "6px 12px", fontSize: 12 }}>{k}</button>
          ))}
        </div>
        {filters.rule && (
          <span style={{ fontSize: 12, color: "var(--a-muted)" }}>
            Rule: <span className="a-mono" style={{ color: "var(--a-fg)" }}>{filters.rule}</span>
            <button onClick={() => setFilters((f) => ({ ...f, rule: "" }))} style={{ marginLeft: 6, color: "var(--a-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>clear</button>
          </span>
        )}
      </div>

      <div className="a-surface" style={{ padding: "8px 12px", marginBottom: 12 }}>
        <SavedViewsBar<Filters>
          scope="fraud"
          current={filters}
          onApply={(f) => setFilters(f)}
          isActive={(f) => f.status === filters.status && f.rule === filters.rule}
        />
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <VirtualTable<FraudRow>
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        rowStyle={(r) => ({ borderLeft: `3px solid ${r.resolution ? "transparent" : "#f59e0b"}` })}
        height={580}
        rowHeight={60}
        initialLoading={initialLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        empty="No fraud alerts."
      />

      {resolving && (
        <div onClick={() => !busyId && setResolving(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Resolve fraud alert</h3>
            <p style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 12 }}>Rule: <span className="a-mono">{resolving.rule_triggered}</span></p>
            <div className="a-label" style={{ marginBottom: 6 }}>Resolution notes (audit logged)</div>
            <textarea className="a-input" rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. False positive — verified with user…" />
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {["False positive", "Confirmed fraud — reversed", "Confirmed fraud — escalated", "User contacted — legitimate"].map((s) => (
                <button key={s} type="button" onClick={() => setResolution(s)} className="a-btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }}>{s}</button>
              ))}
            </div>
            {err && <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="a-btn-ghost" disabled={!!busyId} onClick={() => { setResolving(null); setResolution(""); }}>Cancel</button>
              <button className="a-btn" disabled={!!busyId || !resolution.trim()} onClick={() => void resolve()}>
                {busyId ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
