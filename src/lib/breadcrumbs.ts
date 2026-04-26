// Production-grade breadcrumb logger.
//
// Goals:
//  - Capture the high-signal context Sentry needs to triage real failures fast:
//    route, KYC stage, payment amount, UPI id, Supabase record IDs, fraud flags.
//  - Work BEFORE Sentry is wired up: keep an in-memory ring buffer + console
//    log so we can already debug from devtools and the Admin → Diagnostics tab.
//  - Auto-forward to Sentry the moment `window.__SENTRY__` (set by @sentry/react
//    init) is present — no refactor needed when DSN ships.
//  - Strip PII (Aadhaar full number, full UPI handle in error reports, tokens).
//
// Usage:
//   import { breadcrumb, captureError, setBreadcrumbUser } from "@/lib/breadcrumbs";
//   breadcrumb("payment.submitted", { amount, upiId, txnId });
//   captureError(err, { where: "kyc.verify" });

export type BreadcrumbCategory =
  | "auth"
  | "kyc"
  | "payment"
  | "fraud"
  | "nav"
  | "net"
  | "ui"
  | "system";

export type BreadcrumbLevel = "info" | "warning" | "error";

export interface BreadcrumbData {
  // Free-form structured context. Keep keys short & stable so Sentry search works.
  amount?: number;
  upiId?: string;          // sanitised before send
  payee?: string;
  txnId?: string;          // Supabase transactions.id
  submissionId?: string;   // Supabase kyc_submissions.id
  providerRef?: string;    // KYC provider reference (Digio etc.)
  kycStage?: string;       // STAGE_0..STAGE_5
  kycStatus?: string;      // not_started | pending | approved | rejected
  step?: number;           // sub-step inside a flow
  route?: string;          // current router path
  fraudRule?: string;
  fraudSeverity?: "block" | "warn" | "info";
  reason?: string;
  status?: number | string;
  durationMs?: number;
  [k: string]: unknown;
}

export interface BreadcrumbEntry {
  ts: number;
  event: string;
  category: BreadcrumbCategory;
  level: BreadcrumbLevel;
  data: BreadcrumbData;
}

const RING_SIZE = 100;
const ring: BreadcrumbEntry[] = [];
let userCtx: { id?: string; phone?: string } = {};

// ── Sentry detection ─────────────────────────────────────────────────────────
// We avoid a hard dependency on @sentry/react so this file ships before Sentry
// is installed. Once the SDK is initialised it exposes `window.Sentry`.
type SentryLike = {
  addBreadcrumb: (b: { category: string; message: string; level: BreadcrumbLevel; data?: Record<string, unknown> }) => void;
  captureException: (e: unknown, ctx?: { extra?: Record<string, unknown>; tags?: Record<string, string> }) => void;
  setUser: (u: { id?: string; phone?: string } | null) => void;
};
function getSentry(): SentryLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Sentry?: SentryLike };
  return w.Sentry ?? null;
}

// ── Sanitisers ───────────────────────────────────────────────────────────────
function sanitise(data: BreadcrumbData): BreadcrumbData {
  const out: BreadcrumbData = { ...data };
  if (typeof out.upiId === "string" && out.upiId.includes("@")) {
    const [name, handle] = out.upiId.split("@");
    // Keep merchant handle (helpful) but mask the local part beyond first 2 chars.
    out.upiId = `${name.slice(0, 2)}***@${handle}`;
  }
  // Never log full Aadhaar / OTPs / tokens.
  for (const k of ["aadhaar", "otp", "token", "accessToken", "selfie"]) {
    if (k in out) delete out[k];
  }
  return out;
}

function inferCategory(event: string): BreadcrumbCategory {
  const head = event.split(".")[0];
  switch (head) {
    case "auth":
    case "kyc":
    case "payment":
    case "fraud":
    case "nav":
    case "net":
    case "ui":
      return head;
    default:
      return "system";
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
export function breadcrumb(
  event: string,
  data: BreadcrumbData = {},
  level: BreadcrumbLevel = "info",
): void {
  const enriched: BreadcrumbData = sanitise({
    ...data,
    route: data.route ?? (typeof location !== "undefined" ? location.pathname : undefined),
  });
  const entry: BreadcrumbEntry = {
    ts: Date.now(),
    event,
    category: inferCategory(event),
    level,
    data: enriched,
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();

  // Dev / production console — Chrome groups these nicely and they survive
  // Sentry being absent.
  const tag = `[${entry.category}] ${event}`;
  if (level === "error") console.error(tag, enriched);
  else if (level === "warning") console.warn(tag, enriched);
  else console.info(tag, enriched);

  const sentry = getSentry();
  if (sentry) {
    try {
      sentry.addBreadcrumb({
        category: entry.category,
        message: event,
        level,
        data: enriched as Record<string, unknown>,
      });
    } catch { /* never let telemetry break the app */ }
  }
}

export function captureError(err: unknown, ctx: BreadcrumbData & { where?: string } = {}): void {
  const where = ctx.where ?? "unknown";
  const message = err instanceof Error ? err.message : String(err);
  breadcrumb(`error.${where}`, { ...ctx, reason: message }, "error");

  const sentry = getSentry();
  if (sentry) {
    try {
      sentry.captureException(err, {
        tags: { where },
        extra: sanitise(ctx) as Record<string, unknown>,
      });
    } catch { /* swallow */ }
  }
}

export function setBreadcrumbUser(user: { id?: string; phone?: string } | null): void {
  userCtx = user ?? {};
  const sentry = getSentry();
  if (sentry) {
    try { sentry.setUser(user); } catch { /* swallow */ }
  }
}

export function getRecentBreadcrumbs(): BreadcrumbEntry[] {
  return ring.slice();
}

export function getBreadcrumbUser(): { id?: string; phone?: string } {
  return userCtx;
}
