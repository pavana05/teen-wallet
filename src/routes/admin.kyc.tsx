import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ShieldCheck, ShieldX, RefreshCw, Clock,
  Copy, Check, ExternalLink, ImageOff, FileImage, User as UserIcon,
} from "lucide-react";
import { PermissionBanner, ErrorState } from "@/admin/components/AdminFeedback";
import { toast } from "sonner";
import { VirtualTable, type Column } from "@/admin/components/VirtualTable";
import { usePersistedState } from "@/admin/lib/usePersistedState";
import { recordPanelLoad, recordRealtime } from "@/admin/lib/perfBus";

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
  selfie_path: string | null;
  doc_front_path: string | null;
  doc_back_path: string | null;
  profile: {
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    aadhaar_last4: string | null;
    kyc_status: string;
  } | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "kyc-pill kyc-pill-pending",
  approved: "kyc-pill kyc-pill-approved",
  rejected: "kyc-pill kyc-pill-rejected",
  not_started: "kyc-pill kyc-pill-muted",
};

const PAGE_SIZE = 50;

interface Filters {
  status: "pending" | "approved" | "rejected" | "all";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function MatchGauge({ score }: { score: number | null }) {
  if (score == null) return <span className="a-mono" style={{ color: "var(--a-muted)" }}>—</span>;
  const pct = score <= 1 ? score * 100 : score;
  const color = pct >= 90 ? "var(--a-success)" : pct >= 75 ? "var(--a-warn)" : "var(--a-danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 80, height: 6, borderRadius: 999, background: "var(--a-elevated)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, transition: "width 300ms" }} />
      </div>
      <span className="a-mono" style={{ fontSize: 12, color }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="a-surface kyc-stat">
      <div className="a-label">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: accent || "var(--a-text)" }}>{value}</div>
    </div>
  );
}

function KycQueue() {
  const admin = useMemo(() => readAdminSession()?.admin, []);
  const [filters, setFilters] = usePersistedState<Filters>("tw_admin_kyc_v2", {
    status: "pending",
  });

  const [rows, setRows] = useState<KycRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<KycRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [err, setErr] = useState("");
  const [urls, setUrls] = useState<{ selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null } | null>(null);
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const canDecide = can(admin?.role, "decideKyc");

  const reqId = useRef(0);
  const fetchPage = useCallback(async (pageNum: number) => {
    const s = readAdminSession();
    if (!s) return;
    const myReq = ++reqId.current;
    if (pageNum === 1) setInitialLoading(true);
    else setLoadingMore(true);
    const t0 = performance.now();
    try {
      const r = await callAdminFn<{ rows: KycRow[]; total: number }>({
        action: "kyc_list",
        sessionToken: s.sessionToken,
        status: filters.status,
        page: pageNum,
        pageSize: PAGE_SIZE,
      });
      if (myReq !== reqId.current) return;
      setTotal(r.total);
      setHasMore(pageNum * PAGE_SIZE < r.total);
      setRows((prev) => (pageNum === 1 ? r.rows : [...prev, ...r.rows]));
      setErr("");
      recordPanelLoad("KYC · queue", performance.now() - t0);
    } catch (e: any) {
      if (myReq === reqId.current) setErr(e.message || "Failed to load");
    } finally {
      if (myReq === reqId.current) {
        setInitialLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filters.status]);

  // Reset & reload on filter change
  useEffect(() => {
    setPage(1);
    void fetchPage(1);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || initialLoading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    void fetchPage(next);
  }, [page, hasMore, loadingMore, initialLoading, fetchPage]);

  // Realtime — throttled refresh of page 1
  const lastKycLoad = useRef(0);
  useEffect(() => {
    const throttled = () => {
      recordRealtime();
      const now = Date.now();
      if (now - lastKycLoad.current < 3000) return;
      lastKycLoad.current = now;
      setPage(1);
      void fetchPage(1);
    };
    const ch = supabase
      .channel("admin_kyc")
      .on("postgres_changes", { event: "*", schema: "public", table: "kyc_submissions" }, throttled)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchPage]);

  // Fetch signed URLs whenever opening a review
  useEffect(() => {
    if (!reviewing) { setUrls(null); return; }
    const s = readAdminSession();
    if (!s) return;
    setUrlsLoading(true);
    setUrls(null);
    const t0 = performance.now();
    callAdminFn<{ selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null }>({
      action: "kyc_signed_urls", sessionToken: s.sessionToken, submissionId: reviewing.id,
    })
      .then((r) => {
        setUrls(r);
        recordPanelLoad("KYC · media", performance.now() - t0);
      })
      .catch(() => setUrls({ selfieUrl: null, docFrontUrl: null, docBackUrl: null }))
      .finally(() => setUrlsLoading(false));
  }, [reviewing]);

  async function decide(submissionId: string, decision: "approved" | "rejected", reason?: string) {
    const s = readAdminSession();
    if (!s) return;
    setBusyId(submissionId);
    setErr("");
    try {
      await callAdminFn({ action: "kyc_decide", sessionToken: s.sessionToken, submissionId, decision, reason: reason || "" });
      toast.success(decision === "approved" ? "KYC approved" : "KYC rejected");
      setReviewing(null);
      setShowReject(false);
      setRejectReason("");
      setPage(1);
      await fetchPage(1);
    } catch (e: any) {
      setErr(e.message || "Action failed");
      toast.error(e?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(key);
      setTimeout(() => setCopiedId((c) => (c === key ? null : c)), 1500);
    });
  }

  const pendingCount = filters.status === "pending" ? total : rows.filter((r) => r.status === "pending").length;

  // Build columns for VirtualTable
  const columns: Column<KycRow>[] = useMemo(() => [
    {
      key: "user", header: "User", width: "minmax(220px, 1.5fr)",
      cell: (r) => {
        const age = ageFromDob(r.profile?.dob);
        return (
          <Link to="/admin/users/$id" params={{ id: r.user_id }} style={{ color: "var(--a-text)", textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
            <div className="kyc-avatar"><UserIcon size={14} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.profile?.full_name || "—"}
                {age ? <span style={{ color: "var(--a-muted)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>· {age}y</span> : null}
              </div>
              <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.user_id.slice(0, 8)}…</div>
            </div>
          </Link>
        );
      },
    },
    {
      key: "phone", header: "Phone", width: "140px",
      cell: (r) => <span className="a-mono">{r.profile?.phone || "—"}</span>,
    },
    {
      key: "aadhaar", header: "Aadhaar", width: "160px",
      cell: (r) => <span className="a-mono">{r.profile?.aadhaar_last4 ? `XXXX-XXXX-${r.profile.aadhaar_last4}` : "—"}</span>,
    },
    {
      key: "submitted", header: "Submitted", width: "180px",
      cell: (r) => <span style={{ color: "var(--a-muted)" }}>{new Date(r.created_at).toLocaleString()}</span>,
    },
    {
      key: "wait", header: "Wait", width: "120px",
      cell: (r) => {
        const overdue = Date.now() - new Date(r.created_at).getTime() > 60 * 60 * 1000 && r.status === "pending";
        return (
          <span style={{ color: overdue ? "var(--a-danger)" : "var(--a-muted)" }}>
            <Clock size={12} style={{ display: "inline-block", marginRight: 4, verticalAlign: "-2px" }} />
            {timeAgo(r.created_at)}
          </span>
        );
      },
    },
    {
      key: "match", header: "Match", width: "160px",
      cell: (r) => <MatchGauge score={r.match_score} />,
    },
    {
      key: "status", header: "Status", width: "120px",
      cell: (r) => <span className={STATUS_BADGE[r.status]}>{r.status}</span>,
    },
    {
      key: "actions", header: "", width: "110px", align: "right",
      cell: (r) => (
        <button className="a-btn-ghost" onClick={() => setReviewing(r)} style={{ padding: "6px 12px", fontSize: 12 }}>Review →</button>
      ),
    },
  ], []);

  return (
    <div>
      {/* Header with gradient */}
      <div className="kyc-header">
        <div>
          <div className="a-label" style={{ marginBottom: 6 }}>Verification</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>KYC Queue</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            Review and decide identity verifications submitted by users.
          </p>
        </div>
        <button onClick={() => { setPage(1); void fetchPage(1); }} className="a-btn-ghost" disabled={initialLoading}>
          <RefreshCw size={14} className={initialLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, margin: "20px 0" }}>
        <StatCard label="In queue" value={filters.status === "pending" ? total : pendingCount} accent="var(--a-warn)" />
        <StatCard label={`${filters.status} total`} value={total} />
        <StatCard label="Loaded" value={rows.length} />
        <StatCard label="Provider" value="Digio" />
      </div>

      {/* Filter chips */}
      <div className="kyc-filters">
        {(["pending", "approved", "rejected", "all"] as const).map((k) => (
          <button key={k} onClick={() => setFilters((f) => ({ ...f, status: k }))}
            className={`kyc-chip ${filters.status === k ? "kyc-chip-on" : ""}`}>
            {k}
          </button>
        ))}
      </div>

      {err && <div className="kyc-err">{err}</div>}

      <div style={{ marginTop: 12 }}>
        <VirtualTable<KycRow>
          rows={rows}
          columns={columns}
          rowId={(r) => r.id}
          height={620}
          rowHeight={64}
          initialLoading={initialLoading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          empty={
            <div style={{ padding: 48, textAlign: "center", color: "var(--a-muted)" }}>
              <ShieldCheck size={28} style={{ opacity: 0.4, display: "block", margin: "0 auto 8px" }} />
              Nothing here. The queue is clear.
            </div>
          }
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--a-muted)" }}>
        <div>{rows.length} of {total} loaded {hasMore ? "· scroll to load more" : ""}</div>
        {loadingMore && <div><Loader2 size={12} className="animate-spin" style={{ display: "inline-block", marginRight: 6 }} />Loading…</div>}
      </div>

      {/* Review modal */}
      {reviewing && (
        <div onClick={() => !busyId && setReviewing(null)} className="kyc-overlay">
          <div onClick={(e) => e.stopPropagation()} className="kyc-modal">
            {/* Modal header */}
            <div className="kyc-modal-head">
              <div>
                <div className="a-label" style={{ marginBottom: 4 }}>Submission · {reviewing.provider}</div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>{reviewing.profile?.full_name || "Unnamed user"}</h2>
                <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  {reviewing.id.slice(0, 8)}…
                  <button onClick={() => copy(reviewing.id, "sub")} className="kyc-copy" title="Copy submission id">
                    {copiedId === "sub" ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                  <span style={{ color: "var(--a-border)" }}>|</span>
                  user {reviewing.user_id.slice(0, 8)}…
                  <button onClick={() => copy(reviewing.user_id, "uid")} className="kyc-copy" title="Copy user id">
                    {copiedId === "uid" ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
              <span className={STATUS_BADGE[reviewing.status]}>{reviewing.status}</span>
            </div>

            {/* Selfie + Docs grid */}
            <div className="kyc-media-grid">
              <MediaTile label="Selfie" url={urls?.selfieUrl ?? null} loading={urlsLoading}
                meta={reviewing.selfie_width && reviewing.selfie_height
                  ? `${reviewing.selfie_width}×${reviewing.selfie_height}${reviewing.selfie_size_bytes ? ` · ${Math.round(reviewing.selfie_size_bytes / 1024)} KB` : ""}`
                  : null} />
              <MediaTile label="Aadhaar front" url={urls?.docFrontUrl ?? null} loading={urlsLoading} />
              <MediaTile label="Aadhaar back" url={urls?.docBackUrl ?? null} loading={urlsLoading} />
            </div>

            {/* Details */}
            <div className="kyc-details-grid">
              <div>
                <div className="a-label" style={{ marginBottom: 8 }}>User-entered</div>
                <dl className="kyc-dl">
                  <div><dt>Name</dt><dd>{reviewing.profile?.full_name || "—"}</dd></div>
                  <div><dt>Phone</dt><dd className="a-mono">{reviewing.profile?.phone || "—"}</dd></div>
                  <div><dt>DOB</dt><dd>{reviewing.profile?.dob || "—"}{ageFromDob(reviewing.profile?.dob) ? ` (${ageFromDob(reviewing.profile?.dob)} yrs)` : ""}</dd></div>
                  <div><dt>Aadhaar</dt><dd className="a-mono">{reviewing.profile?.aadhaar_last4 ? `XXXX-XXXX-${reviewing.profile.aadhaar_last4}` : "—"}</dd></div>
                </dl>
              </div>
              <div>
                <div className="a-label" style={{ marginBottom: 8 }}>Provider response</div>
                <dl className="kyc-dl">
                  <div><dt>Provider</dt><dd>{reviewing.provider}</dd></div>
                  <div><dt>Ref</dt><dd className="a-mono" style={{ fontSize: 11 }}>{reviewing.provider_ref || "—"}</dd></div>
                  <div><dt>Match</dt><dd><MatchGauge score={reviewing.match_score} /></dd></div>
                  <div><dt>Submitted</dt><dd>{new Date(reviewing.created_at).toLocaleString()}</dd></div>
                </dl>
              </div>
            </div>

            {reviewing.reason && (
              <div className="kyc-reason">
                <div className="a-label" style={{ marginBottom: 4 }}>Reason</div>{reviewing.reason}
              </div>
            )}

            {showReject && (
              <div style={{ marginTop: 12 }}>
                <div className="a-label" style={{ marginBottom: 6 }}>Rejection reason (sent to user)</div>
                <select className="a-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                  <option value="">Select reason…</option>
                  <option value="Name mismatch">Name mismatch</option>
                  <option value="Selfie unclear">Selfie unclear</option>
                  <option value="Invalid Aadhaar">Invalid Aadhaar</option>
                  <option value="Age below 13">Age below 13</option>
                  <option value="Document unreadable">Document unreadable</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            )}

            {!canDecide && (
              <div className="kyc-warn">Read-only: your role can view but not decide KYC.</div>
            )}

            <div className="kyc-actions">
              <Link to="/admin/users/$id" params={{ id: reviewing.user_id }} className="a-btn-ghost">
                <ExternalLink size={14} /> Open user
              </Link>
              <div style={{ flex: 1 }} />
              <button className="a-btn-ghost" onClick={() => { setReviewing(null); setShowReject(false); }} disabled={!!busyId}>Close</button>
              {canDecide && reviewing.status === "pending" && !showReject && (
                <>
                  <button className="kyc-btn-reject" onClick={() => setShowReject(true)} disabled={!!busyId}>
                    <ShieldX size={14} /> Reject
                  </button>
                  <button className="kyc-btn-approve" onClick={() => decide(reviewing.id, "approved")} disabled={!!busyId}>
                    {busyId === reviewing.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Approve
                  </button>
                </>
              )}
              {canDecide && showReject && (
                <button className="kyc-btn-reject-confirm"
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

function MediaTile({ label, url, loading, meta }: { label: string; url: string | null; loading: boolean; meta?: string | null }) {
  return (
    <div className="kyc-media">
      <div className="kyc-media-label">
        <span>{label}</span>
        {url && <a href={url} target="_blank" rel="noreferrer" className="kyc-copy" title="Open original"><ExternalLink size={11} /></a>}
      </div>
      <div className="kyc-media-frame">
        {loading ? (
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--a-muted)" }} />
        ) : url ? (
          <img src={url} alt={label} loading="lazy" />
        ) : (
          <div className="kyc-media-empty">
            {label === "Selfie" ? <FileImage size={22} /> : <ImageOff size={22} />}
            <span>Not available</span>
          </div>
        )}
      </div>
      {meta && <div className="kyc-media-meta a-mono">{meta}</div>}
    </div>
  );
}
