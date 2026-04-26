import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { callAdminFn, readAdminSession, can } from "@/admin/lib/adminAuth";
import { Search, Loader2, ShieldCheck, ShieldX, CheckSquare, Square, Lock, Unlock, Tag, Check } from "lucide-react";
import { VirtualTable, type Column } from "@/admin/components/VirtualTable";
import { usePersistedState } from "@/admin/lib/usePersistedState";
import { SavedViewsBar } from "@/admin/components/SavedViewsBar";
import { recordPanelLoad } from "@/admin/lib/perfBus";

export const Route = createFileRoute("/admin/users")({
  component: UsersList,
});

interface UserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  dob: string | null;
  kyc_status: "not_started" | "pending" | "approved" | "rejected";
  onboarding_stage: string;
  balance: number;
  created_at: string;
  aadhaar_last4: string | null;
  txn_count: number;
  account_locked?: boolean;
  account_tag?: string;
}

const KYC_BADGE: Record<string, string> = {
  not_started: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface Filters {
  search: string;
  kyc: string;
  sortKey: string;
  sortDir: "asc" | "desc";
}
const PAGE_SIZE = 50;

function UsersList() {
  const admin = useMemo(() => readAdminSession()?.admin, []);
  const [filters, setFilters] = usePersistedState<Filters>("tw_admin_users_v2", {
    search: "",
    kyc: "",
    sortKey: "created_at",
    sortDir: "desc",
  });
  const [searchInput, setSearchInput] = useState(filters.search);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [err, setErr] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Generalised bulk action sheet — `kind` decides which form is shown.
  const [bulkOpen, setBulkOpen] = useState<null | { kind: "kyc"; decision: "approved" | "rejected" } | { kind: "lock"; lock: boolean } | { kind: "tag" }>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkTag, setBulkTag] = useState<"standard" | "vip" | "watchlist">("standard");
  const [bulkBusy, setBulkBusy] = useState(false);

  const canDecide = can(admin?.role, "decideKyc");
  const canManage = can(admin?.role, "manageUsers");

  // Debounce search → filters.search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters((f) => ({ ...f, search: searchInput }));
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.search, setFilters]);

  // Fetch a single page; if pageNum===1 it replaces, else appends.
  const reqId = useRef(0);
  const fetchPage = useCallback(async (pageNum: number) => {
    const s = readAdminSession();
    if (!s) return;
    const myReq = ++reqId.current;
    if (pageNum === 1) setInitialLoading(true);
    else setLoadingMore(true);
    const t0 = performance.now();
    try {
      const r = await callAdminFn<{ rows: UserRow[]; total: number }>({
        action: "users_list",
        sessionToken: s.sessionToken,
        page: pageNum,
        pageSize: PAGE_SIZE,
        search: filters.search,
        kyc: filters.kyc,
        sortKey: filters.sortKey,
        sortDir: filters.sortDir,
      });
      // Drop stale responses.
      if (myReq !== reqId.current) return;
      setTotal(r.total);
      setHasMore(pageNum * PAGE_SIZE < r.total);
      setRows((prev) => (pageNum === 1 ? r.rows : [...prev, ...r.rows]));
      setErr("");
      recordPanelLoad("Users · list", performance.now() - t0);
    } catch (e: any) {
      if (myReq === reqId.current) setErr(e.message || "Failed");
    } finally {
      if (myReq === reqId.current) {
        setInitialLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filters.search, filters.kyc, filters.sortKey, filters.sortDir]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    void fetchPage(1);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || initialLoading || !hasMore) return;
    const next = page + 1;
    setPage(next);
    void fetchPage(next);
  }, [page, hasMore, loadingMore, initialLoading, fetchPage]);

  function toggleSort(k: string) {
    setFilters((f) => f.sortKey === k
      ? { ...f, sortDir: f.sortDir === "asc" ? "desc" : "asc" }
      : { ...f, sortKey: k, sortDir: "desc" });
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }

  // Generic bulk runner — fans out to the right edge function action based on
  // the open form. All variants require an admin note (audited) for traceability.
  async function runBulk() {
    if (!bulkOpen) return;
    const s = readAdminSession(); if (!s) return;
    setBulkBusy(true); setErr("");
    try {
      const ids = Array.from(selected);
      let r: { success: number; failed: number };
      if (bulkOpen.kind === "kyc") {
        r = await callAdminFn({
          action: "kyc_decide_bulk", sessionToken: s.sessionToken,
          userIds: ids, decision: bulkOpen.decision, reason: bulkReason,
        });
      } else if (bulkOpen.kind === "lock") {
        r = await callAdminFn({
          action: "users_bulk_lock", sessionToken: s.sessionToken,
          userIds: ids, lock: bulkOpen.lock, note: bulkNote,
        });
      } else {
        r = await callAdminFn({
          action: "users_bulk_tag", sessionToken: s.sessionToken,
          userIds: ids, tag: bulkTag, note: bulkNote,
        });
      }
      setBulkOpen(null); setBulkReason(""); setBulkNote(""); setSelected(new Set());
      setPage(1); await fetchPage(1);
      alert(`Done: ${r.success} updated, ${r.failed} failed.`);
    } catch (e: any) { setErr(e.message || "Bulk action failed"); }
    finally { setBulkBusy(false); }
  }

  // Build columns
  const columns: Column<UserRow>[] = useMemo(() => {
    const cols: Column<UserRow>[] = [];
    if (canDecide) {
      cols.push({
        key: "sel",
        header: (
          <button onClick={(e) => { e.stopPropagation(); toggleAll(); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--a-muted)", padding: 0 }}>
            {selected.size === rows.length && rows.length > 0
              ? <CheckSquare size={14} style={{ color: "var(--a-accent)" }} />
              : <Square size={14} />}
          </button>
        ),
        width: "40px",
        cell: (r) => {
          const sel = selected.has(r.id);
          return (
            <button onClick={(e) => { e.stopPropagation(); toggleRow(r.id); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--a-muted)", padding: 0 }}>
              {sel ? <CheckSquare size={14} style={{ color: "var(--a-accent)" }} /> : <Square size={14} />}
            </button>
          );
        },
      });
    }
    cols.push(
      {
        key: "name", header: "Name", width: "1.6fr",
        sortDir: filters.sortKey === "full_name" ? filters.sortDir : undefined,
        onSort: () => toggleSort("full_name"),
        cell: (r) => (
          <Link to="/admin/users/$id" params={{ id: r.id }} style={{ color: "var(--a-accent)", fontWeight: 500 }}>
            {r.full_name || <span style={{ color: "var(--a-muted)" }}>(no name)</span>}
          </Link>
        ),
      },
      { key: "phone", header: "Phone", width: "1.2fr", cell: (r) => <span className="a-mono" style={{ color: "var(--a-muted)" }}>{maskPhone(r.phone)}</span> },
      { key: "id", header: "User ID", width: "0.9fr", cell: (r) => <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{r.id.slice(0, 8)}…</span> },
      {
        key: "kyc", header: "KYC", width: "0.9fr",
        sortDir: filters.sortKey === "kyc_status" ? filters.sortDir : undefined,
        onSort: () => toggleSort("kyc_status"),
        cell: (r) => <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${KYC_BADGE[r.kyc_status] || ""}`}>{r.kyc_status}</span>,
      },
      {
        key: "balance", header: "Balance", width: "1fr", align: "right",
        sortDir: filters.sortKey === "balance" ? filters.sortDir : undefined,
        onSort: () => toggleSort("balance"),
        cell: (r) => <span className="a-mono">₹{Number(r.balance).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>,
      },
      { key: "txns", header: "Txns", width: "0.6fr", align: "right", cell: (r) => <span className="a-mono">{r.txn_count}</span> },
      {
        key: "created", header: "Joined", width: "1fr",
        sortDir: filters.sortKey === "created_at" ? filters.sortDir : undefined,
        onSort: () => toggleSort("created_at"),
        cell: (r) => <span className="a-mono" style={{ color: "var(--a-muted)" }}>{new Date(r.created_at).toLocaleDateString()}</span>,
      },
    );
    return cols;
  }, [canDecide, selected, rows, filters.sortKey, filters.sortDir]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Users</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            {total.toLocaleString()} total · showing {rows.length.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--a-muted)" }} />
          <input className="a-input" placeholder="Search name, phone, ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select className="a-input" value={filters.kyc} onChange={(e) => setFilters((f) => ({ ...f, kyc: e.target.value }))} style={{ width: 180 }}>
          <option value="">All KYC statuses</option>
          <option value="not_started">Not started</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {(initialLoading || loadingMore) && <Loader2 size={14} className="animate-spin" style={{ color: "var(--a-muted)" }} />}
      </div>

      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--a-muted)" }} />
          <input className="a-input" placeholder="Search name, phone, ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select className="a-input" value={filters.kyc} onChange={(e) => setFilters((f) => ({ ...f, kyc: e.target.value }))} style={{ width: 180 }}>
          <option value="">All KYC statuses</option>
          <option value="not_started">Not started</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {(initialLoading || loadingMore) && <Loader2 size={14} className="animate-spin" style={{ color: "var(--a-muted)" }} />}
      </div>

      <div className="a-surface" style={{ padding: "8px 12px", marginBottom: 12 }}>
        <SavedViewsBar<Filters>
          scope="users"
          current={filters}
          onApply={(f) => { setFilters(f); setSearchInput(f.search); }}
          isActive={(f) => f.kyc === filters.kyc && f.search === filters.search && f.sortKey === filters.sortKey && f.sortDir === filters.sortDir}
        />
      </div>

      {selected.size > 0 && (
        <div className="a-surface" style={{ padding: 10, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: "var(--a-accent)", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13 }}>{selected.size} selected</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canDecide && (
              <>
                <button className="a-btn" onClick={() => setBulkOpen({ kind: "kyc", decision: "approved" })}><ShieldCheck size={14} /> Approve KYC</button>
                <button className="a-btn-ghost" style={{ color: "#fca5a5" }} onClick={() => setBulkOpen({ kind: "kyc", decision: "rejected" })}><ShieldX size={14} /> Reject KYC</button>
              </>
            )}
            {canManage && (
              <>
                <button className="a-btn-ghost" onClick={() => setBulkOpen({ kind: "lock", lock: true })}><Lock size={14} /> Lock</button>
                <button className="a-btn-ghost" onClick={() => setBulkOpen({ kind: "lock", lock: false })}><Unlock size={14} /> Unlock</button>
                <button className="a-btn-ghost" onClick={() => setBulkOpen({ kind: "tag" })}><Tag size={14} /> Change role</button>
              </>
            )}
            <button className="a-btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      {err && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <VirtualTable<UserRow>
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        rowStyle={(r) => selected.has(r.id) ? { background: "rgba(200,241,53,0.05)" } : undefined}
        height={620}
        rowHeight={56}
        initialLoading={initialLoading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        empty="No users found"
      />

      {/* Bulk action sheet — KYC / Lock / Tag share the same shell */}
      {bulkOpen && (
        <BulkSheet
          bulkOpen={bulkOpen}
          count={selected.size}
          busy={bulkBusy}
          err={err}
          reason={bulkReason} setReason={setBulkReason}
          note={bulkNote} setNote={setBulkNote}
          tag={bulkTag} setTag={setBulkTag}
          onCancel={() => setBulkOpen(null)}
          onConfirm={() => void runBulk()}
        />
      )}
    </div>
  );
}

// ── Bulk action confirmation sheet ────────────────────────────────────────────
type BulkOpen =
  | { kind: "kyc"; decision: "approved" | "rejected" }
  | { kind: "lock"; lock: boolean }
  | { kind: "tag" };

function BulkSheet(props: {
  bulkOpen: BulkOpen;
  count: number;
  busy: boolean;
  err: string;
  reason: string; setReason: (v: string) => void;
  note: string; setNote: (v: string) => void;
  tag: "standard" | "vip" | "watchlist"; setTag: (v: "standard" | "vip" | "watchlist") => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { bulkOpen, count, busy, err, reason, setReason, note, setNote, tag, setTag, onCancel, onConfirm } = props;

  const title =
    bulkOpen.kind === "kyc" ? `Bulk ${bulkOpen.decision === "approved" ? "approve" : "reject"} KYC`
    : bulkOpen.kind === "lock" ? (bulkOpen.lock ? "Lock accounts" : "Unlock accounts")
    : "Change account tag";

  const intro =
    bulkOpen.kind === "kyc" ? <>This will set KYC <b>{bulkOpen.decision}</b> for <b>{count}</b> users and notify each. Audit logged.</>
    : bulkOpen.kind === "lock" ? <>This will mark <b>{count}</b> accounts as <b>{bulkOpen.lock ? "locked" : "unlocked"}</b>. Locked accounts can be later unlocked from this same screen. Audit logged.</>
    : <>Apply a tag to <b>{count}</b> accounts. Tags are used as soft groupings for monitoring.</>;

  const confirmDisabled =
    busy ||
    (bulkOpen.kind === "kyc" && bulkOpen.decision === "rejected" && !reason) ||
    (bulkOpen.kind === "lock" && !note.trim()); // require justification for lock/unlock

  return (
    <div onClick={() => !busy && onCancel()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{title}</h3>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 16 }}>{intro}</p>

        {bulkOpen.kind === "kyc" && bulkOpen.decision === "rejected" && (
          <>
            <div className="a-label" style={{ marginBottom: 6 }}>Rejection reason (sent to users)</div>
            <select className="a-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select…</option>
              <option value="Name mismatch">Name mismatch</option>
              <option value="Selfie unclear">Selfie unclear</option>
              <option value="Invalid Aadhaar">Invalid Aadhaar</option>
              <option value="Age below 13">Age below 13</option>
              <option value="Other">Other</option>
            </select>
          </>
        )}

        {bulkOpen.kind === "tag" && (
          <>
            <div className="a-label" style={{ marginBottom: 6 }}>Tag</div>
            <select className="a-input" value={tag} onChange={(e) => setTag(e.target.value as "standard" | "vip" | "watchlist")}>
              <option value="standard">standard</option>
              <option value="vip">vip</option>
              <option value="watchlist">watchlist</option>
            </select>
          </>
        )}

        {(bulkOpen.kind === "lock" || bulkOpen.kind === "tag") && (
          <>
            <div className="a-label" style={{ marginTop: 12, marginBottom: 6 }}>
              Audit note {bulkOpen.kind === "lock" ? "(required)" : "(optional)"}
            </div>
            <textarea
              className="a-input"
              rows={3}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Suspected card-testing pattern; locking pending fraud review"
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </>
        )}

        {err && <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="a-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            className="a-btn"
            disabled={confirmDisabled}
            onClick={onConfirm}
            style={
              bulkOpen.kind === "kyc" && bulkOpen.decision === "rejected" ? { background: "#ef4444", color: "white" }
              : bulkOpen.kind === "lock" && bulkOpen.lock ? { background: "#ef4444", color: "white" }
              : undefined
            }
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Confirm ({count})
          </button>
        </div>
      </div>
    </div>
  );
}

function maskPhone(p: string | null) {
  if (!p) return "—";
  if (p.length < 6) return p;
  return p.slice(0, 3) + " " + "X".repeat(Math.max(0, p.length - 7)) + " " + p.slice(-4);
}
