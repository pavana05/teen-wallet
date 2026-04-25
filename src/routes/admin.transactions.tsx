import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { callAdminFn, readAdminSession, can, useAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronLeft, ChevronRight, RefreshCw, Search, AlertTriangle, RotateCcw } from "lucide-react";

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

function fmtINR(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TransactionsList() {
  const { admin } = useAdminSession();
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageVolume, setPageVolume] = useState(0);
  const [pageSuccess, setPageSuccess] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<TxnRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversePassword, setReversePassword] = useState("");
  const [err, setErr] = useState("");

  const canManage = can(admin?.role, "manageTransactions");

  // debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    setErr("");
    try {
      const r = await callAdminFn<{ rows: TxnRow[]; total: number; pageVolume: number; pageSuccess: number }>({
        action: "transactions_list", sessionToken: s.sessionToken,
        search: debouncedSearch, status, flagged,
        minAmount: minAmount ? Number(minAmount) : 0,
        maxAmount: maxAmount ? Number(maxAmount) : 0,
        page, pageSize,
      });
      setRows(r.rows);
      setTotal(r.total);
      setPageVolume(r.pageVolume);
      setPageSuccess(r.pageSuccess);
    } catch (e: any) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, flagged, minAmount, maxAmount, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("admin_txns")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        void load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function reverse() {
    if (!reversing) return;
    const s = readAdminSession();
    if (!s) return;
    if (!reverseReason.trim()) { setErr("Reason required"); return; }
    if (!reversePassword) { setErr("Password required"); return; }
    setBusyId(reversing.id);
    setErr("");
    try {
      // Step-up: re-verify password via admin-auth
      await callAdminFn({ action: "login_password", email: admin?.email, password: reversePassword });
      // Then reverse
      await callAdminFn({ action: "transaction_reverse", sessionToken: s.sessionToken, txnId: reversing.id, reason: reverseReason });
      setReversing(null);
      setReverseReason("");
      setReversePassword("");
      await load();
    } catch (e: any) {
      setErr(e.message || "Reverse failed");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Transactions</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            {total} total • Page volume <span className="a-mono">₹{fmtINR(pageVolume)}</span> • {pageSuccess}/{rows.length} success
          </p>
        </div>
        <button onClick={() => void load()} className="a-btn-ghost"><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Filters */}
      <div className="a-surface" style={{ padding: 16, marginBottom: 12, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Search</div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--a-muted)" }} />
            <input className="a-input" style={{ paddingLeft: 30 }} placeholder="Merchant, UPI ID, user ID…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Status</div>
          <select className="a-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Min ₹</div>
          <input className="a-input" type="number" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1); }} />
        </div>
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Max ₹</div>
          <input className="a-input" type="number" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1); }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--a-muted)", cursor: "pointer", paddingBottom: 8 }}>
          <input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setPage(1); }} />
          Flagged only
        </label>
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--a-elev)", color: "var(--a-muted)", textAlign: "left" }}>
              <th style={{ padding: 12 }}>Txn ID</th>
              <th style={{ padding: 12 }}>User</th>
              <th style={{ padding: 12, textAlign: "right" }}>Amount</th>
              <th style={{ padding: 12 }}>Merchant</th>
              <th style={{ padding: 12 }}>UPI</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Time</th>
              <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>
                <Loader2 size={16} className="animate-spin" style={{ display: "inline-block", marginRight: 8 }} />Loading…
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>No transactions match.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const flags = Array.isArray(r.fraud_flags) ? r.fraud_flags : [];
              const hasFlags = flags.length > 0;
              const borderColor = hasFlags ? "#f59e0b" : r.status === "failed" ? "#ef4444" : "transparent";
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)", borderLeft: `3px solid ${borderColor}` }}>
                  <td style={{ padding: 12 }} className="a-mono">{r.id.slice(0, 8)}…</td>
                  <td style={{ padding: 12 }}>
                    <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-fg)", textDecoration: "none" }}>
                      <div style={{ fontWeight: 600 }}>{r.profile?.full_name || "—"}</div>
                      <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.profile?.phone || r.user_id.slice(0, 8) + "…"}</div>
                    </Link>
                  </td>
                  <td style={{ padding: 12, textAlign: "right" }} className="a-mono">₹{fmtINR(Number(r.amount))}</td>
                  <td style={{ padding: 12 }}>
                    {r.merchant_name}
                    {hasFlags && <AlertTriangle size={12} style={{ display: "inline-block", marginLeft: 6, color: "#f59e0b", verticalAlign: "-2px" }} />}
                  </td>
                  <td style={{ padding: 12, fontSize: 11, color: "var(--a-muted)" }} className="a-mono">{r.upi_id}</td>
                  <td style={{ padding: 12 }}>
                    <span className={STATUS_BADGE[r.status]} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>{r.status}</span>
                  </td>
                  <td style={{ padding: 12, color: "var(--a-muted)", fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ padding: 12, textAlign: "right" }}>
                    {canManage && r.status !== "failed" && (
                      <button className="a-btn-ghost" onClick={() => setReversing(r)}><RotateCcw size={12} /> Reverse</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--a-muted)" }}>
        <div>Page {page} of {totalPages}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="a-btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
          <button className="a-btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
        </div>
      </div>

      {/* Reverse modal with step-up */}
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
