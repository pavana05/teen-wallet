/**
 * Trusted devices management — lists every device fingerprint the user has
 * verified in the past, lets them rename or revoke any one, and highlights
 * the device they're currently using. Revocation immediately removes the
 * row from `trusted_devices`, so a future login on that device will trigger
 * the new-device Google verification gate again.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Smartphone, Trash2, Loader2, ShieldCheck, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceFingerprint } from "@/lib/deviceFingerprint";

interface DeviceRow {
  id: string;
  fingerprint_hash: string;
  label: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface Props {
  onBack: () => void;
}

export function TrustedDevices({ onBack }: Props) {
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentFp, setCurrentFp] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  async function load() {
    setError(null);
    const { data, error } = await supabase
      .from("trusted_devices")
      .select("id, fingerprint_hash, label, first_seen_at, last_seen_at")
      .order("last_seen_at", { ascending: false });
    if (error) {
      setError(error.message);
      setRows([]);
      return;
    }
    setRows(data ?? []);
  }

  useEffect(() => {
    void load();
    void getDeviceFingerprint().then(setCurrentFp);
  }, []);

  async function revoke(row: DeviceRow) {
    if (revoking) return;
    const isCurrent = currentFp && row.fingerprint_hash === currentFp;
    const ok = window.confirm(
      isCurrent
        ? "This is the device you're using right now. If you revoke it, you'll have to verify with Google the next time you sign in. Continue?"
        : `Revoke "${row.label ?? "this device"}"? Anyone using it will need to verify with Google before signing in again.`,
    );
    if (!ok) return;
    setRevoking(row.id);
    const { error } = await supabase.from("trusted_devices").delete().eq("id", row.id);
    setRevoking(null);
    if (error) {
      toast.error("Couldn't revoke device", { description: error.message });
      return;
    }
    toast.success("Device revoked");
    setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
  }

  async function saveLabel(row: DeviceRow) {
    const next = editValue.trim().slice(0, 40);
    setEditing(null);
    if (!next || next === row.label) return;
    const { error } = await supabase
      .from("trusted_devices")
      .update({ label: next })
      .eq("id", row.id);
    if (error) {
      toast.error("Couldn't rename", { description: error.message });
      return;
    }
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, label: next } : r)) ?? prev);
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background text-foreground tw-slide-up">
      <header className="flex items-center gap-3 px-5 pt-7 pb-3 border-b border-border/40">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-10 h-10 rounded-full glass flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold leading-tight">Trusted devices</h1>
          <p className="text-[11.5px] text-foreground/55">
            Devices that can sign in without an extra Google check
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {rows === null && (
          <div className="flex items-center justify-center py-10 text-foreground/55">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">
            Couldn't load trusted devices: {error}
          </div>
        )}

        {rows && rows.length === 0 && !error && (
          <div className="rounded-2xl border border-border/40 bg-muted/30 px-4 py-8 text-center">
            <Smartphone className="w-6 h-6 text-foreground/40 mx-auto" />
            <p className="text-[13px] text-foreground/75 font-medium mt-2">No trusted devices yet</p>
            <p className="text-[11.5px] text-foreground/50 mt-1 max-w-[260px] mx-auto leading-relaxed">
              Once you verify with Google on a device, it'll show up here so you can manage it.
            </p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <ul className="space-y-2.5">
            {rows.map((row) => {
              const isCurrent = !!(currentFp && row.fingerprint_hash === currentFp);
              const short = row.fingerprint_hash.slice(0, 10);
              const isEditing = editing === row.id;
              return (
                <li
                  key={row.id}
                  className="rounded-2xl border border-border/50 bg-card/40 p-4 flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-xl glass flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5 text-foreground/80" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveLabel(row);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onBlur={() => void saveLabel(row)}
                          className="text-[13.5px] font-semibold bg-transparent border-b border-foreground/40 focus:border-foreground outline-none flex-1 min-w-0"
                          maxLength={40}
                        />
                      ) : (
                        <p className="text-[13.5px] font-semibold truncate">
                          {row.label || "Unnamed device"}
                        </p>
                      )}
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          This device
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-foreground/45 mt-0.5">
                      fp: {short}…
                    </p>
                    <p className="text-[11px] text-foreground/55 mt-1.5">
                      Added {new Date(row.first_seen_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      · last seen{" "}
                      {new Date(row.last_seen_at).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => void saveLabel(row)}
                          aria-label="Save name"
                          className="w-8 h-8 rounded-full glass flex items-center justify-center"
                        >
                          <Check className="w-4 h-4 text-primary" />
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          aria-label="Cancel"
                          className="w-8 h-8 rounded-full glass flex items-center justify-center"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditing(row.id);
                            setEditValue(row.label ?? "");
                          }}
                          aria-label="Rename device"
                          className="w-8 h-8 rounded-full glass flex items-center justify-center"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void revoke(row)}
                          disabled={revoking === row.id}
                          aria-label="Revoke device"
                          className="w-8 h-8 rounded-full bg-destructive/10 border border-destructive/30 text-destructive flex items-center justify-center disabled:opacity-60"
                        >
                          {revoking === row.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[11px] text-foreground/45 leading-relaxed pt-2 px-1">
          Revoking a device forces it to re-verify with Google the next time
          someone tries to sign in to your wallet from it. If you ever lose a
          phone, revoke it here right away.
        </p>
      </div>
    </div>
  );
}
