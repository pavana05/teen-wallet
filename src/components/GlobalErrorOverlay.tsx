// Floating, non-blocking error toast/overlay that surfaces the most recent
// thrown error from anywhere in the app (Supabase/RLS, boot, network, etc.)
// with a one-tap Retry button. Replaces the "silent failure → endless
// shimmer" failure mode.

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { clearError, subscribeError, type ReportedError } from "@/lib/lastError";

export function GlobalErrorOverlay() {
  const [err, setErr] = useState<ReportedError | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => subscribeError(setErr), []);

  if (!err) return null;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (err.retry) await err.retry();
      clearError();
    } catch {
      // keep overlay; new error will be reported separately
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 10000,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          width: "min(440px, 100%)",
          background: "color-mix(in oklab, var(--card, #111) 96%, transparent)",
          color: "var(--foreground, #f5f5f5)",
          border: "1px solid color-mix(in oklab, var(--destructive, #ef4444) 35%, var(--border, #222))",
          borderRadius: 16,
          padding: "12px 14px",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.55)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          animation: "fade-in 220ms ease-out",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in oklab, var(--destructive, #ef4444) 18%, transparent)",
            color: "var(--destructive, #ef4444)",
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
            {err.source ? `${labelFor(err.source)} error` : "Something went wrong"}
          </div>
          <div
            style={{
              fontSize: 12,
              opacity: 0.8,
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {err.message}
            {err.code ? ` · ${err.code}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {err.retry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid color-mix(in oklab, var(--primary, #f5f5f5) 40%, transparent)",
                background: "color-mix(in oklab, var(--primary, #f5f5f5) 15%, transparent)",
                color: "var(--foreground, #f5f5f5)",
                cursor: retrying ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <RefreshCw size={11} className={retrying ? "animate-spin" : undefined} />
              {retrying ? "Retrying" : "Retry"}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => clearError()}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border, #2a2a2a)",
              background: "transparent",
              color: "var(--muted-foreground, #a3a3a3)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <X size={11} /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function labelFor(source: string): string {
  switch (source) {
    case "supabase": return "Database";
    case "rls": return "Permission";
    case "session": return "Sign-in";
    case "boot": return "Startup";
    case "network": return "Network";
    default: return source[0]?.toUpperCase() + source.slice(1);
  }
}

export default GlobalErrorOverlay;
