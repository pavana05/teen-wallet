// SavedViewsBar — chip row + popover that lets admins save the current filter
// state under a name, switch between saved views, and rename / delete them.
//
// Designed to be embedded inside an existing filter toolbar. The component is
// generic over the page's Filters shape and stays unstyled enough to slot into
// the admin's neutral chrome (uses the .a-* token classes).
import { useState, useRef, useEffect } from "react";
import { Bookmark, Plus, X, Pencil, Check } from "lucide-react";
import { useSavedViews, type SavedView } from "@/admin/lib/useSavedViews";

interface Props<F> {
  scope: string;                   // unique key per surface, e.g. "users"
  current: F;                      // current filter object — snapshotted on Save
  onApply: (filters: F) => void;   // called when user picks a view
  isActive?: (filters: F) => boolean; // optional: highlight current view chip
}

export function SavedViewsBar<F>({ scope, current, onApply, isActive }: Props<F>) {
  const { views, save, rename, remove } = useSavedViews<F>(scope);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) requestAnimationFrame(() => inputRef.current?.focus());
  }, [creating]);

  function commitSave() {
    if (!name.trim()) { setCreating(false); return; }
    save(name, current);
    setName(""); setCreating(false);
  }
  function commitRename(id: string) {
    if (editName.trim()) rename(id, editName);
    setEditingId(null); setEditName("");
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--a-muted)", fontSize: 11 }}>
        <Bookmark size={12} />
        <span className="a-label" style={{ marginRight: 4 }}>Views</span>
      </div>

      {views.length === 0 && !creating && (
        <span style={{ fontSize: 11, color: "var(--a-muted)", fontStyle: "italic" }}>None saved yet</span>
      )}

      {views.map((v: SavedView<F>) => {
        const active = isActive ? isActive(v.filters) : false;
        const isEditing = editingId === v.id;
        return (
          <div
            key={v.id}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 6px 3px 10px", borderRadius: 999,
              background: active ? "color-mix(in oklab, var(--a-accent) 12%, transparent)" : "var(--a-surface-2)",
              border: `1px solid ${active ? "var(--a-accent)" : "var(--a-border)"}`,
              fontSize: 12,
            }}
          >
            {isEditing ? (
              <>
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(v.id);
                    if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                  }}
                  style={{ background: "transparent", border: "none", outline: "none", color: "var(--a-text)", fontSize: 12, width: 100 }}
                />
                <button onClick={() => commitRename(v.id)} title="Save name"
                  style={iconBtn}><Check size={11} /></button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onApply(v.filters)}
                  title="Apply this view"
                  style={{ background: "none", border: "none", color: active ? "var(--a-accent)" : "var(--a-text)", cursor: "pointer", padding: 0, fontSize: 12 }}
                >
                  {v.name}
                </button>
                <button
                  onClick={() => { setEditingId(v.id); setEditName(v.name); }}
                  title="Rename"
                  style={iconBtn}
                ><Pencil size={10} /></button>
                <button
                  onClick={() => { if (confirm(`Delete view “${v.name}”?`)) remove(v.id); }}
                  title="Delete"
                  style={iconBtn}
                ><X size={11} /></button>
              </>
            )}
          </div>
        );
      })}

      {creating ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSave();
              if (e.key === "Escape") { setCreating(false); setName(""); }
            }}
            placeholder="View name…"
            style={{
              background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
              borderRadius: 999, padding: "3px 10px", fontSize: 12,
              color: "var(--a-text)", outline: "none", width: 140,
            }}
          />
          <button onClick={commitSave} className="a-btn" style={{ padding: "3px 8px", fontSize: 11 }}>
            <Check size={11} /> Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          title="Save current filters as a view"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 999,
            background: "transparent", border: "1px dashed var(--a-border-strong)",
            color: "var(--a-muted)", fontSize: 11, cursor: "pointer",
          }}
        >
          <Plus size={11} /> Save current
        </button>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--a-muted)", padding: 2, display: "flex", alignItems: "center",
};
