import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn, readAdminSession, useAdminSession, can } from "@/admin/lib/adminAuth";
import { ArrowLeft, Loader2, ShieldCheck, ShieldX, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/admin/users/$id")({
  component: UserDetail,
});

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  aadhaar_last4: string | null;
  kyc_status: string;
  onboarding_stage: string;
  balance: number;
  created_at: string;
  updated_at: string;
}
interface Txn { id: string; amount: number; merchant_name: string; upi_id: string; status: string; created_at: string; fraud_flags: any; }
interface Kyc { id: string; status: string; provider: string; provider_ref: string | null; match_score: number | null; reason: string | null; created_at: string; updated_at: string; }
interface Fraud { id: string; rule_triggered: string; resolution: string | null; created_at: string; transaction_id: string | null; }
interface Audit { id: string; admin_email: string | null; admin_role: string | null; action_type: string; created_at: string; new_value: any; }

interface DetailData {
  profile: Profile;
  transactions: Txn[];
  kyc: Kyc[];
  fraud: Fraud[];
  parental: any;
  audit: Audit[];
}

type Tab = "txn" | "kyc" | "fraud" | "audit";

function UserDetail() {
  const { id } = useParams({ from: "/admin/users/$id" });
  const { admin } = useAdminSession();
  const [data, setData] = useState<DetailData | null>(null);
  const [tab, setTab] = useState<Tab>("txn");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const s = readAdminSession();
    if (!s) return;
    try {
      const r = await callAdminFn<DetailData>({ action: "user_get", sessionToken: s.sessionToken, userId: id });
      setData(r);
      setErr("");
    } catch (e: any) { setErr(e.message || "Failed to load"); }
  }

  useEffect(() => { void load(); }, [id]);

  async function setKyc(newStatus: string) {
    if (!confirm(`Set KYC status to "${newStatus}" for this user?`)) return;
    const reason = newStatus === "rejected" ? prompt("Rejection reason:") || "" : "";
    setBusy(true);
    try {
      const s = readAdminSession();
      await callAdminFn({ action: "user_set_kyc", sessionToken: s!.sessionToken, userId: id, status: newStatus, reason });
      await load();
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setBusy(false); }
  }

  if (!data) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--a-muted)" }}>
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  const p = data.profile;
  const canManage = can(admin?.role, "manageUsers");

  return (
    <div>
      <Link to="/admin/users" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--a-muted)", marginBottom: 12 }}>
        <ArrowLeft size={14} /> Back to users
      </Link>

      {err && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        {/* Left panel: profile */}
        <div className="a-surface" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--a-accent)", color: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>
              {(p.full_name || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.full_name || "(no name)"}</div>
              <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>{p.id}</div>
            </div>
          </div>

          <Field label="Phone" value={maskPhone(p.phone)} mono />
          <Field label="Date of birth" value={p.dob ? `${p.dob} · ${ageFrom(p.dob)} yrs` : "—"} />
          <Field label="Gender" value={p.gender || "—"} />
          <Field label="Aadhaar" value={p.aadhaar_last4 ? `XXXX-XXXX-${p.aadhaar_last4}` : "—"} mono />
          <Field label="KYC Status" value={<KycBadge s={p.kyc_status} />} />
          <Field label="Onboarding" value={<span className="a-mono" style={{ fontSize: 11 }}>{p.onboarding_stage}</span>} />
          <Field label="Wallet balance" value={`₹${Number(p.balance).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} mono />
          <Field label="Joined" value={new Date(p.created_at).toLocaleString()} />
          <Field label="Parental link" value={data.parental ? `${maskPhone(data.parental.parent_phone)} · ${data.parental.parent_verified ? "verified" : "unverified"}` : "—"} />

          {canManage && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--a-border)", display: "grid", gap: 8 }}>
              <div className="a-label" style={{ marginBottom: 4 }}>Actions</div>
              <button className="a-btn" disabled={busy || p.kyc_status === "approved"} onClick={() => setKyc("approved")}>
                <ShieldCheck size={14} /> Approve KYC
              </button>
              <button className="a-btn a-btn-ghost" disabled={busy || p.kyc_status === "rejected"} onClick={() => setKyc("rejected")}>
                <ShieldX size={14} /> Reject KYC
              </button>
              <button className="a-btn a-btn-ghost" disabled={busy} onClick={() => setKyc("not_started")}>
                <RotateCcw size={14} /> Reset KYC
              </button>
            </div>
          )}
        </div>

        {/* Right panel: tabs */}
        <div>
          <div className="a-surface" style={{ display: "flex", borderBottom: "1px solid var(--a-border)", padding: "0 8px" }}>
            <TabBtn id="txn" cur={tab} onClick={setTab}>Transactions ({data.transactions.length})</TabBtn>
            <TabBtn id="kyc" cur={tab} onClick={setTab}>KYC Timeline ({data.kyc.length})</TabBtn>
            <TabBtn id="fraud" cur={tab} onClick={setTab}>Fraud ({data.fraud.length})</TabBtn>
            <TabBtn id="audit" cur={tab} onClick={setTab}>Audit ({data.audit.length})</TabBtn>
          </div>

          <div className="a-surface" style={{ padding: 16, marginTop: -1, borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            {tab === "txn" && <TxnTable rows={data.transactions} />}
            {tab === "kyc" && <KycTimeline rows={data.kyc} />}
            {tab === "fraud" && <FraudTable rows={data.fraud} />}
            {tab === "audit" && <AuditTable rows={data.audit} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="a-label" style={{ marginBottom: 2 }}>{label}</div>
      <div className={mono ? "a-mono" : ""} style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function KycBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    not_started: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${map[s] || ""}`}>{s}</span>;
}

function TabBtn({ id, cur, onClick, children }: { id: Tab; cur: Tab; onClick: (t: Tab) => void; children: React.ReactNode }) {
  const active = cur === id;
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: "12px 16px", fontSize: 12, fontWeight: 500,
        background: "transparent", border: "none", borderBottom: active ? "2px solid var(--a-accent)" : "2px solid transparent",
        color: active ? "var(--a-accent)" : "var(--a-muted)", cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TxnTable({ rows }: { rows: Txn[] }) {
  if (!rows.length) return <Empty msg="No transactions" />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--a-muted)" }}>
            <Th>When</Th><Th>Merchant</Th><Th>UPI</Th><Th>Amount</Th><Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} style={{ borderTop: "1px solid var(--a-border)" }}>
              <td className="a-mono" style={{ padding: 8, color: "var(--a-muted)" }}>{new Date(t.created_at).toLocaleString()}</td>
              <td style={{ padding: 8 }}>{t.merchant_name}</td>
              <td className="a-mono" style={{ padding: 8, color: "var(--a-muted)" }}>{t.upi_id}</td>
              <td className="a-mono" style={{ padding: 8, textAlign: "right" }}>₹{Number(t.amount).toFixed(2)}</td>
              <td style={{ padding: 8 }}><StatusPill s={t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KycTimeline({ rows }: { rows: Kyc[] }) {
  if (!rows.length) return <Empty msg="No KYC submissions" />;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((k) => (
        <div key={k.id} className="a-elevated" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <KycBadge s={k.status} />
            <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{new Date(k.created_at).toLocaleString()}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, fontSize: 12 }}>
            <div><span className="a-label">Provider</span><div>{k.provider}</div></div>
            <div><span className="a-label">Match score</span><div className="a-mono">{k.match_score ?? "—"}</div></div>
            <div style={{ gridColumn: "1 / -1" }}><span className="a-label">Provider ref</span><div className="a-mono" style={{ fontSize: 11 }}>{k.provider_ref || "—"}</div></div>
            {k.reason && <div style={{ gridColumn: "1 / -1" }}><span className="a-label">Reason</span><div>{k.reason}</div></div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function FraudTable({ rows }: { rows: Fraud[] }) {
  if (!rows.length) return <Empty msg="No fraud events" />;
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left", color: "var(--a-muted)" }}><Th>When</Th><Th>Rule</Th><Th>Resolution</Th></tr></thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} style={{ borderTop: "1px solid var(--a-border)" }}>
            <td className="a-mono" style={{ padding: 8, color: "var(--a-muted)" }}>{new Date(f.created_at).toLocaleString()}</td>
            <td style={{ padding: 8 }}>{f.rule_triggered}</td>
            <td style={{ padding: 8, color: "var(--a-muted)" }}>{f.resolution || "open"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditTable({ rows }: { rows: Audit[] }) {
  if (!rows.length) return <Empty msg="No admin actions on this account yet" />;
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left", color: "var(--a-muted)" }}><Th>When</Th><Th>Admin</Th><Th>Action</Th><Th>Details</Th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} style={{ borderTop: "1px solid var(--a-border)" }}>
            <td className="a-mono" style={{ padding: 8, color: "var(--a-muted)" }}>{new Date(a.created_at).toLocaleString()}</td>
            <td style={{ padding: 8 }}>{a.admin_email}<div className="a-label">{a.admin_role}</div></td>
            <td className="a-mono" style={{ padding: 8 }}>{a.action_type}</td>
            <td className="a-mono" style={{ padding: 8, fontSize: 10, color: "var(--a-muted)" }}>{a.new_value ? JSON.stringify(a.new_value) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  return <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${map[s] || ""}`}>{s}</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: 8, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 32, textAlign: "center", color: "var(--a-muted)", fontSize: 13 }}>{msg}</div>;
}

function maskPhone(p: string | null) {
  if (!p) return "—";
  if (p.length < 6) return p;
  return p.slice(0, 3) + " " + "X".repeat(Math.max(0, p.length - 7)) + " " + p.slice(-4);
}
function ageFrom(dob: string) {
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
