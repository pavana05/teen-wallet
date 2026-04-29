import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { callAdminFnRaw } from "@/admin/lib/adminAuth";

export type ExportDataset = "users" | "transactions" | "kyc" | "fraud";

interface Props {
  dataset: ExportDataset;
  filters?: {
    search?: string;
    status?: string;
    since?: string;
    until?: string;
  };
  /** Friendly label override. */
  label?: string;
  className?: string;
}

/**
 * Export button that downloads a CSV of the given admin dataset, applying the
 * caller's current search/status/date filters server-side.
 *
 * The server enforces a hard cap (10k rows) and writes an audit log entry
 * for every export, so admins can review what data left the system.
 */
export function ExportCsvButton({ dataset, filters = {}, label, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr("");
    try {
      const res = await callAdminFnRaw({ action: "export_csv", dataset, ...filters, max: 10000 });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setErr(e?.message || "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "a-btn a-btn-ghost"}
        disabled={busy}
        onClick={go}
        title={`Download a CSV of the current ${dataset} view`}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {label ?? "Export CSV"}
      </button>
      {err && (
        <span style={{ fontSize: 11, color: "#fca5a5", marginLeft: 8 }}>
          {err}
        </span>
      )}
    </>
  );
}
