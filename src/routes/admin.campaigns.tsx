// Admin-only campaigns page:
//   - Send targeted notifications to all boys / girls / both
//   - CRUD gender_offers (offer cards shown on user's home)
//   - CRUD gender_rewards_rules (cashback tiers)
//
// All writes go through the admin-auth edge function (service-role) using the
// existing callAdminFn helper so we keep one auth/audit pipeline.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import { Megaphone, Tag, Sparkles, Trash2, Plus, Send, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/campaigns")({
  component: CampaignsPage,
});

type GenderTarget = "boy" | "girl" | "all";

interface OfferRow {
  id: string;
  gender_target: GenderTarget;
  eyebrow: string;
  headline: string;
  emphasis: string;
  subtitle: string;
  cta_label: string;
  accent: string;
  active: boolean;
  sort_order: number;
}

interface RewardRow {
  id: string;
  gender_target: GenderTarget;
  category: string;
  cashback_pct: number;
  description: string;
  active: boolean;
  sort_order: number;
}

function CampaignsPage() {
  const [tab, setTab] = useState<"notify" | "offers" | "rewards">("notify");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Gender Campaigns</h1>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
          Personalize offers, rewards, and broadcasts by gender. Users see content matching their profile gender (boys see boy + all, girls see girl + all, others see a mix).
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--a-border)" }}>
        {([
          { k: "notify", label: "Targeted notifications", icon: Megaphone },
          { k: "offers", label: "Manage offers", icon: Tag },
          { k: "rewards", label: "Rewards tiers", icon: Sparkles },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 16px", fontSize: 13,
              background: "transparent", border: "none", cursor: "pointer",
              color: tab === t.k ? "var(--a-accent)" : "var(--a-muted)",
              borderBottom: tab === t.k ? "2px solid var(--a-accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "notify" && <NotifyPanel />}
      {tab === "offers" && <OffersPanel />}
      {tab === "rewards" && <RewardsPanel />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notify panel — broadcast to boys, girls, or both
// ─────────────────────────────────────────────────────────────────────────────
function NotifyPanel() {
  const [target, setTarget] = useState<GenderTarget>("boy");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>("");
  const [err, setErr] = useState("");

  const send = async () => {
    setErr(""); setResult("");
    if (!title.trim()) { setErr("Title is required"); return; }
    if (title.length > 120) { setErr("Title must be 120 chars or less"); return; }
    if (body.length > 500) { setErr("Body must be 500 chars or less"); return; }
    const s = readAdminSession();
    if (!s) { setErr("Session expired"); return; }
    setSending(true);
    try {
      const r = await callAdminFn<{ ok: boolean; sent: number }>({
        action: "gender_notify_send",
        sessionToken: s.sessionToken,
        target, title: title.trim(), body: body.trim(),
      });
      setResult(`Sent to ${r.sent} user${r.sent === 1 ? "" : "s"}`);
      setTitle(""); setBody("");
    } catch (e: any) {
      setErr(e.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="a-surface" style={{ padding: 20, maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="a-label" style={{ marginBottom: 8 }}>Audience</div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["boy", "girl", "all"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setTarget(g)}
              className={target === g ? "a-btn a-btn-primary" : "a-btn a-btn-ghost"}
              style={{ padding: "8px 16px", fontSize: 12, textTransform: "capitalize" }}
            >
              {g === "all" ? "Everyone" : g + "s"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div className="a-label" style={{ marginBottom: 6 }}>Title <span style={{ color: "var(--a-muted)" }}>({title.length}/120)</span></div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder="e.g. New gaming cashback just for you 🎮"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="a-label" style={{ marginBottom: 6 }}>Body <span style={{ color: "var(--a-muted)" }}>({body.length}/500)</span></div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          placeholder="Optional. Short message shown in the notification panel."
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {err && <div style={errStyle}>{err}</div>}
      {result && <div style={okStyle}>{result}</div>}

      <button
        onClick={send}
        disabled={sending || !title.trim()}
        className="a-btn a-btn-primary"
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        {sending ? "Sending…" : `Send to ${target === "all" ? "everyone" : target + "s"}`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Offers panel
// ─────────────────────────────────────────────────────────────────────────────
function OffersPanel() {
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<OfferRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const s = readAdminSession(); if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: OfferRow[] }>({ action: "gender_offers_list", sessionToken: s.sessionToken });
      setRows(r.rows);
      setErr("");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this offer?")) return;
    const s = readAdminSession(); if (!s) return;
    try {
      await callAdminFn({ action: "gender_offers_delete", sessionToken: s.sessionToken, id });
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--a-muted)" }}>
          {rows.length} offer{rows.length === 1 ? "" : "s"} configured
        </div>
        <button onClick={() => { setCreating(true); setEditing(blankOffer()); }} className="a-btn a-btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> New offer
        </button>
      </div>

      {err && <div style={errStyle}>{err}</div>}
      {loading ? <div style={{ color: "var(--a-muted)", fontSize: 13 }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="a-surface" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <span className="a-mono" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: targetBg(r.gender_target), color: targetFg(r.gender_target), textTransform: "uppercase" }}>
                {r.gender_target}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.headline} {r.emphasis} <span style={{ color: "var(--a-muted)", fontWeight: 400 }}>· {r.eyebrow}</span></div>
                <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{r.subtitle}</div>
              </div>
              {!r.active && <span style={{ fontSize: 10, color: "var(--a-muted)", textTransform: "uppercase" }}>inactive</span>}
              <button onClick={() => { setCreating(false); setEditing(r); }} className="a-btn a-btn-ghost" style={{ fontSize: 12 }}>Edit</button>
              <button onClick={() => remove(r.id)} className="a-btn a-btn-ghost" style={{ fontSize: 12, color: "#fca5a5" }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <OfferEditor
          row={editing}
          isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); void load(); }}
        />
      )}
    </div>
  );
}

function blankOffer(): OfferRow {
  return {
    id: "", gender_target: "boy", eyebrow: "Limited", headline: "10%", emphasis: "cashback",
    subtitle: "", cta_label: "Apply offer", accent: "boy", active: true, sort_order: 100,
  };
}

function OfferEditor({ row, isNew, onClose, onSaved }: { row: OfferRow; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<OfferRow>(row);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!draft.eyebrow.trim() || !draft.headline.trim() || !draft.subtitle.trim()) {
      setErr("Eyebrow, headline and subtitle are required"); return;
    }
    const s = readAdminSession(); if (!s) return;
    setSaving(true);
    try {
      await callAdminFn({
        action: isNew ? "gender_offers_create" : "gender_offers_update",
        sessionToken: s.sessionToken,
        ...(isNew ? {} : { id: draft.id }),
        gender_target: draft.gender_target,
        eyebrow: draft.eyebrow.trim().slice(0, 60),
        headline: draft.headline.trim().slice(0, 30),
        emphasis: draft.emphasis.trim().slice(0, 30),
        subtitle: draft.subtitle.trim().slice(0, 200),
        cta_label: draft.cta_label.trim().slice(0, 30) || "Apply offer",
        accent: draft.accent,
        active: draft.active,
        sort_order: Number(draft.sort_order) || 100,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div className="a-surface" style={{ ...modalCard, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{isNew ? "New offer" : "Edit offer"}</h3>

        <Field label="Audience">
          <div style={{ display: "flex", gap: 6 }}>
            {(["boy", "girl", "all"] as const).map((g) => (
              <button key={g} onClick={() => setDraft({ ...draft, gender_target: g, accent: g === "all" ? "neutral" : g })}
                className={draft.gender_target === g ? "a-btn a-btn-primary" : "a-btn a-btn-ghost"}
                style={{ padding: "6px 12px", fontSize: 12, textTransform: "capitalize" }}>{g === "all" ? "Everyone" : g + "s"}</button>
            ))}
          </div>
        </Field>

        <Field label="Eyebrow (small label above)"><input style={inputStyle} value={draft.eyebrow} onChange={(e) => setDraft({ ...draft, eyebrow: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Headline (e.g. 25%)"><input style={inputStyle} value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} /></Field>
          <Field label="Emphasis (e.g. cashback)"><input style={inputStyle} value={draft.emphasis} onChange={(e) => setDraft({ ...draft, emphasis: e.target.value })} /></Field>
        </div>
        <Field label="Subtitle"><textarea rows={2} style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="CTA label"><input style={inputStyle} value={draft.cta_label} onChange={(e) => setDraft({ ...draft, cta_label: e.target.value })} /></Field>
          <Field label="Sort order (low = first)"><input type="number" style={inputStyle} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} /></Field>
        </div>
        <Field label=""><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (shown to users)</label></Field>

        {err && <div style={errStyle}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} className="a-btn a-btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="a-btn a-btn-primary">{saving ? "Saving…" : "Save offer"}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rewards panel
// ─────────────────────────────────────────────────────────────────────────────
function RewardsPanel() {
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<RewardRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const s = readAdminSession(); if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: RewardRow[] }>({ action: "gender_rewards_list", sessionToken: s.sessionToken });
      setRows(r.rows);
      setErr("");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    const s = readAdminSession(); if (!s) return;
    try { await callAdminFn({ action: "gender_rewards_delete", sessionToken: s.sessionToken, id }); await load(); }
    catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--a-muted)" }}>{rows.length} rule{rows.length === 1 ? "" : "s"}</div>
        <button onClick={() => { setCreating(true); setEditing({ id: "", gender_target: "boy", category: "", cashback_pct: 1, description: "", active: true, sort_order: 100 }); }} className="a-btn a-btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> New rule
        </button>
      </div>

      {err && <div style={errStyle}>{err}</div>}
      {loading ? <div style={{ color: "var(--a-muted)", fontSize: 13 }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.id} className="a-surface" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <span className="a-mono" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: targetBg(r.gender_target), color: targetFg(r.gender_target), textTransform: "uppercase" }}>{r.gender_target}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.category} · {r.cashback_pct}%</div>
                <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{r.description}</div>
              </div>
              {!r.active && <span style={{ fontSize: 10, color: "var(--a-muted)", textTransform: "uppercase" }}>inactive</span>}
              <button onClick={() => { setCreating(false); setEditing(r); }} className="a-btn a-btn-ghost" style={{ fontSize: 12 }}>Edit</button>
              <button onClick={() => remove(r.id)} className="a-btn a-btn-ghost" style={{ fontSize: 12, color: "#fca5a5" }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RewardEditor
          row={editing}
          isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); void load(); }}
        />
      )}
    </div>
  );
}

function RewardEditor({ row, isNew, onClose, onSaved }: { row: RewardRow; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<RewardRow>(row);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (!draft.category.trim() || !draft.description.trim()) { setErr("Category and description are required"); return; }
    if (draft.cashback_pct < 0 || draft.cashback_pct > 100) { setErr("Cashback must be 0–100"); return; }
    const s = readAdminSession(); if (!s) return;
    setSaving(true);
    try {
      await callAdminFn({
        action: isNew ? "gender_rewards_create" : "gender_rewards_update",
        sessionToken: s.sessionToken,
        ...(isNew ? {} : { id: draft.id }),
        gender_target: draft.gender_target,
        category: draft.category.trim().slice(0, 60),
        cashback_pct: Number(draft.cashback_pct),
        description: draft.description.trim().slice(0, 200),
        active: draft.active,
        sort_order: Number(draft.sort_order) || 100,
      });
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div className="a-surface" style={{ ...modalCard, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{isNew ? "New rewards rule" : "Edit rule"}</h3>
        <Field label="Audience">
          <div style={{ display: "flex", gap: 6 }}>
            {(["boy", "girl", "all"] as const).map((g) => (
              <button key={g} onClick={() => setDraft({ ...draft, gender_target: g })}
                className={draft.gender_target === g ? "a-btn a-btn-primary" : "a-btn a-btn-ghost"}
                style={{ padding: "6px 12px", fontSize: 12, textTransform: "capitalize" }}>{g === "all" ? "Everyone" : g + "s"}</button>
            ))}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <Field label="Category"><input style={inputStyle} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Gaming" /></Field>
          <Field label="Cashback %"><input type="number" min="0" max="100" step="0.5" style={inputStyle} value={draft.cashback_pct} onChange={(e) => setDraft({ ...draft, cashback_pct: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Description"><input style={inputStyle} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. 5% back on gaming top-ups" /></Field>
        <Field label=""><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label></Field>

        {err && <div style={errStyle}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} className="a-btn a-btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="a-btn a-btn-primary">{saving ? "Saving…" : "Save rule"}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <div className="a-label" style={{ marginBottom: 6 }}>{label}</div>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13,
  background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
  borderRadius: 6, color: "var(--a-text)",
};
const errStyle: React.CSSProperties = { padding: 10, marginBottom: 12, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 12 };
const okStyle: React.CSSProperties = { padding: 10, marginBottom: 12, borderRadius: 6, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac", fontSize: 12 };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 };
const modalCard: React.CSSProperties = { width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 20, borderRadius: 12 };

function targetBg(g: GenderTarget) { return g === "boy" ? "rgba(110,193,255,0.18)" : g === "girl" ? "rgba(255,155,209,0.18)" : "rgba(212,197,160,0.18)"; }
function targetFg(g: GenderTarget) { return g === "boy" ? "#8ed1ff" : g === "girl" ? "#ffb6dd" : "#e8dcc0"; }
