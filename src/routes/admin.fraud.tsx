import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, ShieldAlert, Check, AlertTriangle } from "lucide-react";

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

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function FraudPage() {
  const { admin } = useAdminSession();
  const [rows, setRows] = useState<FraudRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openByRule, setOpenByRule] = useState<Record<string, number>>({});
  const [openTotal, setOpenTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [rule, setRule] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [resolving, setResolving] = useState<FraudRow | null>(null);
  const [resolution, setResolution] = useState("");

  const canManage = can(admin?.role, "manageFraud" as any);

  const load = useCallback(async () => {
    const s = readAdminSession(); if (!s) return;
    setLoading(true); setErr("");
    try {
      const r = await callAdminFn<{ rows: FraudRow[]; total: number; openByRule: Record<string, number>; openTotal: number }>({
        action: "fraud_list", sessionToken: s.sessionToken, status, rule, page, pageSize,
      });
      setRows(r.rows); setTotal(r.total); setOpenByRule(r.openByRule); setOpenTotal(r.openTotal);
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setLoading(false); }
  }, [status, rule, page]);
  useEffect(() => { void load(); }, [load]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("admin_fraud")
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_logs" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function resolve() {
    if (!resolving || !resolution.trim()) return;
    const s = readAdminSession(); if (!s) return;
    setBusyId(resolving.id); setErr("");
    try {
      await callAdminFn({ action: "fraud_resolve", sessionToken: s.sessionToken, id: resolving.id, resolution });
      setResolving(null); setResolution("");
      await load();
    } catch (e: any) { setErr(e.message || "Resolve failed"); }
    finally { setBusyId(null); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const ruleNames = Object.keys(openByRule);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Fraud Alerts</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>{openTotal} open · {total} {status}</p>
        </div>
        <button className="a-btn-ghost" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Open-by-rule strip */}
      {ruleNames.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(ruleNames.length, 4)}, 1fr)`, gap: 8, marginBottom: 12 }}>
          {ruleNames.slice(0, 4).map((r) => (
            <button key={r} onClick={() => { setRule(rule === r ? "" : r); setPage(1); }}
              className="a-elevated" style={{ padding: 12, textAlign: "left", cursor: "pointer", border: rule === r ? "1px solid var(--a-accent)" : "1px solid var(--a-border)", borderRadius: 12 }}>
              <div className="a-label" style={{ marginBottom: 4 }}>{r.replace(/_/g, " ")}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--a-warn)" }}>{openByRule[r]}</div>
            </button>
          ))}
        </div>
      )}

      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["open", "resolved", "all"] as const).map((k) => (
            <button key={k} onClick={() => { setStatus(k); setPage(1); }}
              className={status === k ? "a-btn" : "a-btn-ghost"} style={{ textTransform: "capitalize", padding: "6px 12px", fontSize: 12 }}>{k}</button>
          ))}
        </div>
        {rule && (
          <span style={{ fontSize: 12, color: "var(--a-muted)" }}>
            Rule: <span className="a-mono" style={{ color: "var(--a-fg)" }}>{rule}</span>
            <button onClick={() => { setRule(""); setPage(1); }} style={{ marginLeft: 6, color: "var(--a-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>clear</button>
          </span>
        )}
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--a-elevated)", color: "var(--a-muted)", textAlign: "left" }}>
              <th style={{ padding: 12 }}>Rule</th>
              <th style={{ padding: 12 }}>User</th>
              <th style={{ padding: 12 }}>Transaction</th>
              <th style={{ padding: 12 }}>Triggered</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}><Loader2 size={16} className="animate-spin" style={{ display: "inline-block", marginRight: 8 }} />Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>No fraud alerts.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)", borderLeft: `3px solid ${r.resolution ? "transparent" : "#f59e0b"}` }}>
                <td style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldAlert size={14} style={{ color: r.resolution ? "var(--a-muted)" : "var(--a-warn)" }} />
                    <span className="a-mono" style={{ fontSize: 12 }}>{r.rule_triggered}</span>
                  </div>
                </td>
                <td style={{ padding: 12 }}>
                  <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-fg)", textDecoration: "none" }}>
                    <div style={{ fontWeight: 600 }}>{r.profile?.full_name || "—"}</div>
                    <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.profile?.phone || r.user_id.slice(0, 8) + "…"}</div>
                  </Link>
                </td>
                <td style={{ padding: 12 }}>
                  {r.transaction ? (
                    <div>
                      <div className="a-mono" style={{ fontSize: 12 }}>₹{Number(r.transaction.amount).toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.transaction.merchant_name}</div>
                    </div>
                  ) : <span style={{ color: "var(--a-muted)", fontSize: 12 }}>—</span>}
                </td>
                <td style={{ padding: 12, color: "var(--a-muted)", fontSize: 12 }}>{timeAgo(r.created_at)}</td>
                <td style={{ padding: 12 }}>
                  {r.resolution
                    ? <span style={{ color: "var(--a-success)", fontSize: 12 }}><Check size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {r.resolution.slice(0, 30)}{r.resolution.length > 30 ? "…" : ""}</span>
                    : <span style={{ color: "var(--a-warn)", fontSize: 12 }}><AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Open</span>}
                </td>
                <td style={{ padding: 12, textAlign: "right" }}>
                  {!r.resolution && canManage && (
                    <button className="a-btn-ghost" onClick={() => { setResolving(r); setResolution(""); }} style={{ fontSize: 12 }}>Resolve</button>
                  )}
                </td>
              </tr>
            ))}
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

      {resolving && (
        <div onClick={() => !busyId && setResolving(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Resolve fraud alert</h3>
            <p style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 12 }}>Rule: <span className="a-mono">{resolving.rule_triggered}</span></p>
            <div className="a-label" style={{ marginBottom: 6 }}>Resolution notes (audit logged)</div>
            <textarea className="a-input" rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. False positive — verified with user; or: Transaction reversed, account flagged…" />
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
