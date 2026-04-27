/**
 * Read a CSS custom property value from a DOM scope (or :root) at runtime.
 * Used so charts and QR code modules derive their colors from the premium
 * theme tokens defined in src/styles.css instead of hard-coded constants.
 *
 * Falls back to the provided default when running on the server (SSR) or
 * when the token is not yet defined (e.g., before the stylesheet is parsed).
 */
export function cssVar(name: string, fallback: string, scope?: Element | null): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  const el = scope ?? document.documentElement;
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** Resolve admin chart palette tokens from the .admin-shell scope. */
export function adminChartTokens(): {
  series: string[];
  accent: string;
  grid: string;
  axis: string;
  legend: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  success: string;
  warn: string;
  danger: string;
  info: string;
  muted: string;
  text: string;
  dangerSoft: string;
  dangerBorder: string;
  dangerText: string;
} {
  const scope =
    typeof document !== "undefined"
      ? (document.querySelector(".admin-shell") as Element | null)
      : null;
  const v = (n: string, f: string) => cssVar(n, f, scope);
  return {
    series: [
      v("--a-chart-1", "#d4c5a0"),
      v("--a-chart-2", "#7c8db5"),
      v("--a-chart-3", "#b89b7a"),
      v("--a-chart-4", "#c2766b"),
      v("--a-chart-5", "#9c8fb5"),
      v("--a-chart-6", "#7da890"),
    ],
    accent: v("--a-chart-1", "#d4c5a0"),
    grid: v("--a-chart-grid", "#2a2a2a"),
    axis: v("--a-chart-axis", "#666"),
    legend: v("--a-chart-legend", "#888"),
    tooltipBg: v("--a-tooltip-bg", "#161616"),
    tooltipBorder: v("--a-tooltip-border", "#2a2a2a"),
    tooltipText: v("--a-tooltip-text", "#f2f2f2"),
    success: v("--a-success", "#22c55e"),
    warn: v("--a-warn", "#f59e0b"),
    danger: v("--a-danger", "#ef4444"),
    info: v("--a-info", "#3b82f6"),
    muted: v("--a-muted", "#8a8a93"),
    text: v("--a-text", "#f4f4f5"),
    dangerSoft: v("--a-danger-soft", "rgba(239,68,68,0.10)"),
    dangerBorder: v("--a-danger-border", "rgba(239,68,68,0.30)"),
    dangerText: v("--a-danger-text", "#fca5a5"),
  };
}

/** QR module color pair (dark/light) sourced from theme tokens. */
export function qrColors(): { dark: string; light: string } {
  return {
    dark: cssVar("--qr-dark", "#0a0a0a"),
    light: cssVar("--qr-light", "#ffffff"),
  };
}
