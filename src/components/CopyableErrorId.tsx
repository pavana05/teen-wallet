import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Developer-friendly chip showing a correlation ID next to a user-safe error.
 * Tap-to-copy. Designed to live inside an error block.
 */
export function CopyableErrorId({ id, label = "Error ID" }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label}`}
      className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
      <span>{label}: {id}</span>
    </button>
  );
}
