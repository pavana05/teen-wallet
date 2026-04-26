import { AlertTriangle, Eye, ShieldCheck, Lock, RefreshCw, Loader2 } from "lucide-react";

/**
 * Shows a clear banner indicating what the current admin can do on the page.
 * Driven entirely by the role-derived booleans the caller already has in scope.
 */
export function PermissionBanner({
  canView,
  canDecide,
  decideLabel = "decide",
  resourceLabel,
}: {
  canView: boolean;
  canDecide: boolean;
  decideLabel?: string;
  resourceLabel: string;
}) {
  if (!canView) {
    return (
      <div
        role="status"
        className="a-surface"
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", marginBottom: 12, borderRadius: 8,
          border: "1px solid color-mix(in oklab, var(--a-danger) 40%, transparent)",
          background: "color-mix(in oklab, var(--a-danger) 10%, transparent)",
          color: "var(--a-danger)",
          fontSize: 13,
        }}
      >
        <Lock size={14} /> You don’t have permission to view {resourceLabel}.
      </div>
    );
  }
  const tone = canDecide ? "var(--a-success)" : "var(--a-warn)";
  const Icon = canDecide ? ShieldCheck : Eye;
  const label = canDecide
    ? `You can view and ${decideLabel} ${resourceLabel}.`
    : `Read-only access to ${resourceLabel}. You can view but not ${decideLabel}.`;
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px", marginBottom: 12, borderRadius: 8,
        border: `1px solid color-mix(in oklab, ${tone} 35%, transparent)`,
        background: `color-mix(in oklab, ${tone} 8%, transparent)`,
        color: tone, fontSize: 12, letterSpacing: "0.01em",
      }}
    >
      <Icon size={13} /> {label}
    </div>
  );
}

/**
 * Inline retryable error state. Renders nothing when there is no error.
 * Use in place of plain `<div>{err}</div>` so failures never leave a panel
 * stuck in loading and always offer an actionable path forward.
 */
export function ErrorState({
  error,
  onRetry,
  retrying,
  compact,
}: {
  error: string | null | undefined;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: compact ? "8px 12px" : "12px 14px",
        marginBottom: 12, borderRadius: 8,
        border: "1px solid color-mix(in oklab, var(--a-danger) 40%, transparent)",
        background: "color-mix(in oklab, var(--a-danger) 10%, transparent)",
        color: "var(--a-danger)", fontSize: 13,
      }}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{error}</div>
      {onRetry && (
        <button
          className="a-btn-ghost"
          onClick={onRetry}
          disabled={retrying}
          style={{ padding: "4px 10px", fontSize: 12 }}
        >
          {retrying
            ? <><Loader2 size={12} className="animate-spin" /> Retrying…</>
            : <><RefreshCw size={12} /> Retry</>}
        </button>
      )}
    </div>
  );
}
