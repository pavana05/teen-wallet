import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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

function UsersList() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [kyc, setKyc] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

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

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
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

      {err && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "var(--a-elevated)" }}>
              <tr style={{ textAlign: "left" }}>
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
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: "var(--a-muted)" }}>No users found</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)" }} className="hover:bg-white/5">
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
              ))}
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
