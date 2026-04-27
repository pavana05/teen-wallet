import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ShieldCheck, ShieldX, RefreshCw, Clock,
  Copy, Check, ExternalLink, ImageOff, FileImage, User as UserIcon,
  ZoomIn, X, SplitSquareHorizontal, History as HistoryIcon, AlertTriangle,
  ChevronUp, ChevronDown, ChevronsUpDown, Eye,
} from "lucide-react";
import { PermissionBanner, ShakeErrorPanel } from "@/admin/components/AdminFeedback";
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

interface HistoryEvent {
  id: string;
  actionType: string;
  adminId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  adminRole: string | null;
  decision: string | null;
  reason: string | null;
  previousStatus: string | null;
  ip: string | null;
  at: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "kyc-pill kyc-pill-pending",
  approved: "kyc-pill kyc-pill-approved",
  rejected: "kyc-pill kyc-pill-rejected",
  not_started: "kyc-pill kyc-pill-muted",
};

// Curated list of common reject reasons. "Other" forces the admin to write
// a custom note. Keep terse — these strings are sent to users.
const REJECT_REASONS = [
  "Selfie unclear or low quality",
  "Selfie does not match Aadhaar photo",
  "Aadhaar document unreadable",
  "Aadhaar number mismatch with profile",
  "Name on document does not match profile",
  "Date of birth mismatch (under 13)",
  "Suspected fraudulent submission",
  "Document expired or tampered",
  "Other (write below)",
] as const;
type RejectReason = (typeof REJECT_REASONS)[number];

const PAGE_SIZE = 50;

interface Filters {
  status: "pending" | "approved" | "rejected" | "all";
}

type SortKey = "submitted" | "wait" | "match" | "status" | "name";
type SortDir = "asc" | "desc";

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
  const tier =
    pct >= 90 ? { color: "var(--a-success)", label: "high" }
    : pct >= 75 ? { color: "var(--a-warn)", label: "med" }
    : { color: "var(--a-danger)", label: "low" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`Match confidence: ${tier.label}`}>
      <div style={{ width: 80, height: 6, borderRadius: 999, background: "var(--a-elevated)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tier.color, transition: "width 300ms" }} />
      </div>
      <span className="a-mono" style={{ fontSize: 12, color: tier.color, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function StatusPill({ status }: { status: KycRow["status"] }) {
  const Icon = status === "approved" ? ShieldCheck
    : status === "rejected" ? ShieldX
    : status === "pending" ? Clock
    : AlertTriangle;
  return (
    <span className={STATUS_BADGE[status]} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon size={10} />
      {status}
    </span>
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

function SortIcon({ dir }: { dir: SortDir | undefined }) {
  if (dir === "asc") return <ChevronUp size={11} style={{ display: "inline-block", verticalAlign: "-1px" }} />;
  if (dir === "desc") return <ChevronDown size={11} style={{ display: "inline-block", verticalAlign: "-1px" }} />;
  return <ChevronsUpDown size={11} style={{ display: "inline-block", verticalAlign: "-1px", opacity: 0.4 }} />;
}

function KycQueue() {
  const admin = useMemo(() => readAdminSession()?.admin, []);
  const [filters, setFilters] = usePersistedState<Filters>("tw_admin_kyc_v2", {
    status: "pending",
  });

  // Deep-link: apply ?status=... from the URL on mount (one-shot).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("status");
    if (s && ["pending", "approved", "rejected", "all"].includes(s) && s !== filters.status) {
      setFilters((f) => ({ ...f, status: s as Filters["status"] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sort, setSort] = usePersistedState<{ key: SortKey; dir: SortDir }>(
    "tw_admin_kyc_sort_v1",
    { key: "submitted", dir: "asc" },
  );

  const [rows, setRows] = useState<KycRow[]>([]);
  const [total, setTotal] = useState(0);
  // Cursor pagination state — composite (created_at, id) so realtime inserts
  // between page loads never produce duplicates or skipped rows.
  const [cursor, setCursor] = useState<{ ts: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<KycRow | null>(null);
  const [quickPreview, setQuickPreview] = useState<KycRow | null>(null);
  const [rejectReason, setRejectReason] = useState<RejectReason | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  // Approval confirmation flow — mirrors rejection: explicit note + typed
  // confirmation phrase so an accidental click can't approve a submission.
  const [showApprove, setShowApprove] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [approveConfirm, setApproveConfirm] = useState("");
  const [rejectConfirm, setRejectConfirm] = useState("");
  const [err, setErr] = useState("");
  const [urls, setUrls] = useState<{ selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null } | null>(null);
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [zoomUrl, setZoomUrl] = useState<{ url: string; label: string } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const canDecide = can(admin?.role, "decideKyc");
  const canView = can(admin?.role, "viewKyc") || canDecide;

  // Monotonically increasing request id — older in-flight requests' results
  // are dropped when a newer one fires (filter change, refresh, realtime burst).
  // This is the de-dupe-by-request-id mechanism.
  const reqId = useRef(0);
  // Stable ref to "is a fetch in flight" so callbacks see the latest value
  // without retriggering the effect that wires the realtime channel.
  const inFlightRef = useRef(false);

  /**
   * Cursor-based fetch.
   * - reset=true: fresh page from the top (clears rows + cursor).
   * - reset=false: append the next page using the current cursor as anchor.
   * Rows are de-duped by id when appending, defending against race conditions
   * where realtime + scroll-load fire in rapid succession.
   */
  const fetchList = useCallback(async (reset: boolean) => {
    const s = readAdminSession();
    if (!s) return;
    // Hard guard: never run two concurrent loads (in addition to the
    // VirtualTable observer's own guard). Refresh always wins by ignoring this.
    if (!reset && inFlightRef.current) return;
    inFlightRef.current = true;
    const myReq = ++reqId.current;
    if (reset) setInitialLoading(true);
    else setLoadingMore(true);
    const t0 = performance.now();
    try {
      const r = await callAdminFn<{
        rows: KycRow[];
        total: number;
        nextCursor: string | null;
        nextCursorId: string | null;
      }>({
        action: "kyc_list",
        sessionToken: s.sessionToken,
        status: filters.status,
        pageSize: PAGE_SIZE,
        cursor: reset ? null : cursor?.ts ?? null,
        cursorId: reset ? null : cursor?.id ?? null,
      });
      // Drop stale responses — a newer request has superseded this one.
      if (myReq !== reqId.current) return;
      setTotal(r.total);
      setHasMore(Boolean(r.nextCursor));
      setCursor(r.nextCursor && r.nextCursorId ? { ts: r.nextCursor, id: r.nextCursorId } : null);
      setRows((prev) => {
        if (reset) return r.rows;
        // Dedupe by id — required because realtime can insert a row between
        // when we computed the cursor and when this response arrived.
        const seen = new Set(prev.map((row) => row.id));
        const fresh = r.rows.filter((row) => !seen.has(row.id));
        return [...prev, ...fresh];
      });
      setErr("");
      recordPanelLoad("KYC · queue", performance.now() - t0);
    } catch (e: any) {
      if (myReq === reqId.current) setErr(e.message || "Failed to load KYC submissions.");
    } finally {
      if (myReq === reqId.current) {
        setInitialLoading(false);
        setLoadingMore(false);
      }
      inFlightRef.current = false;
    }
  }, [filters.status, cursor]);

  // Reset & reload on filter change. We deliberately only depend on
  // filters.status — fetchList changes whenever cursor changes, but we don't
  // want a new cursor to retrigger this reset effect.
  useEffect(() => {
    setCursor(null);
    setRows([]);
    void fetchList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);

  const loadMore = useCallback(() => {
    // Defensive guards: VirtualTable already short-circuits when loadingMore
    // or initialLoading, but keep belt-and-suspenders here for safety.
    if (loadingMore || initialLoading || !hasMore) return;
    void fetchList(false);
  }, [hasMore, loadingMore, initialLoading, fetchList]);

  // Realtime — throttled refresh from the top. Throttle prevents a burst of
  // database changes from triggering a flood of refetches.
  const lastKycLoad = useRef(0);
  useEffect(() => {
    const throttled = () => {
      recordRealtime();
      const now = Date.now();
      if (now - lastKycLoad.current < 3000) return;
      lastKycLoad.current = now;
      setCursor(null);
      setRows([]);
      void fetchList(true);
    };
    const ch = supabase
      .channel("admin_kyc")
      .on("postgres_changes", { event: "*", schema: "public", table: "kyc_submissions" }, throttled)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status]);
  

  // Fetch signed URLs whenever opening a review
  useEffect(() => {
    if (!reviewing) { setUrls(null); setHistory(null); return; }
    const s = readAdminSession();
    if (!s) return;
    setUrlsLoading(true);
    setUrls(null);
    setHistory(null);
    setHistoryLoading(true);
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

    callAdminFn<{ rows: HistoryEvent[] }>({
      action: "kyc_history", sessionToken: s.sessionToken, submissionId: reviewing.id,
    })
      .then((r) => setHistory(r.rows))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [reviewing]);

  // Reset reject form whenever review modal changes target.
  useEffect(() => {
    setShowReject(false);
    setRejectReason("");
    setRejectNote("");
  }, [reviewing?.id]);

  // Compose final reject reason from the dropdown + custom note.
  // When "Other" is chosen, the note alone is the reason.
  // Otherwise reason = "<preset> — <note>" (note required for audit clarity).
  function composeRejectReason(): string {
    if (!rejectReason) return "";
    const note = rejectNote.trim();
    if (rejectReason === "Other (write below)") return note;
    return note ? `${rejectReason} — ${note}` : rejectReason;
  }
  const rejectValid = rejectReason !== "" && rejectNote.trim().length >= 4;

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
      setRejectNote("");
      setCursor(null);
      setRows([]);
      await fetchList(true);
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

  // Client-side sort over loaded rows. Server returns ordered by created_at ASC,
  // so this re-sort is purely a UX layer over what's already loaded.
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case "name": {
          const an = (a.profile?.full_name || "").toLowerCase();
          const bn = (b.profile?.full_name || "").toLowerCase();
          return an.localeCompare(bn) * dir;
        }
        case "match": {
          const av = a.match_score == null ? -1 : (a.match_score <= 1 ? a.match_score * 100 : a.match_score);
          const bv = b.match_score == null ? -1 : (b.match_score <= 1 ? b.match_score * 100 : b.match_score);
          return (av - bv) * dir;
        }
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "wait":
        case "submitted":
        default:
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: "asc" };
      return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
    });
  }
  const sortDirFor = (key: SortKey): SortDir | undefined => (sort.key === key ? sort.dir : undefined);

  // Build columns for VirtualTable
  const columns: Column<KycRow>[] = useMemo(() => [
    {
      key: "user", header: <span>User <SortIcon dir={sortDirFor("name")} /></span>,
      width: "minmax(220px, 1.5fr)",
      onSort: () => toggleSort("name"),
      sortDir: sortDirFor("name"),
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
      key: "submitted", header: <span>Submitted <SortIcon dir={sortDirFor("submitted")} /></span>,
      width: "180px",
      onSort: () => toggleSort("submitted"),
      sortDir: sortDirFor("submitted"),
      cell: (r) => <span style={{ color: "var(--a-muted)" }}>{new Date(r.created_at).toLocaleString()}</span>,
    },
    {
      key: "wait", header: <span>Wait <SortIcon dir={sortDirFor("wait")} /></span>,
      width: "120px",
      onSort: () => toggleSort("wait"),
      sortDir: sortDirFor("wait"),
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
      key: "match", header: <span>Match <SortIcon dir={sortDirFor("match")} /></span>,
      width: "160px",
      onSort: () => toggleSort("match"),
      sortDir: sortDirFor("match"),
      cell: (r) => <MatchGauge score={r.match_score} />,
    },
    {
      key: "status", header: <span>Status <SortIcon dir={sortDirFor("status")} /></span>,
      width: "120px",
      onSort: () => toggleSort("status"),
      sortDir: sortDirFor("status"),
      cell: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "actions", header: "", width: "150px", align: "right",
      cell: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            className="a-btn-ghost"
            onClick={(e) => { e.stopPropagation(); setQuickPreview(r); }}
            style={{ padding: "6px 10px", fontSize: 11 }}
            title="Quick preview (or click row / long-press)"
          >
            <Eye size={11} /> Quick
          </button>
          <button
            className="a-btn-ghost"
            onClick={(e) => { e.stopPropagation(); setReviewing(r); }}
            style={{ padding: "6px 10px", fontSize: 11 }}
          >
            Review →
          </button>
        </div>
      ),
    },
  ], [sort]);

  // Long-press / click handlers for the whole row. Long-press (≥450ms) opens
  // the quick side panel; a plain click also opens it. The full review modal
  // is reserved for the explicit "Review →" button so we don't take admins
  // out of context unexpectedly.
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const handleRowPointerDown = useCallback((row: KycRow) => {
    longPressFired.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setQuickPreview(row);
    }, 450);
  }, []);
  const handleRowPointerUp = useCallback((row: KycRow) => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // If the long-press already fired, the panel is open — don't re-open.
    if (longPressFired.current) return;
    setQuickPreview(row);
  }, []);
  const handleRowPointerCancel = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

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
        <button onClick={() => { setCursor(null); setRows([]); void fetchList(true); }} className="a-btn-ghost" disabled={initialLoading}>
          <RefreshCw size={14} className={initialLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <PermissionBanner
        canView={canView}
        canDecide={canDecide}
        decideLabel="approve/reject"
        resourceLabel="KYC submissions"
      />

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

      <ShakeErrorPanel
        error={err}
        retrying={initialLoading}
        onRetry={() => { setCursor(null); setRows([]); void fetchList(true); }}
        title="Couldn’t load the KYC queue"
      />


      <div style={{ marginTop: 12 }}>
        <VirtualTable<KycRow>
          rows={sortedRows}
          columns={columns}
          rowId={(r) => r.id}
          height={620}
          rowHeight={64}
          initialLoading={initialLoading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onRowPointerDown={handleRowPointerDown}
          onRowPointerUp={handleRowPointerUp}
          onRowPointerCancel={handleRowPointerCancel}
          rowClass={(r) => (quickPreview?.id === r.id ? "kyc-row-pressing" : undefined)}
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
              <StatusPill status={reviewing.status} />
            </div>

            {/* Selfie + Docs grid */}
            <div className="kyc-media-grid">
              <MediaTile
                label="Selfie"
                url={urls?.selfieUrl ?? null}
                loading={urlsLoading}
                onZoom={(u) => setZoomUrl({ url: u, label: "Selfie" })}
                meta={reviewing.selfie_width && reviewing.selfie_height
                  ? `${reviewing.selfie_width}×${reviewing.selfie_height}${reviewing.selfie_size_bytes ? ` · ${Math.round(reviewing.selfie_size_bytes / 1024)} KB` : ""}`
                  : null}
              />
              <MediaTile
                label="Aadhaar front"
                url={urls?.docFrontUrl ?? null}
                loading={urlsLoading}
                onZoom={(u) => setZoomUrl({ url: u, label: "Aadhaar front" })}
              />
              <MediaTile
                label="Aadhaar back"
                url={urls?.docBackUrl ?? null}
                loading={urlsLoading}
                onZoom={(u) => setZoomUrl({ url: u, label: "Aadhaar back" })}
              />
            </div>

            {/* Compare front/back trigger */}
            {(urls?.docFrontUrl || urls?.docBackUrl) && (
              <button
                className="a-btn-ghost"
                style={{ marginBottom: 16, fontSize: 12 }}
                onClick={() => setCompareOpen(true)}
                disabled={!urls?.docFrontUrl || !urls?.docBackUrl}
                title={!urls?.docFrontUrl || !urls?.docBackUrl ? "Both Aadhaar sides required to compare" : "Open side-by-side compare"}
              >
                <SplitSquareHorizontal size={13} /> Compare front vs back
              </button>
            )}

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
                <div className="a-label" style={{ marginBottom: 8 }}>Provider & verification</div>
                <dl className="kyc-dl">
                  <div><dt>Provider</dt><dd>{reviewing.provider}</dd></div>
                  <div>
                    <dt>Provider ref</dt>
                    <dd className="a-mono" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                        {reviewing.provider_ref || "—"}
                      </span>
                      {reviewing.provider_ref && (
                        <button
                          onClick={() => copy(reviewing.provider_ref!, "pref")}
                          className="kyc-copy"
                          title="Copy provider ref"
                        >
                          {copiedId === "pref" ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      )}
                    </dd>
                  </div>
                  <div><dt>Match score</dt><dd><MatchGauge score={reviewing.match_score} /></dd></div>
                  <div><dt>Status</dt><dd><StatusPill status={reviewing.status} /></dd></div>
                  <div><dt>Submitted</dt><dd>{new Date(reviewing.created_at).toLocaleString()}</dd></div>
                  <div><dt>Updated</dt><dd>{new Date(reviewing.updated_at).toLocaleString()} <span style={{ color: "var(--a-muted)" }}>· {timeAgo(reviewing.updated_at)}</span></dd></div>
                </dl>
              </div>
            </div>

            {/* Action timeline */}
            <ActionTimeline events={history} loading={historyLoading} />

            {reviewing.reason && (
              <div className="kyc-reason">
                <div className="a-label" style={{ marginBottom: 4 }}>Latest reason on record</div>{reviewing.reason}
              </div>
            )}

            {showReject && (
              <div className="kyc-reject-form">
                <div className="a-label" style={{ marginBottom: 6 }}>Rejection reason (sent to user)</div>
                <select
                  className="a-input"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value as RejectReason)}
                >
                  <option value="">Select a common reason…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <div className="a-label" style={{ marginTop: 12, marginBottom: 6 }}>
                  Reviewer note <span style={{ color: "var(--a-danger)" }}>*</span>
                </div>
                <textarea
                  className="a-input"
                  rows={3}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder={
                    rejectReason === "Other (write below)"
                      ? "Describe the issue in your own words (min 4 chars)…"
                      : "Add reviewer-specific detail (min 4 chars)…"
                  }
                  maxLength={500}
                />
                <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                  <span>
                    {rejectValid ? "✓ Will send: " : "Pick a reason and add a note. "}
                    {rejectValid && <em style={{ color: "var(--a-text)" }}>{composeRejectReason()}</em>}
                  </span>
                  <span>{rejectNote.length}/500</span>
                </div>
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
                <button
                  className="kyc-btn-reject-confirm"
                  disabled={!rejectValid || !!busyId}
                  onClick={() => decide(reviewing.id, "rejected", composeRejectReason())}
                  title={!rejectValid ? "Pick a reason and add a note (min 4 chars)" : "Confirm rejection"}
                >
                  {busyId === reviewing.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldX size={14} />} Confirm reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Selfie / doc zoom modal */}
      {zoomUrl && (
        <ZoomModal url={zoomUrl.url} label={zoomUrl.label} onClose={() => setZoomUrl(null)} />
      )}

      {/* Aadhaar front-vs-back compare */}
      {compareOpen && urls?.docFrontUrl && urls?.docBackUrl && (
        <CompareModal
          frontUrl={urls.docFrontUrl}
          backUrl={urls.docBackUrl}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {/* Quick side-panel preview — opens on row click or long-press. */}
      {quickPreview && (
        <KycSidePanel
          row={quickPreview}
          onClose={() => setQuickPreview(null)}
          onOpenFullReview={() => { setReviewing(quickPreview); setQuickPreview(null); }}
          onZoom={(url, label) => setZoomUrl({ url, label })}
        />
      )}
    </div>
  );
}

/**
 * Quick side-panel preview that slides in from the right.
 * - Loads its own signed URLs (independent of the full review modal so it's
 *   instant whether or not the modal has been opened before).
 * - Shows a compact summary, three thumbnails, and a single "Open full review"
 *   button as the path to the heavyweight modal.
 */
function KycSidePanel({
  row, onClose, onOpenFullReview, onZoom,
}: {
  row: KycRow;
  onClose: () => void;
  onOpenFullReview: () => void;
  onZoom: (url: string, label: string) => void;
}) {
  const [urls, setUrls] = useState<{ selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const s = readAdminSession();
    if (!s) { setLoading(false); return; }
    setLoading(true);
    callAdminFn<{ selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null }>({
      action: "kyc_signed_urls", sessionToken: s.sessionToken, submissionId: row.id,
    })
      .then((r) => { if (!cancelled) setUrls(r); })
      .catch(() => { if (!cancelled) setUrls({ selfieUrl: null, docFrontUrl: null, docBackUrl: null }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [row.id]);

  // Close on ESC for keyboard-first admins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const thumbs: Array<{ key: string; label: string; url: string | null }> = [
    { key: "selfie", label: "Selfie", url: urls?.selfieUrl ?? null },
    { key: "front", label: "Aadhaar front", url: urls?.docFrontUrl ?? null },
    { key: "back", label: "Aadhaar back", url: urls?.docBackUrl ?? null },
  ];

  return (
    <>
      <div className="kyc-side-overlay" onClick={onClose} />
      <aside className="kyc-side-panel" role="dialog" aria-label="KYC quick preview">
        <div className="kyc-side-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="a-label" style={{ marginBottom: 2 }}>Quick preview</div>
            <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.profile?.full_name || "Unnamed user"}
            </div>
          </div>
          <StatusPill status={row.status} />
          <button onClick={onClose} className="a-btn-ghost" aria-label="Close" style={{ padding: 6 }}>
            <X size={14} />
          </button>
        </div>

        <div className="kyc-side-body">
          <div className="kyc-side-thumbs">
            {thumbs.map((t) => (
              <div key={t.key}>
                <button
                  type="button"
                  className="kyc-side-thumb"
                  onClick={() => t.url && onZoom(t.url, t.label)}
                  disabled={!t.url}
                  title={t.url ? `Tap to zoom · ${t.label}` : "Not available"}
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: "var(--a-muted)" }} />
                  ) : t.url ? (
                    <img src={t.url} alt={t.label} loading="lazy" />
                  ) : t.key === "selfie" ? (
                    <FileImage size={18} style={{ color: "var(--a-muted)" }} />
                  ) : (
                    <ImageOff size={18} style={{ color: "var(--a-muted)" }} />
                  )}
                </button>
                <div className="kyc-side-thumb-label">{t.label}</div>
              </div>
            ))}
          </div>

          <dl className="kyc-dl">
            <div><dt>Phone</dt><dd className="a-mono">{row.profile?.phone || "—"}</dd></div>
            <div><dt>DOB</dt><dd>{row.profile?.dob || "—"}{ageFromDob(row.profile?.dob) ? ` (${ageFromDob(row.profile?.dob)} yrs)` : ""}</dd></div>
            <div><dt>Aadhaar</dt><dd className="a-mono">{row.profile?.aadhaar_last4 ? `XXXX-XXXX-${row.profile.aadhaar_last4}` : "—"}</dd></div>
            <div><dt>Match</dt><dd><MatchGauge score={row.match_score} /></dd></div>
            <div><dt>Submitted</dt><dd>{timeAgo(row.created_at)}</dd></div>
            <div><dt>Provider</dt><dd>{row.provider}</dd></div>
          </dl>

          {row.reason && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: "var(--a-surface-2)", border: "1px solid var(--a-border)", fontSize: 12 }}>
              <div className="a-label" style={{ marginBottom: 4 }}>Latest reason</div>
              {row.reason}
            </div>
          )}
        </div>

        <div className="kyc-side-foot">
          <Link
            to="/admin/users/$id"
            params={{ id: row.user_id }}
            className="a-btn-ghost"
            onClick={onClose}
            style={{ fontSize: 12 }}
          >
            <ExternalLink size={12} /> Open user
          </Link>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="a-btn-ghost"
            onClick={onOpenFullReview}
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            Open full review →
          </button>
        </div>
      </aside>
    </>
  );
}

function MediaTile({
  label, url, loading, meta, onZoom,
}: {
  label: string;
  url: string | null;
  loading: boolean;
  meta?: string | null;
  onZoom?: (url: string) => void;
}) {
  return (
    <div className="kyc-media">
      <div className="kyc-media-label">
        <span>{label}</span>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {url && onZoom && (
            <button onClick={() => onZoom(url)} className="kyc-copy" title="Tap to zoom">
              <ZoomIn size={11} />
            </button>
          )}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="kyc-copy" title="Open original in new tab">
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
      <button
        type="button"
        className="kyc-media-frame"
        onClick={() => url && onZoom?.(url)}
        disabled={!url || !onZoom}
        style={{
          all: "unset",
          aspectRatio: "1",
          borderRadius: 10,
          border: "1px solid var(--a-border)",
          background: "var(--a-surface-2)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          cursor: url && onZoom ? "zoom-in" : "default",
        }}
        title={url ? "Tap to zoom" : undefined}
      >
        {loading ? (
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--a-muted)" }} />
        ) : url ? (
          <img src={url} alt={label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="kyc-media-empty">
            {label === "Selfie" ? <FileImage size={22} /> : <ImageOff size={22} />}
            <span>Not available</span>
          </div>
        )}
      </button>
      {meta && <div className="kyc-media-meta a-mono">{meta}</div>}
    </div>
  );
}

/** Full-screen image zoom with "Open in new tab" affordance. ESC closes. */
function ZoomModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="kyc-zoom-overlay" onClick={onClose} role="dialog" aria-label={`${label} preview`}>
      <div className="kyc-zoom-toolbar" onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <div style={{ flex: 1 }} />
        <a href={url} target="_blank" rel="noreferrer" className="a-btn-ghost" style={{ fontSize: 12 }}>
          <ExternalLink size={13} /> Open in new tab
        </a>
        <button onClick={onClose} className="a-btn-ghost" style={{ fontSize: 12 }} aria-label="Close preview">
          <X size={13} /> Close
        </button>
      </div>
      <img
        src={url}
        alt={label}
        onClick={(e) => e.stopPropagation()}
        className="kyc-zoom-image"
      />
    </div>
  );
}

/** Side-by-side Aadhaar front/back compare with shared zoom controls. */
function CompareModal({
  frontUrl, backUrl, onClose,
}: { frontUrl: string; backUrl: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(3, z + 0.25));
      if (e.key === "-" || e.key === "_") setZoom((z) => Math.max(0.5, z - 0.25));
      if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="kyc-zoom-overlay" onClick={onClose} role="dialog" aria-label="Aadhaar compare">
      <div className="kyc-zoom-toolbar" onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <SplitSquareHorizontal size={14} /> Aadhaar front vs back
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="a-btn-ghost" style={{ fontSize: 12 }} aria-label="Zoom out">−</button>
        <span className="a-mono" style={{ fontSize: 12, minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="a-btn-ghost" style={{ fontSize: 12 }} aria-label="Zoom in">+</button>
        <button onClick={() => setZoom(1)} className="a-btn-ghost" style={{ fontSize: 12 }}>Reset</button>
        <button onClick={onClose} className="a-btn-ghost" style={{ fontSize: 12 }}>
          <X size={13} /> Close
        </button>
      </div>
      <div className="kyc-compare-grid" onClick={(e) => e.stopPropagation()}>
        <div className="kyc-compare-pane">
          <div className="kyc-compare-label">Front</div>
          <div className="kyc-compare-frame">
            <img src={frontUrl} alt="Aadhaar front" style={{ transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 120ms" }} />
          </div>
          <a href={frontUrl} target="_blank" rel="noreferrer" className="a-btn-ghost" style={{ fontSize: 11, marginTop: 6 }}>
            <ExternalLink size={11} /> Open original
          </a>
        </div>
        <div className="kyc-compare-pane">
          <div className="kyc-compare-label">Back</div>
          <div className="kyc-compare-frame">
            <img src={backUrl} alt="Aadhaar back" style={{ transform: `scale(${zoom})`, transformOrigin: "center center", transition: "transform 120ms" }} />
          </div>
          <a href={backUrl} target="_blank" rel="noreferrer" className="a-btn-ghost" style={{ fontSize: 11, marginTop: 6 }}>
            <ExternalLink size={11} /> Open original
          </a>
        </div>
      </div>
    </div>
  );
}

/** Reviewer action timeline. Reads admin_audit_log via the kyc_history action. */
function ActionTimeline({ events, loading }: { events: HistoryEvent[] | null; loading: boolean }) {
  return (
    <div className="kyc-timeline">
      <div className="a-label" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <HistoryIcon size={11} /> Admin action history
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--a-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={12} className="animate-spin" /> Loading history…
        </div>
      ) : !events || events.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--a-muted)" }}>No admin actions recorded for this submission yet.</div>
      ) : (
        <ul className="kyc-timeline-list">
          {events.map((e) => {
            const tone =
              e.decision === "approved" ? "approve"
              : e.decision === "rejected" ? "reject"
              : "neutral";
            return (
              <li key={e.id} className={`kyc-timeline-item kyc-timeline-${tone}`}>
                <div className="kyc-timeline-dot" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>
                      {e.decision === "approved" ? "Approved" : e.decision === "rejected" ? "Rejected" : e.actionType}
                    </strong>
                    <span style={{ fontSize: 12, color: "var(--a-muted)" }}>
                      by {e.adminName ?? e.adminEmail ?? "unknown"}
                      {e.adminRole ? ` · ${e.adminRole}` : ""}
                    </span>
                    <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>
                      {new Date(e.at).toLocaleString()} · {timeAgo(e.at)}
                    </span>
                  </div>
                  {e.previousStatus && e.decision && (
                    <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>
                      {e.previousStatus} → {e.decision}
                    </div>
                  )}
                  {e.reason && (
                    <div style={{ fontSize: 12, marginTop: 4, color: "var(--a-text)" }}>
                      "{e.reason}"
                    </div>
                  )}
                  {e.adminId && (
                    <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 2 }}>
                      reviewer id {e.adminId.slice(0, 8)}…
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
