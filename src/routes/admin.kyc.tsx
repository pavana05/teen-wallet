import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { callAdminFn, readAdminSession, can, useAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldCheck, ShieldX, ChevronLeft, ChevronRight, RefreshCw, Clock } from "lucide-react";

export const Route = createFileRoute("/admin/kyc")({
  component: KycQueue,
});

interface KycRow {
  id: string;
  user_id: string;
  status: "not_started" | "pending" | "approved" | "rejected";
  provider: string;
  provider_ref: string | null;
  match_score: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  selfie_size_bytes: number | null;
  selfie_width: number | null;
  selfie_height: number | null;
  profile: {
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    aadhaar_last4: string | null;
    kyc_status: string;
  } | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  not_started: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function KycQueue() {
  const { admin } = useAdminSession();
  const [rows, setRows] = useState<KycRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<KycRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [err, setErr] = useState("");

  const canDecide = can(admin?.role, "decideKyc");

  const load = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    setErr("");
    try {
      const r = await callAdminFn<{ rows: KycRow[]; total: number }>({
        action: "kyc_list", sessionToken: s.sessionToken, status, page, pageSize,
      });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e: any) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: any change to kyc_submissions reloads list
  useEffect(() => {
    const ch = supabase
      .channel("admin_kyc")
      .on("postgres_changes", { event: "*", schema: "public", table: "kyc_submissions" }, () => {
        void load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function decide(submissionId: string, decision: "approved" | "rejected", reason?: string) {
    const s = readAdminSession();
    if (!s) return;
    setBusyId(submissionId);
    setErr("");
    try {
      await callAdminFn({ action: "kyc_decide", sessionToken: s.sessionToken, submissionId, decision, reason: reason || "" });
      setReviewing(null);
      setShowReject(false);
      setRejectReason("");
      await load();
    } catch (e: any) {
      setErr(e.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>KYC Queue</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>{total} submissions • {status}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["pending", "approved", "rejected", "all"] as const).map((k) => (
            <button key={k} onClick={() => { setStatus(k); setPage(1); }}
              className={status === k ? "a-btn" : "a-btn-ghost"}
              style={{ textTransform: "capitalize" }}>{k}</button>
          ))}
          <button onClick={() => void load()} className="a-btn-ghost"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--a-elev)", color: "var(--a-muted)", textAlign: "left" }}>
              <th style={{ padding: 12 }}>User</th>
              <th style={{ padding: 12 }}>Phone</th>
              <th style={{ padding: 12 }}>Aadhaar</th>
              <th style={{ padding: 12 }}>Submitted</th>
              <th style={{ padding: 12 }}>Wait</th>
              <th style={{ padding: 12 }}>Match</th>
              <th style={{ padding: 12 }}>Status</th>
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
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>No submissions.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const waitMs = Date.now() - new Date(r.created_at).getTime();
              const overdue = waitMs > 60 * 60 * 1000 && r.status === "pending";
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)" }}>
                  <td style={{ padding: 12 }}>
                    <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-fg)", textDecoration: "none" }}>
                      <div style={{ fontWeight: 600 }}>{r.profile?.full_name || "—"}</div>
                      <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.user_id.slice(0, 8)}…</div>
                    </Link>
                  </td>
                  <td style={{ padding: 12 }} className="a-mono">{r.profile?.phone || "—"}</td>
                  <td style={{ padding: 12 }} className="a-mono">{r.profile?.aadhaar_last4 ? `XXXX-XXXX-${r.profile.aadhaar_last4}` : "—"}</td>
                  <td style={{ padding: 12, color: "var(--a-muted)" }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ padding: 12, color: overdue ? "#fca5a5" : "var(--a-muted)" }}>
                    <Clock size={12} style={{ display: "inline-block", marginRight: 4, verticalAlign: "-2px" }} />
                    {timeAgo(r.created_at)}
                  </td>
                  <td style={{ padding: 12 }} className="a-mono">{r.match_score != null ? `${Math.round(r.match_score * 100) / 100}%` : "—"}</td>
                  <td style={{ padding: 12 }}>
                    <span className={STATUS_BADGE[r.status]} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>{r.status}</span>
                  </td>
                  <td style={{ padding: 12, textAlign: "right" }}>
                    <button className="a-btn-ghost" onClick={() => setReviewing(r)}>Review</button>
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

      {/* Review modal */}
      {reviewing && (
        <div onClick={() => !busyId && setReviewing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 720, width: "100%", padding: 24, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>KYC Review</h2>
                <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 4 }}>Submission {reviewing.id.slice(0, 8)}…</div>
              </div>
              <span className={STATUS_BADGE[reviewing.status]} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>{reviewing.status}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <div className="a-label" style={{ marginBottom: 8 }}>User-entered</div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><span style={{ color: "var(--a-muted)" }}>Name:</span> {reviewing.profile?.full_name || "—"}</div>
                  <div><span style={{ color: "var(--a-muted)" }}>Phone:</span> {reviewing.profile?.phone || "—"}</div>
                  <div><span style={{ color: "var(--a-muted)" }}>DOB:</span> {reviewing.profile?.dob || "—"}</div>
                  <div><span style={{ color: "var(--a-muted)" }}>Aadhaar:</span> {reviewing.profile?.aadhaar_last4 ? `XXXX-XXXX-${reviewing.profile.aadhaar_last4}` : "—"}</div>
                </div>
              </div>
              <div>
                <div className="a-label" style={{ marginBottom: 8 }}>Provider response</div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><span style={{ color: "var(--a-muted)" }}>Provider:</span> {reviewing.provider}</div>
                  <div><span style={{ color: "var(--a-muted)" }}>Ref:</span> <span className="a-mono" style={{ fontSize: 11 }}>{reviewing.provider_ref || "—"}</span></div>
                  <div><span style={{ color: "var(--a-muted)" }}>Match score:</span> {reviewing.match_score != null ? `${reviewing.match_score}%` : "—"}</div>
                  <div><span style={{ color: "var(--a-muted)" }}>Selfie:</span> {reviewing.selfie_width && reviewing.selfie_height ? `${reviewing.selfie_width}×${reviewing.selfie_height}` : "—"} {reviewing.selfie_size_bytes ? `(${Math.round(reviewing.selfie_size_bytes / 1024)} KB)` : ""}</div>
                </div>
              </div>
            </div>

            {reviewing.reason && (
              <div style={{ padding: 10, borderRadius: 6, background: "var(--a-elev)", marginBottom: 16, fontSize: 13 }}>
                <div className="a-label" style={{ marginBottom: 4 }}>Reason</div>{reviewing.reason}
              </div>
            )}

            {showReject && (
              <div style={{ marginBottom: 16 }}>
                <div className="a-label" style={{ marginBottom: 6 }}>Rejection reason (sent to user)</div>
                <select className="a-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ marginBottom: 8 }}>
                  <option value="">Select reason…</option>
                  <option value="Name mismatch">Name mismatch</option>
                  <option value="Selfie unclear">Selfie unclear</option>
                  <option value="Invalid Aadhaar">Invalid Aadhaar</option>
                  <option value="Age below 13">Age below 13</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            )}

            {!canDecide && (
              <div style={{ padding: 10, borderRadius: 6, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#fcd34d", fontSize: 13, marginBottom: 12 }}>
                Read-only: your role can view but not decide KYC.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="a-btn-ghost" onClick={() => { setReviewing(null); setShowReject(false); }} disabled={!!busyId}>Close</button>
              {canDecide && reviewing.status === "pending" && !showReject && (
                <>
                  <button className="a-btn-ghost" style={{ color: "#fca5a5" }} onClick={() => setShowReject(true)} disabled={!!busyId}>
                    <ShieldX size={14} /> Reject
                  </button>
                  <button className="a-btn" onClick={() => decide(reviewing.id, "approved")} disabled={!!busyId}>
                    {busyId === reviewing.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Approve
                  </button>
                </>
              )}
              {canDecide && showReject && (
                <button className="a-btn" style={{ background: "#ef4444", color: "white" }}
                  disabled={!rejectReason || !!busyId}
                  onClick={() => decide(reviewing.id, "rejected", rejectReason)}>
                  {busyId === reviewing.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldX size={14} />} Confirm reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
