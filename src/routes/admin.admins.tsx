import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn, useAdminSession, ROLE_LABELS, ROLE_BADGE, type AdminRole, can } from "@/admin/lib/adminAuth";
import { UserPlus, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/admins")({
  component: AdminAccountsPage,
});

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: "pending" | "active" | "disabled" | "locked";
  totp_enrolled: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  disabled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  locked: "bg-red-500/15 text-red-400 border-red-500/30",
};

const ROLES: AdminRole[] = [
  "super_admin", "operations_manager", "compliance_officer",
  "customer_support", "fraud_analyst", "finance_manager",
];

function AdminAccountsPage() {
  const nav = useNavigate();
  const { admin } = useAdminSession();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  // Hard gate: only super_admin
  useEffect(() => {
    if (admin && !can(admin.role, "manageAdmins")) {
      toast.error("Forbidden — super admin only");
      nav({ to: "/admin" });
    }
  }, [admin, nav]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: AdminRow[] }>({ action: "admins_list" });
      setRows(r.rows);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load admins");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (admin && can(admin.role, "manageAdmins")) void load(); }, [admin]);

  const updateAdmin = async (id: string, patch: { role?: AdminRole; status?: string }) => {
    try {
      await callAdminFn({ action: "admin_update", id, ...patch });
      toast.success("Updated");
      void load();
    } catch (e: any) {
      toast.error(e?.message || "Update failed");
    }
  };

  const resetTotp = async (id: string, email: string) => {
    if (!confirm(`Force-reset TOTP for ${email}? They'll re-enroll on next login.`)) return;
    try {
      await callAdminFn({ action: "totp_reset_admin", id });
      toast.success("TOTP reset");
      void load();
    } catch (e: any) {
      toast.error(e?.message || "Reset failed");
    }
  };

  if (!admin || !can(admin.role, "manageAdmins")) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Admin Accounts</h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Manage admin users, roles, status & 2FA. Super admin only.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
          </button>
          <button onClick={() => setShowInvite(true)} className="a-btn-primary" style={{ padding: "6px 12px", fontSize: 12 }}>
            <UserPlus size={12} /> Invite admin
          </button>
        </div>
      </header>

      <section style={{ border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100 }}>
          <thead>
            <tr style={{ background: "var(--a-surface-2)" }}>
              {["Admin", "Role", "Status", "2FA", "Last login", "Failed", "Actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "var(--a-muted)", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--a-border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isMe = r.id === admin.id;
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--a-border)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 600 }}>{r.name} {isMe && <span style={{ color: "var(--a-muted)", fontWeight: 400, fontSize: 10 }}>(you)</span>}</div>
                    <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>{r.email}</div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      value={r.role}
                      onChange={(e) => updateAdmin(r.id, { role: e.target.value as AdminRole })}
                      disabled={isMe}
                      style={{
                        background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
                        color: "var(--a-text)", borderRadius: 6, padding: "4px 8px", fontSize: 11,
                      }}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${STATUS_BADGE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {r.totp_enrolled ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--a-success, #10b981)", fontSize: 11 }}>
                        <ShieldCheck size={12} /> Enrolled
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--a-muted)", fontSize: 11 }}>
                        <ShieldOff size={12} /> Not enrolled
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--a-muted)", fontSize: 11 }}>
                    {r.last_login_at ? new Date(r.last_login_at).toLocaleString() : "—"}
                    {r.last_login_ip && <div className="a-mono" style={{ fontSize: 9 }}>{r.last_login_ip}</div>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {r.failed_attempts > 0 ? (
                      <span style={{ color: r.failed_attempts >= 3 ? "var(--a-danger, #ef4444)" : "var(--a-warning, #f59e0b)", fontSize: 11 }}>
                        {r.failed_attempts}
                        {r.locked_until && new Date(r.locked_until) > new Date() && <Lock size={10} style={{ marginLeft: 4, display: "inline" }} />}
                      </span>
                    ) : (
                      <span style={{ color: "var(--a-muted)", fontSize: 11 }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.status === "active" && !isMe && (
                        <button onClick={() => updateAdmin(r.id, { status: "disabled" })} className="a-btn-ghost" style={{ padding: "3px 8px", fontSize: 10 }}>
                          Disable
                        </button>
                      )}
                      {r.status === "disabled" && (
                        <button onClick={() => updateAdmin(r.id, { status: "active" })} className="a-btn-ghost" style={{ padding: "3px 8px", fontSize: 10 }}>
                          Enable
                        </button>
                      )}
                      {r.status === "locked" && (
                        <button onClick={() => updateAdmin(r.id, { status: "active" })} className="a-btn-ghost" style={{ padding: "3px 8px", fontSize: 10 }}>
                          Unlock
                        </button>
                      )}
                      {r.totp_enrolled && !isMe && (
                        <button onClick={() => resetTotp(r.id, r.email)} className="a-btn-ghost" style={{ padding: "3px 8px", fontSize: 10 }}>
                          <KeyRound size={10} /> Reset 2FA
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--a-muted)" }}>No admins yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={() => { setShowInvite(false); void load(); }} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("customer_support");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await callAdminFn({ action: "admin_invite", email, name, role });
      toast.success(`Invited ${email}`);
      onCreated();
    } catch (err: any) {
      toast.error(err?.message || "Invite failed");
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 80,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 12,
        padding: 20, width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 12,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Invite admin</h2>
        <p style={{ fontSize: 11, color: "var(--a-muted)", margin: 0 }}>
          Email must be on the allowed domain. Invitee sets password & enrolls TOTP on first login.
        </p>
        <Field label="Full name">
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2}
            style={inputStyle} placeholder="Jane Doe" />
        </Field>
        <Field label="Work email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
            style={inputStyle} placeholder="jane@teenwallet.in" />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} style={inputStyle}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button type="button" onClick={onClose} className="a-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}>Cancel</button>
          <button type="submit" disabled={busy} className="a-btn-primary" style={{ padding: "6px 14px", fontSize: 12 }}>
            {busy ? "Inviting…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
  color: "var(--a-text)", borderRadius: 8, padding: "8px 10px", fontSize: 13,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--a-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {children}
    </label>
  );
}
