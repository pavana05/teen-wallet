import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import {
  callAdminFn, readAdminSession, useAdminSession, can, ROLE_LABELS, ROLE_BADGE,
  type AdminRole,
} from "@/admin/lib/adminAuth";
import {
  Loader2, RefreshCw, UserPlus, ShieldOff, ShieldCheck, KeyRound, Smartphone, AlertTriangle, Lock,
} from "lucide-react";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: "active" | "locked" | "disabled" | "pending";
  totp_enrolled: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  admin_email: string | null;
  admin_role: string | null;
  action_type: string;
  target_entity: string | null;
  target_id: string | null;
  ip_address: string | null;
  created_at: string;
  new_value: any;
  old_value: any;
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  locked: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  disabled: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  pending: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function SettingsPage() {
  const { admin } = useAdminSession();
  const [tab, setTab] = useState<"admins" | "audit" | "profile">("profile");

  const tabs = [
    { id: "profile" as const, label: "My profile" },
    ...(can(admin?.role, "manageAdmins") ? [{ id: "admins" as const, label: "Admin team" }] : []),
    ...(can(admin?.role, "viewAuditLog") ? [{ id: "audit" as const, label: "Audit log" }] : []),
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Settings</h1>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>Account, team, and audit trail.</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--a-border)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 14px", fontSize: 13, fontWeight: 500,
              background: "transparent", border: "none", cursor: "pointer",
              color: tab === t.id ? "var(--a-accent)" : "var(--a-muted)",
              borderBottom: `2px solid ${tab === t.id ? "var(--a-accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === "profile" && <ProfilePanel />}
      {tab === "admins" && <AdminsPanel />}
      {tab === "audit" && <AuditPanel />}
    </div>
  );
}

// ============== PROFILE PANEL — TOTP self-reset ==============
function ProfilePanel() {
  const { admin, expiresAt } = useAdminSession();
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [stage, setStage] = useState<"idle" | "enroll" | "done">("idle");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");

  useEffect(() => {
    if (otpauthUrl) {
      QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: "#0c0c0e", light: "#d4c5a0" } })
        .then(setQrSrc).catch(() => {});
    }
  }, [otpauthUrl]);

  async function startReset() {
    const s = readAdminSession();
    if (!s) return;
    setErr(""); setBusy(true);
    try {
      const r = await callAdminFn<any>({ action: "totp_reset_self", sessionToken: s.sessionToken, password });
      setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setChallengeToken(r.challengeToken);
      setStage("enroll"); setPassword("");
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally { setBusy(false); }
  }

  async function verifyEnroll() {
    setErr(""); setBusy(true);
    try {
      await callAdminFn({ action: "verify_totp", challengeToken, code });
      setStage("done");
      setTimeout(() => { setResetOpen(false); setStage("idle"); setCode(""); setQrSrc(""); }, 2000);
    } catch (e: any) {
      setErr(e.message || "Invalid code");
    } finally { setBusy(false); }
  }

  return (
    <div className="a-surface" style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{admin?.name}</div>
          <div className="a-mono" style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 2 }}>{admin?.email}</div>
        </div>
        {admin?.role && (
          <span className={`${ROLE_BADGE[admin.role]} a-mono`} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>
            {ROLE_LABELS[admin.role]}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <Stat label="Session expires" value={expiresAt ? new Date(expiresAt).toLocaleTimeString() : "—"} />
        <Stat label="Two-factor" value={<span style={{ color: "var(--a-success)" }}>Enabled</span>} />
      </div>

      <div style={{ borderTop: "1px solid var(--a-border)", paddingTop: 20 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <Smartphone size={16} style={{ color: "var(--a-accent)" }} />
          <div style={{ fontWeight: 600 }}>Authenticator app</div>
        </div>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 12 }}>
          Lost your phone or replaced your authenticator? Reset your TOTP and re-enroll. Your password will be required.
        </p>
        <button className="a-btn-ghost" onClick={() => setResetOpen(true)}>
          <KeyRound size={14} /> Reset 2FA
        </button>
      </div>

      {resetOpen && (
        <div onClick={() => !busy && stage === "idle" && setResetOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
            {stage === "idle" && (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Confirm with your password</h3>
                <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 16 }}>This will invalidate your current authenticator. You'll need to re-scan a new QR.</p>
                <input className="a-input" type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                {err && <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button className="a-btn-ghost" onClick={() => setResetOpen(false)} disabled={busy}>Cancel</button>
                  <button className="a-btn" onClick={() => void startReset()} disabled={busy || !password}>
                    {busy && <Loader2 size={14} className="animate-spin" />} Continue
                  </button>
                </div>
              </>
            )}
            {stage === "enroll" && (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Scan new QR</h3>
                <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 12 }}>Add this account to Google Authenticator / Authy, then enter the 6-digit code.</p>
                {qrSrc && <img src={qrSrc} alt="TOTP QR" style={{ display: "block", margin: "0 auto 12px", borderRadius: 8 }} />}
                <div className="a-mono" style={{ fontSize: 11, textAlign: "center", color: "var(--a-muted)", wordBreak: "break-all", marginBottom: 12 }}>Secret: {secret}</div>
                <input className="a-input a-mono" inputMode="numeric" maxLength={6} placeholder="123456"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
                {err && <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button className="a-btn" onClick={() => void verifyEnroll()} disabled={busy || code.length !== 6}>
                    {busy && <Loader2 size={14} className="animate-spin" />} Verify & enable
                  </button>
                </div>
              </>
            )}
            {stage === "done" && (
              <div style={{ textAlign: "center", padding: 12 }}>
                <ShieldCheck size={36} style={{ color: "var(--a-success)", margin: "0 auto 8px" }} />
                <div style={{ fontWeight: 700 }}>2FA reset complete</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="a-elevated" style={{ padding: 12 }}>
      <div className="a-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// ============== ADMINS PANEL ==============
function AdminsPanel() {
  const { admin } = useAdminSession();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: AdminRow[] }>({ action: "admins_list", sessionToken: s.sessionToken });
      setRows(r.rows); setErr("");
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function update(id: string, changes: Partial<{ role: string; status: string }>) {
    const s = readAdminSession(); if (!s) return;
    setBusyId(id); setErr("");
    try {
      await callAdminFn({ action: "admin_update", sessionToken: s.sessionToken, id, ...changes });
      await load();
    } catch (e: any) { setErr(e.message || "Update failed"); }
    finally { setBusyId(null); }
  }

  async function resetTotp(id: string) {
    if (!confirm("Reset this admin's 2FA? They will need to re-enroll on next login.")) return;
    const s = readAdminSession(); if (!s) return;
    setBusyId(id); setErr("");
    try {
      await callAdminFn({ action: "totp_reset_admin", sessionToken: s.sessionToken, id });
      await load();
    } catch (e: any) { setErr(e.message || "Reset failed"); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--a-muted)" }}>{rows.length} admin{rows.length !== 1 ? "s" : ""}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="a-btn-ghost" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
          <button className="a-btn" onClick={() => setInviteOpen(true)}><UserPlus size={14} /> Invite admin</button>
        </div>
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--a-elevated)", color: "var(--a-muted)", textAlign: "left" }}>
              <th style={{ padding: 12 }}>Admin</th>
              <th style={{ padding: 12 }}>Role</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>2FA</th>
              <th style={{ padding: 12 }}>Last login</th>
              <th style={{ padding: 12, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}><Loader2 size={16} className="animate-spin" style={{ display: "inline-block", marginRight: 8 }} />Loading…</td></tr>}
            {!loading && rows.map((r) => {
              const isMe = r.id === admin?.id;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)" }}>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>{r.name} {isMe && <span style={{ color: "var(--a-accent)", fontSize: 11 }}>(you)</span>}</div>
                    <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{r.email}</div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <select className="a-input" value={r.role} disabled={isMe || busyId === r.id} onChange={(e) => void update(r.id, { role: e.target.value })} style={{ padding: "6px 8px", fontSize: 12, width: "auto" }}>
                      {Object.entries(ROLE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className={STATUS_BADGE[r.status]} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid", fontSize: 11, textTransform: "uppercase" }}>{r.status}</span>
                    {r.failed_attempts > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--a-warn)" }}>{r.failed_attempts} failed</span>}
                  </td>
                  <td style={{ padding: 12 }}>
                    {r.totp_enrolled
                      ? <span style={{ color: "var(--a-success)", fontSize: 12 }}><ShieldCheck size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Enrolled</span>
                      : <span style={{ color: "var(--a-muted)", fontSize: 12 }}><AlertTriangle size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Not enrolled</span>}
                  </td>
                  <td style={{ padding: 12, color: "var(--a-muted)", fontSize: 12 }}>
                    {r.last_login_at ? new Date(r.last_login_at).toLocaleString() : "Never"}
                    {r.last_login_ip && <div className="a-mono" style={{ fontSize: 10 }}>{r.last_login_ip}</div>}
                  </td>
                  <td style={{ padding: 12, textAlign: "right" }}>
                    {!isMe && (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        {r.status === "active" && <button className="a-btn-ghost" onClick={() => void update(r.id, { status: "disabled" })} disabled={busyId === r.id}><ShieldOff size={12} /> Disable</button>}
                        {(r.status === "disabled" || r.status === "locked") && <button className="a-btn-ghost" onClick={() => void update(r.id, { status: "active" })} disabled={busyId === r.id}><ShieldCheck size={12} /> Activate</button>}
                        {r.totp_enrolled && <button className="a-btn-ghost" onClick={() => void resetTotp(r.id)} disabled={busyId === r.id} title="Reset 2FA"><Lock size={12} /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onCreated={() => { setInviteOpen(false); void load(); }} />}
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("customer_support");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = readAdminSession(); if (!s) return;
    setBusy(true); setErr("");
    try {
      await callAdminFn({ action: "admin_invite", sessionToken: s.sessionToken, email, name, role });
      onCreated();
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="a-surface" style={{ maxWidth: 460, width: "100%", padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Invite admin</h3>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginBottom: 16 }}>An account is created in pending state. They set their password & enroll 2FA on first login.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="a-label" style={{ marginBottom: 6 }}>Full name</div>
            <input className="a-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <div className="a-label" style={{ marginBottom: 6 }}>Email (must be @teenwallet.in)</div>
            <input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <div className="a-label" style={{ marginBottom: 6 }}>Role</div>
            <select className="a-input" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {Object.entries(ROLE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
        </div>
        {err && <div style={{ marginTop: 12, padding: 8, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" className="a-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="a-btn" disabled={busy || !email || !name}>{busy && <Loader2 size={14} className="animate-spin" />} Invite</button>
        </div>
      </form>
    </div>
  );
}

// ============== AUDIT PANEL ==============
function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [adminEmail, setAdminEmail] = useState("");
  const [actionType, setActionType] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const s = readAdminSession(); if (!s) return;
    setLoading(true); setErr("");
    try {
      const r = await callAdminFn<{ rows: AuditRow[]; total: number }>({
        action: "audit_log_list", sessionToken: s.sessionToken,
        adminEmail, actionType, page, pageSize,
      });
      setRows(r.rows); setTotal(r.total);
    } catch (e: any) { setErr(e.message || "Failed"); }
    finally { setLoading(false); }
  }, [adminEmail, actionType, page]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="a-surface" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input className="a-input" placeholder="Filter by admin email…" value={adminEmail} onChange={(e) => { setAdminEmail(e.target.value); setPage(1); }} style={{ flex: 1 }} />
        <input className="a-input" placeholder="Action type (e.g. kyc_decide)…" value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(1); }} style={{ flex: 1 }} />
        <button className="a-btn-ghost" onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>

      {err && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

      <div className="a-surface" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--a-elevated)", color: "var(--a-muted)", textAlign: "left" }}>
              <th style={{ padding: 10 }}>Time</th>
              <th style={{ padding: 10 }}>Admin</th>
              <th style={{ padding: 10 }}>Action</th>
              <th style={{ padding: 10 }}>Target</th>
              <th style={{ padding: 10 }}>IP</th>
              <th style={{ padding: 10 }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}><Loader2 size={16} className="animate-spin" style={{ display: "inline-block", marginRight: 8 }} />Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--a-muted)" }}>No entries.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--a-border)" }}>
                <td style={{ padding: 10, color: "var(--a-muted)", whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={{ padding: 10 }}>{r.admin_email || "—"}</td>
                <td style={{ padding: 10 }} className="a-mono">{r.action_type}</td>
                <td style={{ padding: 10, color: "var(--a-muted)" }}>{r.target_entity || "—"}{r.target_id && <span className="a-mono" style={{ fontSize: 10, marginLeft: 4 }}>{String(r.target_id).slice(0, 8)}…</span>}</td>
                <td style={{ padding: 10 }} className="a-mono">{r.ip_address || "—"}</td>
                <td style={{ padding: 10, color: "var(--a-muted)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={JSON.stringify(r.new_value || r.old_value || {})}>
                  {r.new_value ? JSON.stringify(r.new_value).slice(0, 80) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--a-muted)" }}>
        <div>{total.toLocaleString()} total · Page {page}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="a-btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <button className="a-btn-ghost" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}
