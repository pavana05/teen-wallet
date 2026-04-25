import { useEffect, useState, useRef } from "react";
import { Clock, RefreshCw, X } from "lucide-react";
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

export function KycPending({ onApproved, forceState, forceReason }: { onApproved: () => void; forceState?: Status; forceReason?: string }) {
  const [latest, setLatest] = useState<LatestSubmission | null>(
    forceState ? { submissionId: "preview", providerRef: "preview", status: forceState, submittedAt: new Date().toISOString(), reason: forceReason ?? null } : null
  );
  const [status, setStatus] = useState<Status>(forceState ?? "pending");
  const [pollMs, setPollMs] = useState(POLL_INTERVAL_MS);
  const stoppedRef = useRef(!!forceState);

  // Fetch the latest submission row + reconcile profile.kyc_status.
  const fetchLatest = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: rows, error } = await supabase
      .from("kyc_submissions")
      .select("id,provider_ref,status,created_at,reason")
      .eq("user_id", u.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return;
    const r = rows?.[0];
    if (!r) return;
    const next: LatestSubmission = {
      submissionId: r.id,
      providerRef: r.provider_ref,
      status: r.status as Status,
      submittedAt: r.created_at,
      reason: r.reason,
    };
    setLatest(next);
    setStatus(next.status);

    if (next.status === "approved") {
      stoppedRef.current = true;
      await updateProfileFields({ kyc_status: "approved" });
      await persistStage("STAGE_5");
      // Brief delay so user sees the success state before transitioning.
      setTimeout(() => onApproved(), 800);
    } else if (next.status === "rejected") {
      stoppedRef.current = true;
      await updateProfileFields({ kyc_status: "rejected" });
    }
  };

  // Initial fetch + polling loop with gentle exponential backoff (caps at 15s).
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void fetchLatest();
    const loop = () => {
      if (stoppedRef.current) return;
      timeout = setTimeout(async () => {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription — instant updates when the provider webhook lands.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      channel = supabase
        .channel(`kyc-pending-${u.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "kyc_submissions", filter: `user_id=eq.${u.user.id}` },
          () => { void fetchLatest(); },
        )
        .subscribe();
    })();
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const retryNow = () => {
    setPollMs(POLL_INTERVAL_MS);
    void fetchLatest();
  };

  // ---------- Visuals ----------

  if (status === "approved") {
    return <ApprovedView />;
  }

  if (status === "rejected") {
    return <RejectedView reason={latest?.reason ?? null} submissionId={latest?.submissionId ?? null} />;
  }

  // Pending / unknown
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center tw-slide-up">
      <div className="relative mb-8">
        <div className="absolute inset-0 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(circle, oklch(0.92 0.21 122 / 0.6), transparent 70%)" }} />
        <div className="relative w-24 h-24 rounded-full bg-primary flex items-center justify-center lime-glow">
          <Clock className="w-12 h-12 text-primary-foreground" strokeWidth={2.4} />
        </div>
      </div>

      <h1 className="text-[28px] font-bold">You're almost there!</h1>
      <p className="text-[#888] text-sm mt-3 max-w-[280px]">We're verifying your details with UIDAI. This usually takes under 2 minutes.</p>

      <div className="mt-10 w-full max-w-[280px] h-1 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full" style={{ animation: "tw-shimmer 1.4s linear infinite" }} />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Auto-refreshing every {Math.round(pollMs / 1000)}s. We'll notify you the moment your account is ready.
      </p>

      {latest && (
        <div className="mt-8 w-full max-w-[300px] glass rounded-2xl p-4 text-left">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold">Latest submission</h3>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p>Status: <span className="text-foreground uppercase tracking-wider">{latest.status}</span></p>
            <p>Submitted: {new Date(latest.submittedAt).toLocaleString()}</p>
            <p className="truncate">ID: <span className="num-mono">{latest.submissionId.slice(0, 8)}…</span></p>
            {latest.providerRef && (
              <p className="truncate">Provider ref: <span className="num-mono">{latest.providerRef}</span></p>
            )}
          </div>
        </div>
      )}

      <button onClick={retryNow} className="mt-4 text-xs text-primary inline-flex items-center gap-1 hover:underline">
        <RefreshCw className="w-3 h-3" /> Refresh now
      </button>
    </div>
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

function ApprovedView({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="kyc-result-root">
      <div className="kyc-result-glow green" />
      <button className="kyc-close-btn" onClick={onContinue} aria-label="Close">
        <X className="w-6 h-6" strokeWidth={2.2} />
      </button>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-16">
        <SealBadge variant="green" />
      </div>

      <div className="relative z-10 px-6 pb-8 safe-bottom">
        <button className="kyc-continue-btn" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- Rejected View ----------------------------- */

function RejectedView({ reason, onRetake }: { reason: string | null; onRetake: () => void }) {
  return (
    <div className="kyc-result-root">
      <div className="kyc-result-glow red" />
      <button className="kyc-close-btn" onClick={onRetake} aria-label="Close">
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
