import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { callAdminFn, readAdminSession, useAdminSession, can } from "@/admin/lib/adminAuth";
import {
  ArrowLeft, Loader2, ShieldCheck, ShieldX, RotateCcw,
  ShieldAlert, Activity as ActivityIcon, Wallet, FileCheck2, ScrollText,
  Lock, Unlock, LogOut, Tag, Plus, Minus,
} from "lucide-react";

export const Route = createFileRoute("/admin/users/$id")({
  component: UserDetail,
});

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  aadhaar_last4: string | null;
  kyc_status: string;
  onboarding_stage: string;
  balance: number;
  created_at: string;
  updated_at: string;
  school_name: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_pincode: string | null;
  account_tag: string | null;
  account_locked: boolean;
  notif_prefs: Record<string, boolean> | null;
}
interface Txn { id: string; amount: number; merchant_name: string; upi_id: string; status: string; created_at: string; fraud_flags: any; }
interface Kyc { id: string; status: string; provider: string; provider_ref: string | null; match_score: number | null; reason: string | null; created_at: string; updated_at: string; }
interface Fraud { id: string; rule_triggered: string; resolution: string | null; created_at: string; transaction_id: string | null; }
interface Audit { id: string; admin_email: string | null; admin_role: string | null; action_type: string; created_at: string; new_value: any; }
interface Contact { id: string; name: string; upi_id: string; phone: string | null; verified: boolean; last_paid_at: string | null; created_at: string; emoji?: string | null; }
interface Attempt { id: string; amount: number; payee_name: string; upi_id: string; stage: string; method: string; failure_reason: string | null; provider_ref: string | null; created_at: string; completed_at: string | null; }
interface Referral { id: string; code: string; status: string; referrer_user_id: string; referred_user_id: string; referrer_reward: number; referred_reward: number; created_at: string; completed_at: string | null; }
interface Notif { id: string; type: string; title: string; body: string | null; read: boolean; created_at: string; }

interface DetailData {
  profile: Profile;
  transactions: Txn[];
  kyc: Kyc[];
  fraud: Fraud[];
  parental: any;
  audit: Audit[];
  contacts?: Contact[];
  paymentAttempts?: Attempt[];
  referralsGiven?: Referral[];
  referralReceived?: Referral | null;
  notifications?: Notif[];
}

type Tab = "timeline" | "txn" | "kyc" | "fraud" | "audit" | "contacts" | "attempts" | "referrals" | "notifs";

function UserDetail() {
  const { id } = useParams({ from: "/admin/users/$id" });
  const { admin } = useAdminSession();
  const [data, setData] = useState<DetailData | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Deep-link: ?tab=kyc|fraud|txn|audit|timeline (one-shot on mount).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t && ["timeline", "txn", "kyc", "fraud", "audit", "contacts", "attempts", "referrals", "notifs"].includes(t)) setTab(t as Tab);
  }, []);

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

  const risk = useMemo(() => (data ? computeRisk(data) : null), [data]);

  if (!data || !risk) {
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

      {/* ── Risk score header ───────────────────────────────────── */}
      <RiskHeader risk={risk} profile={p} txnCount={data.transactions.length} fraudCount={data.fraud.length} />

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
          <Field label="Email" value={p.email || "—"} mono />
          <Field label="Date of birth" value={p.dob ? `${p.dob} · ${ageFrom(p.dob)} yrs` : "—"} />
          <Field label="Gender" value={p.gender || "—"} />
          <Field label="Aadhaar" value={p.aadhaar_last4 ? `XXXX-XXXX-${p.aadhaar_last4}` : "—"} mono />
          <Field label="School" value={p.school_name || "—"} />
          <Field label="Address" value={formatAddress(p) || "—"} />
          <Field label="KYC Status" value={<KycBadge s={p.kyc_status} />} />
          <Field label="Onboarding" value={<span className="a-mono" style={{ fontSize: 11 }}>{p.onboarding_stage}</span>} />
          <Field label="Account tag" value={<span className="a-mono" style={{ fontSize: 11, textTransform: "uppercase" }}>{p.account_tag || "standard"}</span>} />
          <Field label="Account status" value={p.account_locked
            ? <span style={{ color: "#fca5a5", fontWeight: 600 }}>Locked</span>
            : <span style={{ color: "#86efac", fontWeight: 600 }}>Active</span>} />
          <Field label="Wallet balance" value={`₹${Number(p.balance).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} mono />
          <Field label="Joined" value={new Date(p.created_at).toLocaleString()} />
          <Field label="Last updated" value={new Date(p.updated_at).toLocaleString()} />
          <Field label="Parental link" value={data.parental ? `${maskPhone(data.parental.parent_phone)} · ${data.parental.parent_verified ? "verified" : "unverified"}` : "—"} />
          {data.referralReceived && (
            <Field label="Referred by code" value={<span className="a-mono">{data.referralReceived.code}</span>} />
          )}
          {p.notif_prefs && (
            <Field label="Notif prefs" value={
              <span style={{ fontSize: 11, color: "var(--a-muted)" }}>
                {Object.entries(p.notif_prefs).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}
              </span>
            } />
          )}

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
          <div className="a-surface" style={{ display: "flex", borderBottom: "1px solid var(--a-border)", padding: "0 8px", flexWrap: "wrap" }}>
            <TabBtn id="timeline" cur={tab} onClick={setTab}>Timeline</TabBtn>
            <TabBtn id="txn" cur={tab} onClick={setTab}>Transactions ({data.transactions.length})</TabBtn>
            <TabBtn id="attempts" cur={tab} onClick={setTab}>Attempts ({data.paymentAttempts?.length ?? 0})</TabBtn>
            <TabBtn id="kyc" cur={tab} onClick={setTab}>KYC ({data.kyc.length})</TabBtn>
            <TabBtn id="fraud" cur={tab} onClick={setTab}>Fraud ({data.fraud.length})</TabBtn>
            <TabBtn id="contacts" cur={tab} onClick={setTab}>Contacts ({data.contacts?.length ?? 0})</TabBtn>
            <TabBtn id="referrals" cur={tab} onClick={setTab}>Referrals ({data.referralsGiven?.length ?? 0})</TabBtn>
            <TabBtn id="notifs" cur={tab} onClick={setTab}>Notifications ({data.notifications?.length ?? 0})</TabBtn>
            <TabBtn id="audit" cur={tab} onClick={setTab}>Audit ({data.audit.length})</TabBtn>
          </div>

          <div className="a-surface" style={{ padding: 16, marginTop: -1, borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            {tab === "timeline" && <MergedTimeline data={data} />}
            {tab === "txn" && <TxnTable rows={data.transactions} />}
            {tab === "attempts" && <AttemptsTable rows={data.paymentAttempts ?? []} />}
            {tab === "kyc" && <KycTimeline rows={data.kyc} />}
            {tab === "fraud" && <FraudTable rows={data.fraud} />}
            {tab === "contacts" && <ContactsTable rows={data.contacts ?? []} />}
            {tab === "referrals" && <ReferralsTable rows={data.referralsGiven ?? []} userId={p.id} />}
            {tab === "notifs" && <NotifsTable rows={data.notifications ?? []} />}
            {tab === "audit" && <AuditTable rows={data.audit} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Risk scoring ─────────────────────────────────────────────────────────────
interface RiskResult { score: number; band: "low" | "medium" | "high"; reasons: string[]; openFraud: number }

function computeRisk(d: DetailData): RiskResult {
  const reasons: string[] = [];
  let score = 0;
  const openFraud = d.fraud.filter((f) => !f.resolution).length;
  if (openFraud > 0) { score += Math.min(openFraud * 25, 60); reasons.push(`${openFraud} open fraud alert${openFraud > 1 ? "s" : ""}`); }
  const resolvedFraud = d.fraud.length - openFraud;
  if (resolvedFraud > 0) { score += Math.min(resolvedFraud * 5, 15); reasons.push(`${resolvedFraud} resolved fraud event${resolvedFraud > 1 ? "s" : ""}`); }
  if (d.profile.kyc_status === "rejected") { score += 25; reasons.push("KYC rejected"); }
  else if (d.profile.kyc_status === "not_started") { score += 10; reasons.push("KYC not started"); }
  else if (d.profile.kyc_status === "pending") { score += 5; reasons.push("KYC pending"); }
  const failed = d.transactions.filter((t) => t.status === "failed").length;
  if (failed >= 3) { score += 10; reasons.push(`${failed} failed transactions`); }
  if (d.transactions.length === 0 && d.profile.kyc_status === "approved") { score += 5; reasons.push("No transactions yet"); }
  score = Math.min(score, 100);
  const band: RiskResult["band"] = score >= 60 ? "high" : score >= 25 ? "medium" : "low";
  if (!reasons.length) reasons.push("No risk signals");
  return { score, band, reasons, openFraud };
}

function RiskHeader({ risk, profile, txnCount, fraudCount }: { risk: RiskResult; profile: Profile; txnCount: number; fraudCount: number }) {
  const colors = {
    low: { bg: "rgba(34,197,94,0.1)", fg: "#86efac", border: "rgba(34,197,94,0.3)" },
    medium: { bg: "rgba(245,158,11,0.1)", fg: "#fcd34d", border: "rgba(245,158,11,0.3)" },
    high: { bg: "rgba(239,68,68,0.1)", fg: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  }[risk.band];

  return (
    <div className="a-surface" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr repeat(4, auto)", gap: 16, alignItems: "center" }}>
        <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
          <div className="a-label" style={{ marginBottom: 4 }}>Risk Score</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: colors.fg, lineHeight: 1 }}>{risk.score}</div>
          <div style={{ fontSize: 11, color: colors.fg, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{risk.band}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="a-label" style={{ marginBottom: 6 }}>Risk signals</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {risk.reasons.map((r) => (
              <li key={r} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "var(--a-elevated)", color: "var(--a-fg)", border: "1px solid var(--a-border)" }}>{r}</li>
            ))}
          </ul>
        </div>
        <RiskStat icon={<FileCheck2 size={14} />} label="KYC" value={profile.kyc_status} />
        <RiskStat icon={<Wallet size={14} />} label="Txns" value={String(txnCount)} />
        <RiskStat icon={<ShieldAlert size={14} />} label="Fraud" value={String(fraudCount)} accent={risk.openFraud > 0 ? "var(--a-warn)" : undefined} />
        <RiskStat icon={<ActivityIcon size={14} />} label="Open" value={String(risk.openFraud)} accent={risk.openFraud > 0 ? "#fca5a5" : undefined} />
      </div>
      <KycStageChips current={profile.kyc_status} />
    </div>
  );
}

// Clickable KYC stage chips that deep-link to the KYC queue with the matching
// status filter pre-applied. The user's current stage is highlighted.
function KycStageChips({ current }: { current: string }) {
  const stages: { key: "pending" | "approved" | "rejected" | "all"; label: string; matches: string[] }[] = [
    { key: "all", label: "Not started", matches: ["not_started"] },
    { key: "pending", label: "Pending", matches: ["pending"] },
    { key: "approved", label: "Approved", matches: ["approved"] },
    { key: "rejected", label: "Rejected", matches: ["rejected"] },
  ];
  const tone: Record<string, { bg: string; fg: string; border: string }> = {
    "Not started": { bg: "rgba(161,161,170,0.10)", fg: "#d4d4d8", border: "rgba(161,161,170,0.30)" },
    Pending: { bg: "rgba(245,158,11,0.10)", fg: "#fcd34d", border: "rgba(245,158,11,0.30)" },
    Approved: { bg: "rgba(34,197,94,0.10)", fg: "#86efac", border: "rgba(34,197,94,0.30)" },
    Rejected: { bg: "rgba(239,68,68,0.10)", fg: "#fca5a5", border: "rgba(239,68,68,0.30)" },
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--a-border)" }}>
      <span className="a-label" style={{ marginRight: 4 }}>Jump to KYC queue</span>
      {stages.map((s) => {
        const active = s.matches.includes(current);
        const t = tone[s.label];
        return (
          <Link
            key={s.label}
            to="/admin/kyc"
            search={{ status: s.key } as never}
            title={`Open KYC queue filtered by "${s.key}"`}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 999,
              background: t.bg,
              color: t.fg,
              border: `1px solid ${active ? t.fg : t.border}`,
              textDecoration: "none",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: active ? 700 : 500,
              boxShadow: active ? `0 0 0 1px ${t.fg} inset` : undefined,
            }}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

function RiskStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center", color: "var(--a-muted)" }}>{icon}<span className="a-label">{label}</span></div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, color: accent || "var(--a-fg)" }}>{value}</div>
    </div>
  );
}

// ── Merged Timeline ──────────────────────────────────────────────────────────
type EventKind = "kyc" | "txn" | "fraud" | "audit";
interface TimelineEvent { ts: string; kind: EventKind; title: string; subtitle?: string; tone?: "ok" | "warn" | "err" | "muted" }

function buildEvents(d: DetailData): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  d.kyc.forEach((k) => ev.push({
    ts: k.updated_at || k.created_at, kind: "kyc",
    title: `KYC ${k.status}`,
    subtitle: [k.provider, k.match_score != null ? `match ${k.match_score}` : null, k.reason].filter(Boolean).join(" · "),
    tone: k.status === "approved" ? "ok" : k.status === "rejected" ? "err" : "warn",
  }));
  d.transactions.forEach((t) => ev.push({
    ts: t.created_at, kind: "txn",
    title: `₹${Number(t.amount).toFixed(2)} · ${t.merchant_name}`,
    subtitle: `${t.upi_id} · ${t.status}`,
    tone: t.status === "success" ? "ok" : t.status === "failed" ? "err" : "warn",
  }));
  d.fraud.forEach((f) => ev.push({
    ts: f.created_at, kind: "fraud",
    title: `Fraud rule: ${f.rule_triggered}`,
    subtitle: f.resolution ? `Resolved — ${f.resolution}` : "Open",
    tone: f.resolution ? "muted" : "err",
  }));
  d.audit.forEach((a) => ev.push({
    ts: a.created_at, kind: "audit",
    title: a.action_type,
    subtitle: `${a.admin_email || "system"}${a.admin_role ? ` · ${a.admin_role}` : ""}`,
    tone: "muted",
  }));
  ev.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return ev;
}

function MergedTimeline({ data }: { data: DetailData }) {
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const events = useMemo(() => buildEvents(data), [data]);
  const visible = filter === "all" ? events : events.filter((e) => e.kind === filter);
  if (!events.length) return <Empty msg="No activity recorded yet" />;

  const toneColor = (t?: string) =>
    t === "ok" ? "var(--a-success)" : t === "warn" ? "var(--a-warn)" : t === "err" ? "#f87171" : "var(--a-muted)";
  const kindIcon = (k: EventKind) =>
    k === "kyc" ? <FileCheck2 size={12} /> : k === "txn" ? <Wallet size={12} /> : k === "fraud" ? <ShieldAlert size={12} /> : <ScrollText size={12} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "kyc", "txn", "fraud", "audit"] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={filter === k ? "a-btn" : "a-btn-ghost"}
            style={{ fontSize: 11, padding: "4px 10px", textTransform: "capitalize" }}>
            {k} {k !== "all" && <span style={{ opacity: 0.6 }}>({events.filter((e) => e.kind === k).length})</span>}
          </button>
        ))}
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
        <div style={{ position: "absolute", left: 11, top: 6, bottom: 6, width: 1, background: "var(--a-border)" }} />
        {visible.map((e, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 10, padding: "8px 0" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--a-elevated)", border: `1px solid ${toneColor(e.tone)}`, color: toneColor(e.tone), display: "grid", placeItems: "center", zIndex: 1 }}>
              {kindIcon(e.kind)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</span>
                <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", whiteSpace: "nowrap" }}>{new Date(e.ts).toLocaleString()}</span>
              </div>
              {e.subtitle && <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{e.subtitle}</div>}
            </div>
          </li>
        ))}
      </ol>
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
  // Deep-link to the KYC queue with the matching status filter pre-applied.
  // The queue filter only supports pending|approved|rejected|all — for
  // not_started (no submission yet) we fall back to "all".
  const queueStatus = s === "approved" || s === "rejected" || s === "pending" ? s : "all";
  return (
    <Link
      to="/admin/kyc"
      search={{ status: queueStatus } as never}
      title={`Open KYC queue filtered by "${queueStatus}"`}
      className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${map[s] || ""}`}
      style={{ textDecoration: "none", cursor: "pointer" }}
    >
      {s}
    </Link>
  );
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

function formatAddress(p: Profile): string {
  const parts = [p.address_line1, p.address_city, p.address_state, p.address_pincode].filter(Boolean);
  return parts.join(", ");
}

function ContactsTable({ rows }: { rows: Contact[] }) {
  if (!rows.length) return <div style={{ color: "var(--a-muted)", fontSize: 13 }}>No saved contacts.</div>;
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--a-muted)", borderBottom: "1px solid var(--a-border)" }}>
          <th style={{ padding: 8 }}>Name</th>
          <th style={{ padding: 8 }}>UPI</th>
          <th style={{ padding: 8 }}>Phone</th>
          <th style={{ padding: 8 }}>Verified</th>
          <th style={{ padding: 8 }}>Last paid</th>
          <th style={{ padding: 8 }}>Added</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} style={{ borderBottom: "1px solid var(--a-border)" }}>
            <td style={{ padding: 8 }}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</td>
            <td style={{ padding: 8 }} className="a-mono">{c.upi_id}</td>
            <td style={{ padding: 8 }} className="a-mono">{c.phone || "—"}</td>
            <td style={{ padding: 8 }}>{c.verified ? "✓" : "—"}</td>
            <td style={{ padding: 8 }}>{c.last_paid_at ? new Date(c.last_paid_at).toLocaleDateString() : "—"}</td>
            <td style={{ padding: 8 }}>{new Date(c.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttemptsTable({ rows }: { rows: Attempt[] }) {
  if (!rows.length) return <div style={{ color: "var(--a-muted)", fontSize: 13 }}>No payment attempts recorded.</div>;
  const stageColor = (s: string) =>
    s === "success" ? "#86efac" : s === "failed" ? "#fca5a5" : s === "cancelled" ? "#a1a1aa" : "#fcd34d";
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--a-muted)", borderBottom: "1px solid var(--a-border)" }}>
          <th style={{ padding: 8 }}>When</th>
          <th style={{ padding: 8 }}>Payee</th>
          <th style={{ padding: 8 }}>UPI</th>
          <th style={{ padding: 8 }}>Amount</th>
          <th style={{ padding: 8 }}>Method</th>
          <th style={{ padding: 8 }}>Stage</th>
          <th style={{ padding: 8 }}>Reason / Ref</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} style={{ borderBottom: "1px solid var(--a-border)" }}>
            <td style={{ padding: 8 }}>{new Date(a.created_at).toLocaleString()}</td>
            <td style={{ padding: 8 }}>{a.payee_name}</td>
            <td style={{ padding: 8 }} className="a-mono">{a.upi_id}</td>
            <td style={{ padding: 8 }} className="a-mono">₹{Number(a.amount).toLocaleString("en-IN")}</td>
            <td style={{ padding: 8 }} className="a-mono">{a.method}</td>
            <td style={{ padding: 8, color: stageColor(a.stage), fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>{a.stage}</td>
            <td style={{ padding: 8, color: "var(--a-muted)" }}>{a.failure_reason || a.provider_ref || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReferralsTable({ rows, userId }: { rows: Referral[]; userId: string }) {
  if (!rows.length) return <div style={{ color: "var(--a-muted)", fontSize: 13 }}>No referrals sent.</div>;
  return (
    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--a-muted)", borderBottom: "1px solid var(--a-border)" }}>
          <th style={{ padding: 8 }}>When</th>
          <th style={{ padding: 8 }}>Code</th>
          <th style={{ padding: 8 }}>Referred user</th>
          <th style={{ padding: 8 }}>Status</th>
          <th style={{ padding: 8 }}>Reward earned</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: "1px solid var(--a-border)" }}>
            <td style={{ padding: 8 }}>{new Date(r.created_at).toLocaleString()}</td>
            <td style={{ padding: 8 }} className="a-mono">{r.code}</td>
            <td style={{ padding: 8 }}>
              <Link to="/admin/users/$id" params={{ id: r.referred_user_id }} style={{ color: "var(--a-accent)" }} className="a-mono">
                {r.referred_user_id.slice(0, 8)}…
              </Link>
            </td>
            <td style={{ padding: 8, textTransform: "uppercase", fontSize: 11, fontWeight: 600 }}>{r.status}</td>
            <td style={{ padding: 8 }} className="a-mono">₹{Number(r.referrer_reward).toLocaleString("en-IN")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NotifsTable({ rows }: { rows: Notif[] }) {
  if (!rows.length) return <div style={{ color: "var(--a-muted)", fontSize: 13 }}>No notifications.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((n) => (
        <div key={n.id} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--a-border)", background: n.read ? "transparent" : "var(--a-elevated)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
            <div style={{ fontSize: 10, color: "var(--a-muted)" }}>
              {new Date(n.created_at).toLocaleString()} · <span className="a-mono">{n.type}</span>{!n.read && " · UNREAD"}
            </div>
          </div>
          {n.body && <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>{n.body}</div>}
        </div>
      ))}
    </div>
  );
}
