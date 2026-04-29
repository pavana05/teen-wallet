import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

const DATASET_LABEL: Record<ExportDataset, string> = {
  users: "Users",
  transactions: "Transactions",
  kyc: "KYC submissions",
  fraud: "Fraud alerts",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Export button that downloads a CSV of the given admin dataset, applying the
 * caller's current search/status/date filters server-side.
 *
 * The server enforces a hard cap (10k rows) and writes an audit log entry
 * for every export. While downloading, we show a sonner toast with live
 * progress (bytes received and percent when Content-Length is provided),
 * then a success toast with the row count + file size when complete.
 */
export function ExportCsvButton({ dataset, filters = {}, label, className }: Props) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const friendly = DATASET_LABEL[dataset];
    const toastId = toast.loading(`Preparing ${friendly} export…`, {
      description: "Querying the server",
    });
    try {
      const res = await callAdminFnRaw({ action: "export_csv", dataset, ...filters, max: 10000 });
      const total = Number(res.headers.get("content-length") || 0);

      // Stream the body so we can report live download progress.
      let blob: Blob;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        // Throttle toast updates to ~10/sec to avoid layout thrash on big files.
        let lastUpdate = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            const now = performance.now();
            if (now - lastUpdate > 100) {
              lastUpdate = now;
              const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null;
              toast.loading(`Downloading ${friendly}…`, {
                id: toastId,
                description: pct != null
                  ? `${pct}% · ${fmtBytes(received)} of ${fmtBytes(total)}`
                  : `${fmtBytes(received)} received`,
              });
            }
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: "text/csv;charset=utf-8" });
      } else {
        blob = await res.blob();
      }

      // Estimate row count from the CSV (lines minus header, ignore trailing newline).
      let rowCount = 0;
      try {
        const text = await blob.slice(0).text();
        rowCount = Math.max(0, text.split("\n").filter((l) => l.trim().length > 0).length - 1);
      } catch { /* ignore — count is best-effort */ }

      const filename = `${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(`${friendly} exported`, {
        id: toastId,
        description: `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"} · ${fmtBytes(blob.size)} · ${filename}`,
      });
    } catch (e: any) {
      toast.error(`${friendly} export failed`, {
        id: toastId,
        description: e?.message || "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
