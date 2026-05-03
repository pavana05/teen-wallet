/**
 * Reusable error / empty / skeleton components for Home sections.
 *
 * Design tokens: champagne/warm-gold accents on premium dark backgrounds.
 * Shake animation on error, standardised retry action.
 */

import { RefreshCw, Inbox, AlertTriangle } from "lucide-react";
import { haptics } from "@/lib/haptics";

/* ── Skeleton ── */
export function SectionSkeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="hss-skel" />
      ))}
      <span className="sr-only" role="status">Loading…</span>
      <style>{hssStyles}</style>
    </div>
  );
}

/* ── Error ── */
export function SectionError({
  message = "Something went wrong",
  detail,
  onRetry,
  className = "",
}: {
  message?: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={`hss-error hss-shake ${className}`}>
      <div className="hss-error-icon">
        <AlertTriangle className="w-6 h-6" strokeWidth={1.8} />
      </div>
      <p className="hss-error-title">{message}</p>
      {detail && <p className="hss-error-detail">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={() => { void haptics.tap(); onRetry(); }}
          className="hss-retry-btn"
        >
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} />
          Retry
        </button>
      )}
      <style>{hssStyles}</style>
    </div>
  );
}

/* ── Empty ── */
export function SectionEmpty({
  title = "Nothing here yet",
  detail,
  icon: Icon = Inbox,
  className = "",
}: {
  title?: string;
  detail?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  className?: string;
}) {
  return (
    <div className={`hss-empty ${className}`}>
      <div className="hss-empty-icon">
        <Icon className="w-7 h-7" strokeWidth={1.6} />
      </div>
      <p className="hss-error-title">{title}</p>
      {detail && <p className="hss-error-detail">{detail}</p>}
      <style>{hssStyles}</style>
    </div>
  );
}

const hssStyles = `
  /* Skeleton shimmer — champagne sweep on dark graphite */
  .hss-skel {
    height: 56px;
    border-radius: 16px;
    background: linear-gradient(
      110deg,
      oklch(0.14 0.005 250) 0%,
      oklch(0.19 0.015 85) 40%,
      oklch(0.24 0.02 85) 50%,
      oklch(0.19 0.015 85) 60%,
      oklch(0.14 0.005 250) 100%
    );
    background-size: 200% 100%;
    animation: hss-sweep 1.8s ease-in-out infinite;
  }
  @keyframes hss-sweep {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Error container */
  .hss-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 24px;
    border-radius: 22px;
    background: oklch(0.12 0.005 250);
    border: 1px solid oklch(0.65 0.08 25 / 0.2);
    text-align: center;
  }
  .hss-error-icon {
    width: 52px; height: 52px; border-radius: 16px;
    background: oklch(0.65 0.08 25 / 0.12);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.7 0.06 25);
    margin-bottom: 12px;
  }
  .hss-error-title {
    font-size: 14px; font-weight: 600;
    color: oklch(0.9 0.01 250);
  }
  .hss-error-detail {
    font-size: 12px;
    color: oklch(0.55 0.01 250);
    margin-top: 4px; max-width: 260px;
  }

  /* Shake animation on error */
  .hss-shake {
    animation: hss-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }
  @keyframes hss-shake {
    10%, 90% { transform: translateX(-1px); }
    20%, 80% { transform: translateX(2px); }
    30%, 50%, 70% { transform: translateX(-3px); }
    40%, 60% { transform: translateX(3px); }
  }

  /* Retry button — warm gold accent */
  .hss-retry-btn {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 16px; padding: 10px 22px; border-radius: 12px;
    background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
    color: oklch(0.12 0.005 250);
    font-size: 13px; font-weight: 600;
    border: none; cursor: pointer;
    transition: transform 120ms ease;
  }
  .hss-retry-btn:active { transform: scale(0.96); }

  /* Empty container */
  .hss-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 24px;
    text-align: center;
  }
  .hss-empty-icon {
    width: 56px; height: 56px; border-radius: 18px;
    background: oklch(0.82 0.06 85 / 0.08);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.7 0.04 85);
    margin-bottom: 14px;
  }

  @media (prefers-reduced-motion: reduce) {
    .hss-skel { animation: none; }
    .hss-shake { animation: none; }
  }
`;
