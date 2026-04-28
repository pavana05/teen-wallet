// Admin → KYC Follow-ups
// Lists users who registered (phone verified, STAGE_3+) but have NOT
// completed KYC. Each row exposes one-tap WhatsApp / SMS / Copy actions
// that pre-fill a personalised, status-aware nudge message.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, RefreshCw, Search, MessageCircle, MessageSquare, Copy, Check,
  ExternalLink, Filter, Users as UsersIcon, Send,
} from "lucide-react";
import { toast } from "sonner";
import { callAdminFn, can, useAdminSession } from "@/admin/lib/adminAuth";
import { PermissionBanner, ShakeErrorPanel } from "@/admin/components/AdminFeedback";

export const Route = createFileRoute("/admin/kyc-followups")({
  component: KycFollowupsPage,
});

type Stage = "STAGE_3" | "STAGE_4" | "STAGE_5";
type KycStatus = "not_started" | "pending" | "approved" | "rejected";

interface FollowupRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  kyc_status: KycStatus;
  onboarding_stage: Stage;
  created_at: string;
  updated_at: string;
  aadhaar_last4: string | null;
}

interface ListResp {
  rows: FollowupRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STAGE_LABEL: Record<Stage, string> = {
  STAGE_3: "Phone verified",
  STAGE_4: "KYC submitted",
  STAGE_5: "Permissions pending",
};

const STAGE_PROGRESS: Record<Stage, { step: number; total: number }> = {
  STAGE_3: { step: 1, total: 3 },
  STAGE_4: { step: 2, total: 3 },
  STAGE_5: { step: 3, total: 3 },
};

// ---------- Message builder -------------------------------------------------

function firstName(full?: string | null): string {
  const n = (full || "").trim().split(/\s+/)[0];
  return n || "there";
}

function buildMessage(row: FollowupRow): string {
  const name = firstName(row.full_name);
  const { step, total } = STAGE_PROGRESS[row.onboarding_stage];
  const remaining = total - step;

  const lines: string[] = [];
  lines.push(`Hi ${name}! 👋`);
  lines.push(`Welcome to Teen Wallet — India's first UPI wallet built for you. 💳✨`);
  lines.push("");

  if (row.onboarding_stage === "STAGE_3") {
    lines.push(`Hooray! 🎉 You've completed the 1st step (phone verified ✅).`);
    lines.push(`Just ${remaining} quick steps left — finish KYC and grab your welcome bonus before it expires! ⏳`);
  } else if (row.onboarding_stage === "STAGE_4") {
    if (row.kyc_status === "pending") {
      lines.push(`You're almost there! 🚀 Your KYC is under review.`);
      lines.push(`We'll notify you the moment it's approved. Keep an eye on the app! 🔔`);
    } else if (row.kyc_status === "rejected") {
      lines.push(`Your KYC needs a quick re-submit. ❗ Don't worry, it takes under 60 seconds.`);
      lines.push(`Open the app, retake your selfie + Aadhaar, and you're in! 📸`);
    } else {
      lines.push(`You completed step 1 ✅ and started step 2 — finish your KYC to unlock the wallet. ⚡`);
    }
  } else {
    // STAGE_5
    lines.push(`Final step! 🏁 Just grant the app permissions and you're ready to pay, scan and earn rewards.`);
  }

  lines.push("");
  lines.push(`What's waiting inside Teen Wallet:`);
  lines.push(`  💸  Instant UPI scan & pay`);
  lines.push(`  🎁  Cashback + referral rewards`);
  lines.push(`  🔒  Bank-grade security with App Lock`);
  lines.push(`  📊  Track every rupee in real time`);
  lines.push("");
  lines.push(`Open the app now and finish in under a minute → https://teen-wallet.lovable.app`);
  lines.push("");
  lines.push(`Need help? Just reply to this message. We're here for you. 💙`);
  lines.push(`— Team Teen Wallet`);

  return lines.join("\n");
}

// Normalise to E.164-ish digits for tel: / wa.me / sms: links.
// Assumes Indian numbers when no country code is present.
function normalisePhone(raw: string | null | undefined): { wa: string; sms: string; display: string } | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  let intl = digits.startsWith("+") ? digits.slice(1) : digits;
  if (intl.length === 10) intl = "91" + intl; // assume IN
  if (intl.length === 11 && intl.startsWith("0")) intl = "91" + intl.slice(1);
  return {
    wa: intl,                  // wa.me wants no '+'
    sms: "+" + intl,           // sms: wants the leading '+'
    display: "+" + intl,
  };
}

function openWhatsApp(row: FollowupRow): "ok" | "no_phone" {
  const p = normalisePhone(row.phone);
  if (!p) return "no_phone";
  const text = encodeURIComponent(buildMessage(row));
  const url = `https://wa.me/${p.wa}?text=${text}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return "ok";
}

function openSms(row: FollowupRow): "ok" | "no_phone" {
  const p = normalisePhone(row.phone);
  if (!p) return "no_phone";
  const text = encodeURIComponent(buildMessage(row));
  // RFC 5724 + Android/iOS support: sms:<num>?body=<text>
  const url = `sms:${p.sms}?body=${text}`;
  window.location.href = url;
  return "ok";
}

// ---------- Component -------------------------------------------------------

function KycFollowupsPage() {
  const { admin } = useAdminSession();
  const allowed = can(admin?.role, "viewKyc");

  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<"" | Stage>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<{ message: string; correlationId: string | null } | null>(null);

  const [previewFor, setPreviewFor] = useState<FollowupRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await callAdminFn<ListResp>({
        action: "kyc_followups",
        sessionToken: undefined, // admin-auth reads it from local; left for symmetry
        search,
        stage,
        page,
        pageSize,
      });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e: any) {
      setErr({ message: e?.message ?? "Failed to load", correlationId: e?.correlationId ?? null });
    } finally {
      setLoading(false);
    }
  }, [allowed, search, stage, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const by: Record<Stage, number> = { STAGE_3: 0, STAGE_4: 0, STAGE_5: 0 };
    for (const r of rows) by[r.onboarding_stage]++;
    return by;
  }, [rows]);

  if (!allowed) {
    return <PermissionBanner canView={false} canDecide={false} resourceLabel="KYC follow-ups" />;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--a-text)" }}>
            KYC Follow-ups
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--a-muted)" }}>
            Users who registered their phone but haven&apos;t finished KYC. Nudge them via WhatsApp or SMS in one tap.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="a-btn-ghost" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatCard label="Total to follow up" value={total} accent="accent" />
        <StatCard label="Phone verified · step 1" value={stats.STAGE_3} accent="warn" />
        <StatCard label="KYC submitted · step 2" value={stats.STAGE_4} accent="info" />
        <StatCard label="Permissions pending · step 3" value={stats.STAGE_5} accent="success" />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          padding: 12, background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 220px", minWidth: 200 }}>
          <Search size={14} style={{ color: "var(--a-muted)" }} />
          <input
            value={search}
            onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            placeholder="Search name or phone…"
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 8,
              background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
              color: "var(--a-text)", fontSize: 13, outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Filter size={14} style={{ color: "var(--a-muted)" }} />
          <select
            value={stage}
            onChange={(e) => { setPage(1); setStage(e.target.value as "" | Stage); }}
            style={{
              padding: "8px 10px", borderRadius: 8,
              background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
              color: "var(--a-text)", fontSize: 13, outline: "none",
            }}
          >
            <option value="">All stages</option>
            <option value="STAGE_3">Step 1 · Phone verified</option>
            <option value="STAGE_4">Step 2 · KYC submitted</option>
            <option value="STAGE_5">Step 3 · Permissions pending</option>
          </select>
        </div>
      </div>

      {err && (
        <ShakeErrorPanel title="Couldn't load follow-ups" error={`${err.message}${err.correlationId ? ` · ref ${err.correlationId}` : ""}`} onRetry={load} retrying={loading} />
      )}

      {/* Table */}
      <div style={{ border: "1px solid var(--a-border)", borderRadius: 12, overflow: "hidden", background: "var(--a-surface)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px,1.4fr) minmax(140px,1fr) 1fr 1fr minmax(280px, 1.4fr)",
            padding: "10px 14px", borderBottom: "1px solid var(--a-border)",
            background: "var(--a-surface-2)", fontSize: 11, color: "var(--a-muted)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}
        >
          <div>User</div>
          <div>Phone</div>
          <div>Stage</div>
          <div>KYC</div>
          <div>Actions</div>
        </div>

        {loading && rows.length === 0 ? (
          <div style={{ padding: 40, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--a-muted)", fontSize: 13 }}>
            <Loader2 size={16} className="animate-spin" style={{ marginRight: 8 }} /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          rows.map((r) => (
            <FollowupRowItem
              key={r.id}
              row={r}
              copied={copiedId === r.id}
              onCopy={async () => {
                try {
                  await navigator.clipboard.writeText(buildMessage(r));
                  setCopiedId(r.id);
                  toast.success("Message copied");
                  setTimeout(() => setCopiedId((c) => (c === r.id ? null : c)), 1500);
                } catch {
                  toast.error("Couldn't copy message");
                }
              }}
              onWhatsApp={() => {
                if (openWhatsApp(r) === "no_phone") toast.error("This user has no phone number on file");
              }}
              onSms={() => {
                if (openSms(r) === "no_phone") toast.error("This user has no phone number on file");
              }}
              onPreview={() => setPreviewFor(r)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--a-muted)", fontSize: 12 }}>
        <span>{total === 0 ? "No users" : `Showing page ${page} of ${totalPages} · ${total} total`}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="a-btn-ghost" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <button className="a-btn-ghost" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
        </div>
      </div>

      {previewFor && (
        <MessagePreview row={previewFor} onClose={() => setPreviewFor(null)} />
      )}
    </div>
  );
}

// ---------- Sub-components --------------------------------------------------

function StatCard({ label, value, accent }: { label: string; value: number; accent: "accent" | "warn" | "info" | "success" }) {
  const color =
    accent === "warn" ? "var(--a-warn)" :
    accent === "info" ? "var(--a-info, #60a5fa)" :
    accent === "success" ? "var(--a-success)" :
    "var(--a-accent, #f59e0b)";
  return (
    <div style={{ padding: 14, border: "1px solid var(--a-border)", borderRadius: 12, background: "var(--a-surface)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--a-muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6, color }}>{value}</div>
    </div>
  );
}

function FollowupRowItem({
  row, copied, onCopy, onWhatsApp, onSms, onPreview,
}: {
  row: FollowupRow;
  copied: boolean;
  onCopy: () => void;
  onWhatsApp: () => void;
  onSms: () => void;
  onPreview: () => void;
}) {
  const phone = normalisePhone(row.phone);
  const { step, total } = STAGE_PROGRESS[row.onboarding_stage];
  const initials = (row.full_name || "?").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px,1.4fr) minmax(140px,1fr) 1fr 1fr minmax(280px, 1.4fr)",
        padding: "12px 14px",
        borderTop: "1px solid var(--a-border)",
        alignItems: "center",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div
          aria-hidden="true"
          style={{
            width: 32, height: 32, borderRadius: 999, flexShrink: 0,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            display: "grid", placeItems: "center", color: "var(--a-text)", fontWeight: 600, fontSize: 11,
          }}
        >{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, color: "var(--a-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.full_name || <span style={{ color: "var(--a-muted)" }}>Unnamed user</span>}
          </div>
          <Link
            to="/admin/users/$id"
            params={{ id: row.id }}
            style={{ fontSize: 11, color: "var(--a-muted)", display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            View profile <ExternalLink size={10} />
          </Link>
        </div>
      </div>

      <div className="a-mono" style={{ color: "var(--a-text)" }}>
        {phone?.display || <span style={{ color: "var(--a-muted)" }}>—</span>}
      </div>

      <div>
        <div style={{ fontSize: 12, color: "var(--a-text)" }}>{STAGE_LABEL[row.onboarding_stage]}</div>
        <div style={{ marginTop: 4, height: 4, width: 92, background: "var(--a-surface-2)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${(step / total) * 100}%`, height: "100%", background: "var(--a-accent, #f59e0b)" }} />
        </div>
        <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 3 }}>Step {step} of {total}</div>
      </div>

      <div>
        <KycBadge status={row.kyc_status} />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={onWhatsApp}
          disabled={!phone}
          title={phone ? "Open WhatsApp with pre-filled message" : "No phone on file"}
          className="a-btn-ghost"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
            color: phone ? "#22c55e" : undefined,
            borderColor: phone ? "rgba(34,197,94,0.4)" : undefined,
          }}
        >
          <MessageCircle size={13} /> WhatsApp
        </button>
        <button
          onClick={onSms}
          disabled={!phone}
          title={phone ? "Open SMS app with pre-filled message" : "No phone on file"}
          className="a-btn-ghost"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
            color: phone ? "#60a5fa" : undefined,
            borderColor: phone ? "rgba(96,165,250,0.4)" : undefined,
          }}
        >
          <MessageSquare size={13} /> SMS
        </button>
        <button
          onClick={onCopy}
          className="a-btn-ghost"
          title="Copy message to clipboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={onPreview}
          className="a-btn-ghost"
          style={{ fontSize: 12 }}
          title="Preview message"
        >
          Preview
        </button>
      </div>
    </div>
  );
}

function KycBadge({ status }: { status: KycStatus }) {
  const map: Record<KycStatus, { label: string; bg: string; fg: string; border: string }> = {
    not_started: { label: "Not started", bg: "rgba(148,163,184,0.12)", fg: "#94a3b8", border: "rgba(148,163,184,0.3)" },
    pending: { label: "Pending", bg: "rgba(234,179,8,0.12)", fg: "#eab308", border: "rgba(234,179,8,0.3)" },
    rejected: { label: "Rejected", bg: "rgba(239,68,68,0.12)", fg: "#ef4444", border: "rgba(239,68,68,0.3)" },
    approved: { label: "Approved", bg: "rgba(34,197,94,0.12)", fg: "#22c55e", border: "rgba(34,197,94,0.3)" },
  };
  const s = map[status];
  return (
    <span
      style={{
        display: "inline-block", padding: "3px 8px", borderRadius: 999,
        background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
        fontSize: 11, fontWeight: 500, letterSpacing: "0.02em",
      }}
    >{s.label}</span>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: 48, display: "flex", flexDirection: "column", alignItems: "center", color: "var(--a-muted)", gap: 8 }}>
      <UsersIcon size={28} />
      <div style={{ fontSize: 14, color: "var(--a-text)" }}>All caught up</div>
      <div style={{ fontSize: 12 }}>No users currently need a KYC nudge.</div>
    </div>
  );
}

function MessagePreview({ row, onClose }: { row: FollowupRow; onClose: () => void }) {
  const message = useMemo(() => buildMessage(row), [row]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--a-surface)", border: "1px solid var(--a-border)",
          borderRadius: 16, padding: 20,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--a-text)" }}>Message preview</div>
            <div style={{ fontSize: 12, color: "var(--a-muted)" }}>
              For {row.full_name || "this user"} · {STAGE_LABEL[row.onboarding_stage]}
            </div>
          </div>
          <button onClick={onClose} className="a-btn-ghost" style={{ fontSize: 12 }}>Close</button>
        </div>
        <pre
          style={{
            margin: 0, padding: 14, borderRadius: 10,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            color: "var(--a-text)", fontSize: 13, lineHeight: 1.5,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            maxHeight: "60vh", overflowY: "auto",
          }}
        >{message}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(message); toast.success("Message copied"); }
              catch { toast.error("Couldn't copy"); }
            }}
            className="a-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <Copy size={13} /> Copy
          </button>
          <button
            onClick={() => { if (openSms(row) === "no_phone") toast.error("No phone on file"); }}
            className="a-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#60a5fa", borderColor: "rgba(96,165,250,0.4)" }}
          >
            <MessageSquare size={13} /> SMS
          </button>
          <button
            onClick={() => { if (openWhatsApp(row) === "no_phone") toast.error("No phone on file"); }}
            className="a-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#22c55e", borderColor: "rgba(34,197,94,0.4)" }}
          >
            <MessageCircle size={13} /> WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
