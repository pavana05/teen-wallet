import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import {
  RefreshCw, Plus, Trash2, X, Eye, Loader2, Check, AlertTriangle,
  Pencil, Image as ImageIcon, Upload, GripVertical, ToggleLeft, ToggleRight,
} from "lucide-react";

export const Route = createFileRoute("/admin/curations")({
  component: CurationsPage,
});

interface CurationRow {
  id: string;
  title: string;
  subtitle: string;
  image_url: string | null;
  detail_title: string | null;
  detail_body: string | null;
  detail_cta_label: string | null;
  detail_cta_url: string | null;
  accent_color: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 6 * 1024 * 1024;

function CurationsPage() {
  const [rows, setRows] = useState<CurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CurationRow | null>(null);
  const [showNew, setShowNew] = useState(false);

  const flash = (msg: string) => { setOk(msg); setTimeout(() => setOk(""), 2500); };

  const fetchAll = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: CurationRow[] }>({ action: "curations_list", sessionToken: s.sessionToken });
      setRows(r.rows);
      setErr("");
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const save = useCallback(async (data: Partial<CurationRow> & { title: string }) => {
    const s = readAdminSession();
    if (!s) return;
    setBusy(true); setErr("");
    try {
      await callAdminFn({ action: "curations_upsert", sessionToken: s.sessionToken, ...data });
      await fetchAll();
      setEditing(null); setShowNew(false);
      flash(data.id ? "Curation updated" : "Curation created");
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }, [fetchAll]);

  const del = useCallback(async (id: string) => {
    if (!confirm("Delete this curation permanently?")) return;
    const s = readAdminSession();
    if (!s) return;
    setBusy(true);
    try {
      await callAdminFn({ action: "curations_delete", sessionToken: s.sessionToken, id });
      await fetchAll();
      flash("Deleted");
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }, [fetchAll]);

  const uploadImage = useCallback(async (id: string, file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) { setErr("Use PNG, JPG or WebP"); return; }
    if (file.size > MAX_BYTES) { setErr("File too large (max 6 MB)"); return; }
    const s = readAdminSession();
    if (!s) return;
    setBusy(true); setErr("");
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await callAdminFn({ action: "curations_upload_image", sessionToken: s.sessionToken, id, contentType: file.type, fileBase64: base64 });
      await fetchAll();
      flash("Image uploaded — live now");
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setBusy(false); }
  }, [fetchAll]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Curations</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            Promotional cards on the home screen. Changes go live instantly via realtime.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="a-btn-ghost" onClick={() => void fetchAll()}><RefreshCw size={14} /> Refresh</button>
          <button className="a-btn" onClick={() => setShowNew(true)}><Plus size={14} /> New curation</button>
        </div>
      </div>

      {err && (
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {err}
          <button onClick={() => setErr("")} style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}
      {ok && (
        <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={14} /> {ok}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--a-muted)" }}>
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="a-surface" style={{ padding: 32, textAlign: "center" }}>
          <ImageIcon size={28} style={{ color: "var(--a-muted)", marginBottom: 8 }} />
          <p style={{ fontSize: 14, marginBottom: 4 }}>No curations yet</p>
          <p style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 16 }}>
            Create promotional cards that appear on users' home screens.
          </p>
          <button className="a-btn" onClick={() => setShowNew(true)}><Plus size={14} /> Create first curation</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 12 }}>
          {rows.map((r) => (
            <CurationCard key={r.id} row={r} busy={busy} onEdit={() => setEditing(r)} onDelete={() => void del(r.id)} onUpload={(f) => void uploadImage(r.id, f)} onToggle={() => void save({ ...r, active: !r.active })} />
          ))}
        </div>
      )}

      {(editing || showNew) && (
        <CurationModal
          initial={editing}
          busy={busy}
          onClose={() => { setEditing(null); setShowNew(false); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function CurationCard({ row, busy, onEdit, onDelete, onUpload, onToggle }: {
  row: CurationRow; busy: boolean;
  onEdit: () => void; onDelete: () => void;
  onUpload: (f: File) => void; onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="a-surface" style={{ padding: 12, border: "1px solid var(--a-border)", opacity: row.active ? 1 : 0.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{row.title}</div>
          <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>{row.subtitle}</div>
        </div>
        <button onClick={onToggle} title={row.active ? "Deactivate" : "Activate"} className="a-btn-ghost" style={{ padding: 6 }}>
          {row.active ? <ToggleRight size={16} style={{ color: "var(--a-success)" }} /> : <ToggleLeft size={16} />}
        </button>
      </div>

      <div style={{
        background: "var(--a-elevated)", borderRadius: 8, aspectRatio: "16 / 10",
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        position: "relative", marginBottom: 8,
      }}>
        {row.image_url ? (
          <img src={row.image_url} alt={row.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ textAlign: "center", color: "var(--a-muted)" }}>
            <ImageIcon size={20} />
            <div style={{ fontSize: 11, marginTop: 4 }}>No image</div>
          </div>
        )}
      </div>

      <input ref={inputRef} type="file" accept={ALLOWED_TYPES.join(",")} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="a-btn" onClick={() => inputRef.current?.click()} disabled={busy} style={{ flex: 1 }}>
          <Upload size={13} /> {row.image_url ? "Replace image" : "Upload image"}
        </button>
        <button className="a-btn-ghost" onClick={onEdit} title="Edit"><Pencil size={13} /></button>
        <button className="a-btn-ghost" onClick={onDelete} disabled={busy} style={{ color: "#fca5a5" }}><Trash2 size={13} /></button>
      </div>

      <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span>Order: {row.sort_order}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: row.accent_color, border: "1px solid var(--a-border)" }} />
          {row.accent_color}
        </span>
      </div>
    </div>
  );
}

function CurationModal({ initial, busy, onClose, onSave }: {
  initial: CurationRow | null; busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<CurationRow> & { title: string }) => void;
}) {
  const isNew = !initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [detailTitle, setDetailTitle] = useState(initial?.detail_title ?? "");
  const [detailBody, setDetailBody] = useState(initial?.detail_body ?? "");
  const [ctaLabel, setCtaLabel] = useState(initial?.detail_cta_label ?? "");
  const [ctaUrl, setCtaUrl] = useState(initial?.detail_cta_url ?? "");
  const [accent, setAccent] = useState(initial?.accent_color ?? "#d4c5a0");
  const [order, setOrder] = useState(initial?.sort_order ?? 0);
  const [active, setActive] = useState(initial?.active ?? true);

  const valid = title.trim().length > 0;

  return (
    <div onClick={() => !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 55, display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 560, width: "100%", padding: 24, maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{isNew ? "New Curation" : "Edit Curation"}</h3>

        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Title *" value={title} onChange={setTitle} placeholder="Block the sun drama" />
          <Field label="Subtitle" value={subtitle} onChange={setSubtitle} placeholder="UP TO 30% OFF" />
          <Field label="Detail page title" value={detailTitle} onChange={setDetailTitle} placeholder="Summer Sun Protection Sale" />
          <div>
            <div className="a-label" style={{ marginBottom: 6 }}>Detail page body</div>
            <textarea
              className="a-input"
              rows={4}
              value={detailBody}
              onChange={(e) => setDetailBody(e.target.value)}
              placeholder="Full description shown on the detail page…"
              style={{ resize: "vertical" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="CTA button label" value={ctaLabel} onChange={setCtaLabel} placeholder="Shop now" />
            <Field label="CTA deep link / URL" value={ctaUrl} onChange={setCtaUrl} placeholder="/scan or https://..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <div className="a-label" style={{ marginBottom: 6 }}>Accent color</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 32, height: 32, border: "none", borderRadius: 6, cursor: "pointer" }} />
                <input className="a-input a-mono" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ fontSize: 11 }} />
              </div>
            </div>
            <Field label="Sort order" value={String(order)} onChange={(v) => setOrder(Number(v) || 0)} placeholder="0" />
            <div>
              <div className="a-label" style={{ marginBottom: 6 }}>Active</div>
              <button onClick={() => setActive(!active)} className="a-btn-ghost" style={{ padding: "8px 12px" }}>
                {active ? <><ToggleRight size={16} style={{ color: "var(--a-success)" }} /> Yes</> : <><ToggleLeft size={16} /> No</>}
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button className="a-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="a-btn"
            disabled={!valid || busy}
            onClick={() => onSave({
              ...(initial ? { id: initial.id } : {}),
              title: title.trim(),
              subtitle: subtitle.trim(),
              detail_title: detailTitle.trim() || null,
              detail_body: detailBody.trim() || null,
              detail_cta_label: ctaLabel.trim() || null,
              detail_cta_url: ctaUrl.trim() || null,
              accent_color: accent,
              sort_order: order,
              active,
            })}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="a-label" style={{ marginBottom: 6 }}>{label}</div>
      <input className="a-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
