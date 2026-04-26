import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";

export interface InlineProfile {
  full_name: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
}

const nameSchema = z.string().trim().min(2, "At least 2 characters").max(80, "Too long")
  .regex(/^[\p{L}\p{M}.''\- ]+$/u, "Letters, spaces, . - ' only");
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Too long");
const dobSchema = z.string().trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return false;
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 13 && age <= 120;
  }, "You must be 13 years or older");

interface Props {
  profile: InlineProfile;
  userId: string | null;
  onSaved: (patch: Partial<InlineProfile>) => void;
}

type FieldKey = "full_name" | "email" | "dob" | "gender";

interface FieldConfig {
  key: FieldKey;
  label: string;
  placeholder: string;
  type: "text" | "email" | "date" | "select";
  options?: { value: string; label: string }[];
  format: (v: string | null) => string;
  validate: (v: string) => string | null;
}

const FIELDS: FieldConfig[] = [
  {
    key: "full_name",
    label: "Display name",
    placeholder: "Your name",
    type: "text",
    format: (v) => v ?? "Add your name",
    validate: (v) => { const r = nameSchema.safeParse(v); return r.success ? null : r.error.issues[0].message; },
  },
  {
    key: "email",
    label: "Email address",
    placeholder: "you@example.com",
    type: "email",
    format: (v) => v ?? "Add an email",
    validate: (v) => {
      if (!v.trim()) return null; // allow clearing
      const r = emailSchema.safeParse(v); return r.success ? null : r.error.issues[0].message;
    },
  },
  {
    key: "dob",
    label: "Date of birth",
    placeholder: "YYYY-MM-DD",
    type: "date",
    format: (v) => v ?? "Add your DOB",
    validate: (v) => { const r = dobSchema.safeParse(v); return r.success ? null : r.error.issues[0].message; },
  },
  {
    key: "gender",
    label: "Gender",
    placeholder: "Select",
    type: "select",
    options: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
      { value: "other", label: "Other" },
    ],
    format: (v) => v ? v[0].toUpperCase() + v.slice(1) : "Not set",
    validate: () => null,
  },
];

export function InlineEditCard({ profile, userId, onSaved }: Props) {
  return (
    <div className="pp-card divide-y divide-white/5">
      {FIELDS.map((f) => (
        <InlineRow key={f.key} field={f} initial={profile[f.key]} userId={userId} onSaved={onSaved} />
      ))}
    </div>
  );
}

function InlineRow({
  field, initial, userId, onSaved,
}: { field: FieldConfig; initial: string | null; userId: string | null; onSaved: (patch: Partial<InlineProfile>) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function start() { setValue(initial ?? ""); setErr(null); setEditing(true); }
  function cancel() { setEditing(false); setErr(null); }

  async function commit() {
    const v = value.trim();
    const validation = field.validate(v);
    if (validation) { setErr(validation); return; }
    if (!userId) { setErr("Please sign in again"); return; }
    if (v === (initial ?? "")) { setEditing(false); return; }

    setSaving(true);
    const next = v === "" ? null : v;
    const { error } = await supabase
      .from("profiles")
      .update({ [field.key]: next })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setErr(error.message);
      toast.error("Couldn't save", { description: error.message });
      return;
    }
    if (field.key === "full_name") useApp.setState({ fullName: next });
    onSaved({ [field.key]: next });
    setEditing(false);
    toast.success("Saved");
  }

  return (
    <div className="px-3.5 py-3" role="group" aria-label={field.label}>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] text-white/50 uppercase tracking-wider">{field.label}</p>
        {!editing && (
          <button onClick={start} className="text-[11px] text-primary inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20" aria-label={`Edit ${field.label}`}>
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
      </div>

      {!editing ? (
        <p className="text-[14px] text-white mt-1 truncate">{field.format(initial)}</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          {field.type === "select" && field.options ? (
            <div className="flex gap-1.5 flex-wrap flex-1">
              {field.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setValue(o.value)}
                  className={`pp-chip ${value === o.value ? "pp-chip-active" : ""}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <input
              autoFocus
              type={field.type}
              value={value}
              placeholder={field.placeholder}
              max={field.type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") cancel(); }}
              className="pp-inline-input flex-1"
              aria-invalid={!!err}
              aria-label={field.label}
            />
          )}
          <button onClick={() => void commit()} disabled={saving} className="pp-inline-btn pp-inline-ok" aria-label="Save">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={cancel} disabled={saving} className="pp-inline-btn pp-inline-cancel" aria-label="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {err && <p className="text-[11px] text-red-300 mt-1.5" role="alert">{err}</p>}
    </div>
  );
}
