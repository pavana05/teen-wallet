import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { callAdminFn, readAdminSession, can, useAdminSession } from "@/admin/lib/adminAuth";
import { Search, ChevronLeft, ChevronRight, Loader2, ShieldCheck, ShieldX, CheckSquare, Square } from "lucide-react";

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
}

const KYC_BADGE: Record<string, string> = {
  not_started: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
};

const LS_KEY = "tw_admin_users_prefs_v1";
type Prefs = { pageSize: number; sortKey: string; sortDir: "asc" | "desc"; kyc: string; search: string };
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { pageSize: 25, sortKey: "created_at", sortDir: "desc", kyc: "", search: "", ...JSON.parse(raw) };
  } catch {}
  return { pageSize: 25, sortKey: "created_at", sortDir: "desc", kyc: "", search: "" };
}
function savePrefs(p: Prefs) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {} }

function UsersList() {
  const { admin } = useAdminSession();
  const initial = useMemo(() => loadPrefs(), []);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [search, setSearch] = useState(initial.search);
  const [searchInput, setSearchInput] = useState(initial.search);
  const [kyc, setKyc] = useState(initial.kyc);
  const [sortKey, setSortKey] = useState(initial.sortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initial.sortDir);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<null | "approved" | "rejected">(null);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const canDecide = can(admin?.role, "decideKyc");

  // Persist prefs
  useEffect(() => { savePrefs({ pageSize, sortKey, sortDir, kyc, search }); }, [pageSize, sortKey, sortDir, kyc, search]);

  const load = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: UserRow[]; total: number }>({
        action: "users_list",
        sessionToken: s.sessionToken,
        page, pageSize, search, kyc, sortKey, sortDir,
      });
      setRows(r.rows);
      setTotal(r.total);
      setErr("");
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setLoading(false); }
  }, [page, pageSize, search, kyc, sortKey, sortDir]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Clear selection when page/filters change
  useEffect(() => { setSelected(new Set()); }, [page, pageSize, search, kyc, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  }
  function toggleRow(id: string) {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function bulkDecide() {
    if (!bulkOpen) return;
    const s = readAdminSession(); if (!s) return;
    setBulkBusy(true); setErr("");
    try {
      const r = await callAdminFn<{ success: number; failed: number }>({
        action: "kyc_decide_bulk", sessionToken: s.sessionToken,
        userIds: Array.from(selected), decision: bulkOpen, reason: bulkReason,
      });
      setBulkOpen(null); setBulkReason(""); setSelected(new Set());
      await load();
      alert(`Done: ${r.success} updated, ${r.failed} failed.`);
    } catch (e: any) { setErr(e.message || "Bulk action failed"); }
    finally { setBulkBusy(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Users</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>{total.toLocaleString()} total</p>
        </div>
      </div>

      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--a-muted)" }} />
          <input className="a-input" placeholder="Search name, phone, ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select className="a-input" value={kyc} onChange={(e) => { setKyc(e.target.value); setPage(1); }} style={{ width: 180 }}>
          <option value="">All KYC statuses</option>
          <option value="not_started">Not started</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="a-input" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ width: 110 }}>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        {loading && <Loader2 size={14} className="animate-spin" style={{ color: "var(--a-muted)" }} />}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="a-surface" style={{ padding: 10, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: "var(--a-accent)" }}>
          <div style={{ fontSize: 13 }}>{selected.size} selected</div>
          <div style={{ display: "flex", gap: 8 }}>
            {canDecide && (
              <>
                <button className="a-btn" onClick={() => setBulkOpen("approved")}><ShieldCheck size={14} /> Approve KYC</button>
                <button className="a-btn-ghost" style={{ color: "#fca5a5" }} onClick={() => setBulkOpen("rejected")}><ShieldX size={14} /> Reject KYC</button>
              </>
            )}
            <button className="a-btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      {err && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "var(--a-elevated)" }}>
              <tr style={{ textAlign: "left" }}>
                {canDecide && (
                  <th style={{ padding: "10px 8px", width: 32 }}>
                    <button onClick={toggleAll} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--a-muted)", padding: 0 }}>
                      {selected.size === rows.length && rows.length > 0 ? <CheckSquare size={16} style={{ color: "var(--a-accent)" }} /> : <Square size={16} />}
                    </button>
                  </th>
                )}
                <Th sk="full_name" cur={sortKey} dir={sortDir} onClick={toggleSort}>Name</Th>
                <Th>Phone</Th>
                <Th>User ID</Th>
                <Th sk="kyc_status" cur={sortKey} dir={sortDir} onClick={toggleSort}>KYC</Th>
                <Th sk="balance" cur={sortKey} dir={sortDir} onClick={toggleSort}>Balance</Th>
                <Th>Txns</Th>
                <Th sk="created_at" cur={sortKey} dir={sortDir} onClick={toggleSort}>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={canDecide ? 8 : 7} style={{ textAlign: "center", padding: 32, color: "var(--a-muted)" }}>No users found</td></tr>
              )}
              {rows.map((r) => {
                const sel = selected.has(r.id);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)", background: sel ? "rgba(200,241,53,0.05)" : undefined }} className="hover:bg-white/5">
                    {canDecide && (
                      <td style={{ padding: "10px 8px" }}>
                        <button onClick={() => toggleRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--a-muted)", padding: 0 }}>
                          {sel ? <CheckSquare size={16} style={{ color: "var(--a-accent)" }} /> : <Square size={16} />}
                        </button>
                      </td>
                    )}
                    <td style={{ padding: "10px 12px" }}>
                      <Link to="/admin/users/$id" params={{ id: r.id }} style={{ color: "var(--a-accent)", fontWeight: 500 }}>
                        {r.full_name || <span style={{ color: "var(--a-muted)" }}>(no name)</span>}
                      </Link>
                    </td>
                    <td className="a-mono" style={{ padding: "10px 12px", color: "var(--a-muted)" }}>{maskPhone(r.phone)}</td>
                    <td className="a-mono" style={{ padding: "10px 12px", fontSize: 11, color: "var(--a-muted)" }}>{r.id.slice(0, 8)}…</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${KYC_BADGE[r.kyc_status] || ""}`}>{r.kyc_status}</span>
                    </td>
                    <td className="a-mono" style={{ padding: "10px 12px", textAlign: "right" }}>₹{Number(r.balance).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td className="a-mono" style={{ padding: "10px 12px", textAlign: "right" }}>{r.txn_count}</td>
                    <td className="a-mono" style={{ padding: "10px 12px", color: "var(--a-muted)" }}>{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderTop: "1px solid var(--a-border)" }}>
          <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>
            Page {page} of {totalPages} · {Math.min(pageSize, rows.length)} of {total.toLocaleString()}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="a-btn a-btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: "6px 10px", fontSize: 12 }}><ChevronLeft size={14} /> Prev</button>
            <button className="a-btn a-btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: "6px 10px", fontSize: 12 }}>Next <ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Bulk decide modal */}
      {bulkOpen && (
        <div onClick={() => !bulkBusy && setBulkOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              Bulk {bulkOpen === "approved" ? "approve" : "reject"} KYC
            </h3>
            <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 16 }}>
              This will set KYC <b>{bulkOpen}</b> for <b>{selected.size}</b> users and notify each. Audit logged.
            </p>
            {bulkOpen === "rejected" && (
              <>
                <div className="a-label" style={{ marginBottom: 6 }}>Rejection reason (sent to users)</div>
                <select className="a-input" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="Name mismatch">Name mismatch</option>
                  <option value="Selfie unclear">Selfie unclear</option>
                  <option value="Invalid Aadhaar">Invalid Aadhaar</option>
                  <option value="Age below 13">Age below 13</option>
                  <option value="Other">Other</option>
                </select>
              </>
            )}
            {err && <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="a-btn-ghost" disabled={bulkBusy} onClick={() => setBulkOpen(null)}>Cancel</button>
              <button className="a-btn" disabled={bulkBusy || (bulkOpen === "rejected" && !bulkReason)} onClick={() => void bulkDecide()}
                style={bulkOpen === "rejected" ? { background: "#ef4444", color: "white" } : undefined}>
                {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : (bulkOpen === "approved" ? <ShieldCheck size={14} /> : <ShieldX size={14} />)}
                Confirm {bulkOpen === "approved" ? "approve" : "reject"} ({selected.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, sk, cur, dir, onClick }: { children: React.ReactNode; sk?: string; cur?: string; dir?: string; onClick?: (k: string) => void }) {
  const sortable = !!sk && !!onClick;
  const active = sk && cur === sk;
  return (
    <th
      onClick={sortable ? () => onClick!(sk!) : undefined}
      style={{ padding: "10px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: active ? "var(--a-accent)" : "var(--a-muted)", cursor: sortable ? "pointer" : "default", whiteSpace: "nowrap", userSelect: "none" }}
    >
      {children}{active && (dir === "asc" ? " ↑" : " ↓")}
    </th>
  );
}

function maskPhone(p: string | null) {
  if (!p) return "—";
  if (p.length < 6) return p;
  return p.slice(0, 3) + " " + "X".repeat(Math.max(0, p.length - 7)) + " " + p.slice(-4);
}
