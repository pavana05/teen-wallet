import { useEffect, useState, useRef } from "react";
import { RefreshCw, X, AlertTriangle, Loader2 } from "lucide-react";
import { setStage as persistStage, updateProfileFields } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

type Status = "pending" | "approved" | "rejected" | "unknown";

interface LatestSubmission {
  submissionId: string;
  providerRef: string | null;
  status: Status;
  submittedAt: string;
  reason: string | null;
}

const POLL_INTERVAL_MS = 4000;
const POLL_BACKOFF_MAX_MS = 15000;
const REJECTION_REASON_KEY = "tw-kyc-rejection-reason";
const PENDING_STATE_KEY = "tw-kyc-pending-state-v1";
const APPROVED_ANIMATION_MS = 2400;
const CONTINUE_TRANSITION_MS = 520;

interface PersistedPendingState {
  submittedAt: string;     // ISO — when submission first appeared
  lastSeenAt: string;      // ISO — last successful poll
  lastFetchAt: string;     // ISO — last fetch attempt (success or fail)
  submissionId: string | null;
}

// Estimated time-to-verify used to drive the neon-lime progress bar.
// Real verification usually completes in 30–120s; we asymptote toward 95% so the
// bar never "completes" before the actual approval webhook lands.
const ESTIMATED_VERIFY_MS = 120_000;
const PROGRESS_CEILING = 0.95;

function readPersisted(): PersistedPendingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedPendingState;
  } catch { return null; }
}
function writePersisted(s: PersistedPendingState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PENDING_STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function clearPersisted() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PENDING_STATE_KEY); } catch { /* ignore */ }
}

export function KycPending({ onApproved, forceState, forceReason }: { onApproved: () => void; forceState?: Status; forceReason?: string }) {
  // Hydrate persisted rejection reason synchronously so the rejected screen
  // shows the same explanation across reloads even before the network round-trip.
  const persistedReason =
    typeof window !== "undefined" ? localStorage.getItem(REJECTION_REASON_KEY) : null;

  // Hydrate persisted submittedAt so the "Submitted X ago" line is correct
  // immediately on reopen — before the network round-trip completes.
  const persistedPending = forceState ? null : readPersisted();

  // NOTE: Avoid `new Date()` in useState initializer — runs on both SSR and client
  // and produces different timestamps → hydration mismatch. For forceState, start
  // null and seed in a client-only effect below.
  const [latest, setLatest] = useState<LatestSubmission | null>(
    forceState
      ? null
      : persistedPending
        ? { submissionId: persistedPending.submissionId ?? "cached", providerRef: null, status: "pending", submittedAt: persistedPending.submittedAt, reason: null }
        : null
  );
  useEffect(() => {
    if (forceState && !latest) {
      setLatest({ submissionId: "preview", providerRef: "preview", status: forceState, submittedAt: new Date().toISOString(), reason: forceReason ?? persistedReason ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceState]);
  const [status, setStatus] = useState<Status>(forceState ?? "pending");
  const [pollMs, setPollMs] = useState(POLL_INTERVAL_MS);
  // Initial-load skeleton: only true until first fetch resolves (success or error).
  const [initialLoading, setInitialLoading] = useState<boolean>(!forceState && !persistedPending);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Track last successful fetch — used by the progress bar to refine its estimate
  // (and seeded from persisted state so reload doesn't reset freshness).
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(
    persistedPending?.lastSeenAt ?? null
  );
  const stoppedRef = useRef(!!forceState);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hard stop: tear down realtime + polling immediately when we reach a terminal state.
  // Prevents redirect loops and lingering subscriptions.
  const stopAllListeners = () => {
    stoppedRef.current = true;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  };

  // Fetch the latest submission row + reconcile profile.kyc_status.
  // Returns true on success, false on error so callers can react.
  const fetchLatest = async (): Promise<boolean> => {
    if (stoppedRef.current) return true;
    try {
      const { data: u, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!u.user) {
        setInitialLoading(false);
        return true; // not signed-in is not a transient error
      }
      const { data: rows, error } = await supabase
        .from("kyc_submissions")
        .select("id,provider_ref,status,created_at,reason")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const r = rows?.[0];
      setInitialLoading(false);
      setFetchError(null);
      if (!r) return true;
      const next: LatestSubmission = {
        submissionId: r.id,
        providerRef: r.provider_ref,
        status: r.status as Status,
        submittedAt: r.created_at,
        reason: r.reason,
      };
      setLatest(next);
      setStatus(next.status);

      // Persist for cross-reload resume (only while still pending).
      const nowIso = new Date().toISOString();
      setLastFetchAt(nowIso);
      if (next.status === "pending") {
        writePersisted({
          submittedAt: next.submittedAt,
          lastSeenAt: nowIso,
          lastFetchAt: nowIso,
          submissionId: next.submissionId,
        });
      }

      if (next.status === "approved") {
        stopAllListeners();
        // Clear any stale rejection reason now that the user is approved.
        try { localStorage.removeItem(REJECTION_REASON_KEY); } catch { /* ignore */ }
        clearPersisted();
        await updateProfileFields({ kyc_status: "approved" });
        await persistStage("STAGE_5");
        // Wait for the seal bounce + shimmer sweep to finish before transitioning.
        if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = setTimeout(() => onApproved(), APPROVED_ANIMATION_MS);
      } else if (next.status === "rejected") {
        stopAllListeners();
        clearPersisted();
        // Persist the reason so a reload still shows it.
        if (next.reason) {
          try { localStorage.setItem(REJECTION_REASON_KEY, next.reason); } catch { /* ignore */ }
        }
        await updateProfileFields({ kyc_status: "rejected" });
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't reach verification service";
      setInitialLoading(false);
      setFetchError(message);
      return false;
    }
  };

  // Initial fetch + polling loop with gentle exponential backoff (caps at 15s).
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void fetchLatest();
    const loop = () => {
      if (stoppedRef.current) return;
      timeout = setTimeout(async () => {
        if (stoppedRef.current) return;
        await fetchLatest();
        if (!stoppedRef.current) {
          setPollMs((cur) => Math.min(POLL_BACKOFF_MAX_MS, Math.round(cur * 1.25)));
          loop();
        }
      }, pollMs);
    };
    loop();
    return () => {
      stoppedRef.current = true;
      if (timeout) clearTimeout(timeout);
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription — instant updates when the provider webhook lands.
  useEffect(() => {
    void (async () => {
      if (stoppedRef.current) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || stoppedRef.current) return;
      channelRef.current = supabase
        .channel(`kyc-pending-${u.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "kyc_submissions", filter: `user_id=eq.${u.user.id}` },
          () => { if (!stoppedRef.current) void fetchLatest(); },
        )
        .subscribe();
    })();
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const retryNow = async () => {
    setRetrying(true);
    setPollMs(POLL_INTERVAL_MS);
    const ok = await fetchLatest();
    setRetrying(false);
    if (ok) {
      // Make sure the local stage stays at STAGE_4 while still pending —
      // protects against a stale cached stage drifting after a manual retry.
      try { await persistStage("STAGE_4"); } catch { /* ignore */ }
    }
  };

  // ---------- Visuals ----------

  // Close X / Continue on rejected → return to Aadhaar KYC step.
  const goBackToAadhaarKyc = async () => {
    stopAllListeners();
    await persistStage("STAGE_3");
    window.location.reload();
  };

  if (status === "approved") {
    return <ApprovedView onContinue={onApproved} onClose={onApproved} />;
  }

  if (status === "rejected") {
    // Prefer fresh reason; fall back to persisted reason from a previous session.
    const shownReason = latest?.reason ?? persistedReason ?? null;
    return <RejectedView reason={shownReason} onRetake={goBackToAadhaarKyc} onClose={goBackToAadhaarKyc} />;
  }

  // Pending / unknown — premium dark luxury layout (matches reference mock)
  return (
    <PendingView
      pollMs={pollMs}
      latest={latest}
      onRetry={retryNow}
      onClose={onApproved}
      initialLoading={initialLoading}
      fetchError={fetchError}
      retrying={retrying}
      lastFetchAt={lastFetchAt}
    />
  );
}

/* ----------------------------- Pending View ----------------------------- */

function PendingView({
  pollMs,
  latest,
  onRetry,
  onClose,
  initialLoading,
  fetchError,
  retrying,
  lastFetchAt,
}: {
  pollMs: number;
  latest: LatestSubmission | null;
  onRetry: () => void | Promise<void>;
  onClose: () => void;
  initialLoading: boolean;
  fetchError: string | null;
  retrying: boolean;
  lastFetchAt: string | null;
}) {
  // Render submission timestamp on client only — avoids SSR/CSR locale + timezone hydration mismatch.
  const [submittedLabel, setSubmittedLabel] = useState<string | null>(null);
  // Time-based neon-lime progress (0..PROGRESS_CEILING) that resumes after reload.
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);
  // Re-trigger shake on each new error string by keying the banner on it.
  const errorKey = fetchError ?? "";

  useEffect(() => {
    if (!latest?.submittedAt) { setSubmittedLabel(null); return; }
    const fmt = () => {
      const d = new Date(latest.submittedAt);
      const diffSec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
      if (diffSec < 60) return `${diffSec}s ago`;
      if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
      return d.toLocaleString();
    };
    setSubmittedLabel(fmt());
    const t = setInterval(() => setSubmittedLabel(fmt()), 1000);
    return () => clearInterval(t);
  }, [latest?.submittedAt]);

  // Smooth time-based progress that survives reloads + app-background pauses.
  // Math:
  //   x = elapsed_active / ESTIMATED_VERIFY_MS   (eased: 1 - (1-x)^2)
  //   When the tab is hidden, we freeze elapsed; on visibility resume we recompute
  //   from submittedAt so the bar never jumps backward (ratchet via Math.max).
  //   lastFetchAt is used as a freshness hint — if no successful poll has happened
  //   recently, we cap the bar slightly lower (≤ 0.85) so it visibly "waits" for
  //   the next refresh rather than asymptoting close to the ceiling on stale data.
  useEffect(() => {
    if (!latest?.submittedAt) { setProgress(0); return; }
    const submittedAtMs = new Date(latest.submittedAt).getTime();
    const lastFetchMs = lastFetchAt ? new Date(lastFetchAt).getTime() : Date.now();
    const STALE_AFTER_MS = 20_000;

    let cancelled = false;

    const compute = () => {
      const elapsed = Math.max(0, Date.now() - submittedAtMs);
      const x = Math.min(1, elapsed / ESTIMATED_VERIFY_MS);
      const eased = 1 - (1 - x) * (1 - x);
      const base = eased * PROGRESS_CEILING + 0.04;
      // Stale-data cap — fade ceiling down toward 0.85 if we haven't heard back recently
      const sinceFetch = Math.max(0, Date.now() - lastFetchMs);
      const stalePenalty = sinceFetch > STALE_AFTER_MS
        ? Math.min(0.10, ((sinceFetch - STALE_AFTER_MS) / 60_000) * 0.10)
        : 0;
      const ceiling = PROGRESS_CEILING - stalePenalty;
      return Math.min(ceiling, base);
    };

    // Ratchet — never let the bar move backward visually
    setProgress((prev) => Math.max(prev, compute()));

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(() => {
        if (cancelled) return;
        setProgress((prev) => Math.max(prev, compute()));
      }, 500);
    };
    const stop = () => {
      if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
    };

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Don't start the ticker yet; wait for visibility
    } else {
      start();
    }

    const onVis = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        // Recompute immediately from real elapsed time so we catch up after background
        setProgress((prev) => Math.max(prev, compute()));
        start();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      cancelled = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [latest?.submittedAt, lastFetchAt]);

  const handleContinue = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onClose(), CONTINUE_TRANSITION_MS);
  };

  return (
    <div className={`kyc-result-root kyc-pending-stage ${exiting ? "kyc-exit" : ""}`}>
      <div className="kyc-result-glow yellow" />
      <div className="kyc-pending-rays" aria-hidden="true" />

      <button className="kyc-close-btn" onClick={handleContinue} aria-label="Close">
        <X className="w-6 h-6" strokeWidth={2.2} />
      </button>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-12">
        {initialLoading ? (
          <PendingSkeleton />
        ) : (
          <>
            {/* Soft ripple wave behind badge */}
            <div className="kyc-pending-ripple" aria-hidden="true">
              <span /><span /><span />
            </div>

            <div className="kyc-seal-bounce">
              <ClockBadge />
            </div>

            {/* Shimmer that sweeps once over the badge */}
            <div className="kyc-pending-shimmer" aria-hidden="true" />

            <h1 className="kyc-approved-title mt-10 text-white text-[24px] font-semibold tracking-tight text-center">
              Verifying your KYC
            </h1>
            <p className="kyc-approved-sub mt-2 text-white/60 text-sm text-center max-w-[280px]">
              Hang tight — this usually takes under 2 minutes.
            </p>

            <div
              className="kyc-pending-progress mt-8 w-full max-w-[260px]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              style={{ ["--kyc-progress" as never]: progress }}
            >
              <div className="kyc-pending-progress-fill" />
            </div>

            {latest && (
              <div className="mt-7 text-[11px] text-white/45 text-center space-y-0.5">
                <p>Auto-refreshing every {Math.round(pollMs / 1000)}s</p>
                {submittedLabel && (
                  <p suppressHydrationWarning>Submitted {submittedLabel}</p>
                )}
              </div>
            )}

            {fetchError && (
              <div key={errorKey} className="kyc-error-banner mt-6" role="alert" aria-live="polite">
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2.2} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-red-100">Couldn't reach verification</p>
                  <p className="text-[11px] text-red-200/75 truncate">{fetchError}</p>
                </div>
                <button
                  onClick={onRetry}
                  disabled={retrying}
                  className="kyc-error-retry"
                >
                  {retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Retry</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="relative z-10 px-6 pb-8 safe-bottom flex flex-col items-center gap-3">
        {!initialLoading && !fetchError && (
          <button onClick={onRetry} disabled={retrying} className="text-[12px] text-white/55 inline-flex items-center gap-1.5 hover:text-white transition-colors disabled:opacity-50">
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh now
          </button>
        )}
        <button className="kyc-continue-btn" onClick={handleContinue} disabled={initialLoading}>
          Continue in background
        </button>
      </div>
    </div>
  );
}

/* Neon-lime skeleton shown only during the very first fetch */
function PendingSkeleton() {
  return (
    <div className="kyc-skeleton-wrap" aria-busy="true" aria-label="Loading verification status">
      <div className="kyc-skel-badge" />
      <div className="kyc-skel-line kyc-skel-line-1 mt-10" />
      <div className="kyc-skel-line kyc-skel-line-2 mt-3" />
      <div className="kyc-skel-line kyc-skel-line-3 mt-8" />
    </div>
  );
}


/* ----------------------------- Clock Badge ----------------------------- */

function ClockBadge() {
  return (
    <svg className="kyc-seal yellow" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="seal-yellow-glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(255,221,87,0.55)" />
          <stop offset="60%" stopColor="rgba(255,180,30,0.18)" />
          <stop offset="100%" stopColor="rgba(255,180,30,0)" />
        </radialGradient>
        <linearGradient id="seal-yellow-stroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd84a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      {/* Inner soft glow fill */}
      <circle cx="70" cy="70" r="58" fill="url(#seal-yellow-glow)" />
      {/* Scalloped neon ring — 12 bumps */}
      <path
        d="M70 8
           c5 0 9 5 14 5 s9-4 14-2 6 7 10 9 9 1 12 4 3 9 5 12 7 5 8 9 -1 9 1 12 6 6 6 10 -4 8 -4 12 4 8 4 12 -4 8 -6 12 -3 8 -6 10 -8 1 -12 4 -6 7 -10 9 -9-2 -14 0 -9 5 -14 5 -9-5 -14-5 -9 4 -14 2 -6-7 -10-9 -9-1 -12-4 -3-9 -5-12 -7-5 -8-9 1-9 -1-12 -6-6 -6-10 4-8 4-12 -4-8 -4-12 4-8 6-12 3-8 6-10 8-1 12-4 6-7 10-9 9 2 14 0 9-5 14-5z"
        fill="none"
        stroke="url(#seal-yellow-stroke)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* Clock face */}
      <circle cx="70" cy="70" r="22" fill="none" stroke="#fff" strokeWidth="3.2" />
      {/* Hour hand — animated rotation */}
      <line className="kyc-clock-hand-hour" x1="70" y1="70" x2="70" y2="56" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      {/* Minute hand — animated rotation */}
      <line className="kyc-clock-hand-min" x1="70" y1="70" x2="82" y2="70" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx="70" cy="70" r="2" fill="#fff" />
    </svg>
  );
}

/* ----------------------------- Seal Badge ----------------------------- */

function SealBadge({ variant }: { variant: "green" | "red" }) {
  const fillTop = variant === "green" ? "#22c55e" : "#dc2626";
  const fillBot = variant === "green" ? "#15803d" : "#7f1d1d";
  const stroke = variant === "green" ? "#86efac" : "#fca5a5";
  return (
    <svg className={`kyc-seal ${variant}`} viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`seal-${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="100%" stopColor={fillBot} />
        </linearGradient>
        <radialGradient id={`seal-shine-${variant}`} cx="50%" cy="35%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Scalloped/wavy outer shape — 12 bumps */}
      <path
        d="M70 8
           c5 0 9 5 14 5 s9-4 14-2 6 7 10 9 9 1 12 4 3 9 5 12 7 5 8 9 -1 9 1 12 6 6 6 10 -4 8 -4 12 4 8 4 12 -4 8 -6 12 -3 8 -6 10 -8 1 -12 4 -6 7 -10 9 -9-2 -14 0 -9 5 -14 5 -9-5 -14-5 -9 4 -14 2 -6-7 -10-9 -9-1 -12-4 -3-9 -5-12 -7-5 -8-9 1-9 -1-12 -6-6 -6-10 4-8 4-12 -4-8 -4-12 4-8 6-12 3-8 6-10 8-1 12-4 6-7 10-9 9 2 14 0 9-5 14-5z"
        fill={stroke}
        opacity="0.9"
      />
      {/* Inner solid seal */}
      <circle cx="70" cy="70" r="44" fill={`url(#seal-${variant})`} />
      <circle cx="70" cy="70" r="44" fill={`url(#seal-shine-${variant})`} />
      {/* Inner ring highlight */}
      <circle cx="70" cy="70" r="44" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />

      {variant === "green" ? (
        <path
          className="kyc-check-path"
          d="M52 72 L66 86 L92 58"
          stroke="#fff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <>
          <path
            className="kyc-check-path"
            d="M55 55 L85 85"
            stroke="#fff"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
          <path
            className="kyc-check-path kyc-cross-path-2"
            d="M85 55 L55 85"
            stroke="#fff"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
    </svg>
  );
}

/* ----------------------------- Approved View ----------------------------- */

function ApprovedView({ onContinue, onClose }: { onContinue: () => void; onClose: () => void }) {
  return (
    <div className="kyc-result-root kyc-approved-stage">
      <div className="kyc-result-glow green" />
      {/* Full-screen shimmer sweep that plays once after the seal lands */}
      <div className="kyc-approved-shimmer" aria-hidden="true" />

      <button className="kyc-close-btn" onClick={onClose} aria-label="Close">
        <X className="w-6 h-6" strokeWidth={2.2} />
      </button>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-16">
        <div className="kyc-seal-bounce">
          <SealBadge variant="green" />
        </div>
        <h2 className="kyc-approved-title mt-8 text-white text-[24px] font-semibold tracking-tight">
          KYC Approved
        </h2>
        <p className="kyc-approved-sub mt-2 text-white/60 text-sm">
          Taking you to your wallet…
        </p>
      </div>

      <div className="relative z-10 px-6 pb-8 safe-bottom">
        <button className="kyc-continue-btn primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- Rejected View ----------------------------- */

function RejectedView({ reason, onRetake, onClose }: { reason: string | null; onRetake: () => void; onClose: () => void }) {
  return (
    <div className="kyc-result-root">
      <div className="kyc-result-glow red" />
      <button className="kyc-close-btn" onClick={onClose} aria-label="Close">
        <X className="w-6 h-6" strokeWidth={2.2} />
      </button>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-10">
        <SealBadge variant="red" />

        <h1 className="text-white text-[22px] font-semibold mt-10 text-center">
          Verification failed
        </h1>
        <p className="text-white/60 text-sm mt-2 text-center max-w-[280px]">
          We couldn't verify your KYC. See the reason below and try again.
        </p>

        <div className="kyc-reason-card mt-6 w-full max-w-[320px]">
          <p className="text-[10px] uppercase tracking-[0.18em] text-red-400/90 font-semibold">
            Reason for rejection
          </p>
          <p className="text-sm text-white/90 mt-1.5 leading-relaxed">
            {reason ?? "Your selfie didn't match the Aadhaar photo clearly. Please retake in good lighting with a neutral expression."}
          </p>
        </div>
      </div>

      <div className="relative z-10 px-6 pb-8 safe-bottom">
        <button className="kyc-continue-btn" onClick={onRetake}>
          <RefreshCw className="w-4 h-4 mr-2" /> Continue
        </button>
      </div>
    </div>
  );
}
