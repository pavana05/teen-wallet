import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  RefreshCw, Upload, Image as ImageIcon, Plus, Trash2, X, Eye,
  Loader2, Check, AlertTriangle, Pencil, ImageOff,
} from "lucide-react";

export const Route = createFileRoute("/admin/app-images")({
  component: AppImagesPage,
});

interface AppImageRow {
  key: string;
  label: string;
  description: string | null;
  url: string | null;
  storage_path: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  content_type: string | null;
  updated_by_email: string | null;
  updated_at: string;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const MAX_BYTES = 6 * 1024 * 1024;

function fmtBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Reads a File into base64 (no data URI prefix) + measures intrinsic size.
async function fileToPayload(file: File): Promise<{
  base64: string; width: number | null; height: number | null;
}> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const dims = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
    if (file.type === "image/svg+xml") return resolve({ width: null, height: null });
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: null, height: null }); URL.revokeObjectURL(url); };
    img.src = url;
  });
  return { base64, ...dims };
}

function AppImagesPage() {
  const [rows, setRows] = useState<AppImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AppImageRow | null>(null);
  const [editing, setEditing] = useState<AppImageRow | null>(null);
  const [showNew, setShowNew] = useState(false);

  const fetchAll = useCallback(async () => {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    try {
      const r = await callAdminFn<{ rows: AppImageRow[] }>({ action: "app_images_list", sessionToken: s.sessionToken });
      setRows(r.rows);
      setErr("");
    } catch (e: any) {
      setErr(e?.message || "Failed to load images");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Realtime — refresh whenever any admin (or this user) changes a slot.
  useEffect(() => {
    const ch = supabase
      .channel("admin_app_images")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_images" }, () => { void fetchAll(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const flashOk = (msg: string) => {
    setOkFlash(msg);
    setTimeout(() => setOkFlash((m) => (m === msg ? null : m)), 2200);
  };

  const upload = useCallback(async (key: string, file: File, altOverride?: string) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setErr(`Unsupported file type: ${file.type || "unknown"}. Use PNG, JPG, WebP, GIF or SVG.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr(`File too large (${fmtBytes(file.size)}). Max ${fmtBytes(MAX_BYTES)}.`);
      return;
    }
    const s = readAdminSession();
    if (!s) return;
    setBusyKey(key); setErr("");
    try {
      const { base64, width, height } = await fileToPayload(file);
      await callAdminFn({
        action: "app_images_upload",
        sessionToken: s.sessionToken,
        key,
        contentType: file.type,
        fileBase64: base64,
        width, height,
        ...(altOverride != null ? { alt: altOverride } : {}),
      });
      await fetchAll();
      flashOk(`Updated "${key}" — live for everyone now.`);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusyKey(null);
    }
  }, [fetchAll]);

  const clearImage = useCallback(async (key: string) => {
    if (!confirm(`Remove the image for "${key}"? The slot stays so you can re-upload.`)) return;
    const s = readAdminSession();
    if (!s) return;
    setBusyKey(key); setErr("");
    try {
      await callAdminFn({ action: "app_images_clear", sessionToken: s.sessionToken, key });
      await fetchAll();
      flashOk(`Cleared image on "${key}".`);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusyKey(null);
    }
  }, [fetchAll]);

  const deleteSlot = useCallback(async (key: string) => {
    if (!confirm(`Delete the slot "${key}" and its image? This can't be undone.`)) return;
    const s = readAdminSession();
    if (!s) return;
    setBusyKey(key); setErr("");
    try {
      await callAdminFn({ action: "app_images_delete", sessionToken: s.sessionToken, key });
      await fetchAll();
      flashOk(`Deleted "${key}".`);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusyKey(null);
    }
  }, [fetchAll]);

  const saveMeta = useCallback(async (key: string, label: string, description: string, alt: string) => {
    const s = readAdminSession();
    if (!s) return;
    setBusyKey(key); setErr("");
    try {
      await callAdminFn({
        action: "app_images_upsert_meta",
        sessionToken: s.sessionToken,
        key, label, description, alt,
      });
      await fetchAll();
      setEditing(null);
      setShowNew(false);
      flashOk(`Saved "${key}".`);
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusyKey(null);
    }
  }, [fetchAll]);

  const totalBytes = useMemo(() => rows.reduce((sum, r) => sum + (r.bytes || 0), 0), [rows]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>App Images</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>
            Swap any image used in the app without a redeploy. Uploads go live for everyone instantly.
            {rows.length > 0 && <> · {rows.length} slots · {fmtBytes(totalBytes)} stored</>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="a-btn-ghost" onClick={() => void fetchAll()} title="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="a-btn" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New slot
          </button>
        </div>
      </div>

      {err && (
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {err}
          <button onClick={() => setErr("")} style={{ marginLeft: "auto", background: "none", border: "none", color: "inherit", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}
      {okFlash && (
        <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={14} /> {okFlash}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--a-muted)" }}>
          <Loader2 size={14} className="animate-spin" /> Loading images…
        </div>
      ) : rows.length === 0 ? (
        <div className="a-surface" style={{ padding: 32, textAlign: "center" }}>
          <ImageOff size={28} style={{ color: "var(--a-muted)", marginBottom: 8 }} />
          <p style={{ fontSize: 14, marginBottom: 4 }}>No image slots yet</p>
          <p style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 16 }}>
            Create a slot, then drop an image into it to start managing app visuals from here.
          </p>
          <button className="a-btn" onClick={() => setShowNew(true)}><Plus size={14} /> New slot</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
          {rows.map((r) => (
            <ImageCard
              key={r.key}
              row={r}
              busy={busyKey === r.key}
              onUpload={(file) => void upload(r.key, file)}
              onPreview={() => setPreviewing(r)}
              onEdit={() => setEditing(r)}
              onClear={() => void clearImage(r.key)}
              onDelete={() => void deleteSlot(r.key)}
            />
          ))}
        </div>
      )}

      {previewing && <PreviewModal row={previewing} onClose={() => setPreviewing(null)} />}
      {editing && <MetaModal initial={editing} onClose={() => setEditing(null)} onSave={(l, d, a) => void saveMeta(editing.key, l, d, a)} busy={busyKey === editing.key} />}
      {showNew && <MetaModal initial={null} onClose={() => setShowNew(false)} onSave={(l, d, a, k) => void saveMeta(k!, l, d, a)} busy={busyKey === "__new__"} />}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function ImageCard({
  row, busy, onUpload, onPreview, onEdit, onClear, onDelete,
}: {
  row: AppImageRow;
  busy: boolean;
  onUpload: (f: File) => void;
  onPreview: () => void;
  onEdit: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onUpload(f);
  };

  return (
    <div
      className="a-surface"
      style={{
        padding: 12,
        border: dragOver ? "1px dashed var(--a-accent)" : "1px solid var(--a-border)",
        transition: "border-color 120ms",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
          <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 2 }}>{row.key}</div>
        </div>
        <button className="a-btn-ghost" onClick={onEdit} title="Edit slot details" style={{ padding: 6 }}>
          <Pencil size={12} />
        </button>
      </div>

      {row.description && (
        <p style={{ fontSize: 11, color: "var(--a-muted)", marginBottom: 8, lineHeight: 1.4 }}>{row.description}</p>
      )}

      <div
        style={{
          background: "var(--a-elevated)",
          borderRadius: 8,
          aspectRatio: "16 / 9",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden", position: "relative", marginBottom: 8,
          backgroundImage: "linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.03) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.03) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.03) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
        }}
      >
        {row.url ? (
          <img
            src={row.url}
            alt={row.alt || row.label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ textAlign: "center", color: "var(--a-muted)" }}>
            <ImageOff size={20} />
            <div style={{ fontSize: 11, marginTop: 4 }}>No image yet</div>
          </div>
        )}
        {busy && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center" }}>
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--a-accent)" }} />
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--a-muted)", marginBottom: 8 }}>
        <span>
          {row.width && row.height ? `${row.width}×${row.height}` : "—"}
          {" · "}
          {fmtBytes(row.bytes)}
        </span>
        <span>{row.updated_by_email ? `${fmtAgo(row.updated_at)} by ${row.updated_by_email}` : fmtAgo(row.updated_at)}</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        style={{ display: "none" }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="a-btn" onClick={() => inputRef.current?.click()} disabled={busy} style={{ flex: 1, minWidth: 0 }}>
          <Upload size={13} /> {row.url ? "Replace" : "Upload"}
        </button>
        {row.url && (
          <button className="a-btn-ghost" onClick={onPreview} title="Preview"><Eye size={13} /></button>
        )}
        {row.url && (
          <button className="a-btn-ghost" onClick={onClear} title="Remove image (keep slot)" disabled={busy}>
            <ImageOff size={13} />
          </button>
        )}
        <button className="a-btn-ghost" onClick={onDelete} title="Delete slot" disabled={busy} style={{ color: "#fca5a5" }}>
          <Trash2 size={13} />
        </button>
      </div>

      <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 6, textAlign: "center" }}>
        Drop an image here to replace
      </div>
    </div>
  );
}

// ── Preview modal ────────────────────────────────────────────────────────────
function PreviewModal({ row, onClose }: { row: AppImageRow; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 60, display: "grid", placeItems: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "white" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</div>
            <div className="a-mono" style={{ fontSize: 11, opacity: 0.6 }}>{row.key}</div>
          </div>
          <button onClick={onClose} className="a-btn-ghost"><X size={14} /></button>
        </div>
        {row.url && (
          <img src={row.url} alt={row.alt} style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 8, background: "#111" }} />
        )}
      </div>
    </div>
  );
}

// ── Meta editor (also used for "New slot") ───────────────────────────────────
function MetaModal({
  initial, onClose, onSave, busy,
}: {
  initial: AppImageRow | null;
  onClose: () => void;
  onSave: (label: string, description: string, alt: string, key?: string) => void;
  busy: boolean;
}) {
  const isNew = !initial;
  const [key, setKey] = useState(initial?.key ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [alt, setAlt] = useState(initial?.alt ?? "");
  const valid = (!isNew || /^[a-z0-9._-]{1,64}$/.test(key)) && label.trim().length > 0;

  return (
    <div onClick={() => !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 55, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="a-surface" style={{ maxWidth: 520, width: "100%", padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{isNew ? "New image slot" : "Edit slot"}</h3>
        <p style={{ fontSize: 12, color: "var(--a-muted)", marginBottom: 16 }}>
          {isNew
            ? "Register a new named slot the app can read. After saving, drop an image into the card to publish it."
            : "Update the friendly name, helper text, and accessibility alt text for this slot."}
        </p>

        <label className="a-label" style={{ display: "block", marginBottom: 4 }}>Key {isNew && <span style={{ color: "var(--a-muted)" }}>(used in code, e.g. <span className="a-mono">home.scan_hero</span>)</span>}</label>
        <input
          className="a-input"
          value={key}
          disabled={!isNew}
          onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
          placeholder="home.scan_hero"
          maxLength={64}
        />
        {isNew && key && !/^[a-z0-9._-]{1,64}$/.test(key) && (
          <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>Lowercase letters, digits, dot, underscore, hyphen only.</div>
        )}

        <label className="a-label" style={{ display: "block", marginTop: 12, marginBottom: 4 }}>Label</label>
        <input className="a-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Home — Scan hero" />

        <label className="a-label" style={{ display: "block", marginTop: 12, marginBottom: 4 }}>Description</label>
        <textarea className="a-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="Where does this image appear in the app?" />

        <label className="a-label" style={{ display: "block", marginTop: 12, marginBottom: 4 }}>Alt text <span style={{ color: "var(--a-muted)" }}>(for screen readers)</span></label>
        <input className="a-input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} placeholder="Tap to scan and pay" />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button className="a-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="a-btn" onClick={() => onSave(label.trim(), description.trim(), alt.trim(), isNew ? key : undefined)} disabled={!valid || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
