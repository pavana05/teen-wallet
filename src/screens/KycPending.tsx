import { useEffect, useState, useRef, useMemo } from "react";
import { AlertTriangle, Clock, RefreshCw, Sparkles, ShieldCheck, Info } from "lucide-react";
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

/* ----------------------------- Approved View ----------------------------- */

function ApprovedView() {
  // Pre-compute confetti pieces once.
  const confetti = useMemo(() => {
    const colors = ["#C8F135", "#7CFF6B", "#22c55e", "#A8FF60", "#ffffff"];
    return Array.from({ length: 28 }).map((_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 3 + Math.random() * 2.5,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 6,
    }));
  }, []);

  return (
    <div className="flex-1 relative flex flex-col items-center justify-center p-8 text-center overflow-hidden">
      {/* Animated green aura background */}
      <div className="kyc-aura-green" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 30%, oklch(0.78 0.22 145 / 0.18), transparent 70%)",
        }}
      />

      {/* Confetti */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {confetti.map((c, i) => (
          <span
            key={i}
            className="kyc-confetti"
            style={{
              left: `${c.left}%`,
              background: c.color,
              width: c.size,
              height: c.size * 1.6,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
            }}
          />
        ))}
      </div>

      {/* Badge with pulsing rings */}
      <div className="relative mb-8">
        <div
          className="kyc-ring absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 3px oklch(0.78 0.22 145 / 0.5)" }}
        />
        <div
          className="kyc-ring-2 absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 3px oklch(0.78 0.22 145 / 0.4)" }}
        />
        <div
          className="kyc-badge-pop relative w-28 h-28 rounded-full flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, oklch(0.85 0.22 145), oklch(0.7 0.24 142))",
            boxShadow:
              "0 0 60px -5px oklch(0.78 0.22 145 / 0.8), 0 0 120px -20px oklch(0.78 0.22 145 / 0.6), inset 0 -8px 20px oklch(0.5 0.2 145 / 0.4)",
          }}
        >
          <svg width="56" height="56" viewBox="0 0 52 52" fill="none">
            <path
              className="kyc-check-path"
              d="M14 27 L23 36 L39 18"
              stroke="#0a1f0a"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>
      </div>

      <div className="kyc-fade-up" style={{ animationDelay: "650ms" }}>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
             style={{ background: "oklch(0.78 0.22 145 / 0.15)", border: "1px solid oklch(0.78 0.22 145 / 0.35)" }}>
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: "oklch(0.85 0.22 145)" }} />
          <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: "oklch(0.9 0.18 145)" }}>
            KYC Verified
          </span>
        </div>
        <h1 className="text-[30px] font-bold leading-tight">
          Congratulations! <span className="inline-block">🎉</span>
        </h1>
        <p className="text-base font-medium mt-2" style={{ color: "oklch(0.85 0.18 145)" }}>
          Welcome to Teen Wallet
        </p>
        <p className="text-[#aaa] text-sm mt-3 max-w-[300px] mx-auto leading-relaxed">
          Your account has been successfully created and verified. You're all set to start using your wallet.
        </p>
      </div>

      {/* Limit info card */}
      <div className="kyc-fade-up kyc-card-glass-green mt-6 w-full max-w-[320px] rounded-2xl p-4 text-left"
           style={{ animationDelay: "850ms" }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: "oklch(0.78 0.22 145 / 0.2)" }}>
            <Sparkles className="w-4 h-4" style={{ color: "oklch(0.88 0.2 145)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "oklch(0.85 0.18 145)" }}>
              Wallet Limit
            </p>
            <p className="text-lg font-bold mt-0.5">
              <span className="num-mono">₹10,000</span>
              <span className="text-xs font-normal text-[#888] ml-1">/ overall</span>
            </p>
            <p className="text-[11px] text-[#888] mt-1.5 leading-relaxed">
              You can transact up to ₹10,000 right now. Higher limits & premium features unlock soon.
            </p>
          </div>
        </div>
      </div>

      <p className="kyc-fade-up text-[11px] text-muted-foreground mt-6 inline-flex items-center gap-1.5"
         style={{ animationDelay: "1050ms" }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "oklch(0.85 0.22 145)" }} />
        Taking you to your wallet…
      </p>
    </div>
  );
}

/* ----------------------------- Rejected View ----------------------------- */

function RejectedView({ reason, submissionId }: { reason: string | null; submissionId: string | null }) {
  const handleRetake = async () => {
    const { setStage: persistStage } = await import("@/lib/auth");
    await persistStage("STAGE_3");
    window.location.reload();
  };

  return (
    <div className="flex-1 relative flex flex-col items-center justify-center p-8 text-center overflow-hidden">
      {/* Animated red blurred aura */}
      <div className="kyc-aura-red" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 30%, oklch(0.62 0.26 27 / 0.15), transparent 70%)",
        }}
      />

      {/* Badge with rings */}
      <div className="relative mb-8 kyc-shake-soft">
        <div
          className="kyc-ring absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 3px oklch(0.62 0.26 27 / 0.5)" }}
        />
        <div
          className="kyc-ring-2 absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 3px oklch(0.62 0.26 27 / 0.4)" }}
        />
        <div
          className="kyc-badge-pop relative w-28 h-28 rounded-full flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, oklch(0.7 0.26 27), oklch(0.55 0.24 25))",
            boxShadow:
              "0 0 60px -5px oklch(0.62 0.26 27 / 0.8), 0 0 120px -20px oklch(0.62 0.26 27 / 0.6), inset 0 -8px 20px oklch(0.4 0.2 25 / 0.5)",
          }}
        >
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <path
              className="kyc-check-path"
              d="M16 16 L36 36"
              stroke="#1f0808"
              strokeWidth="5.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              className="kyc-check-path kyc-cross-path-2"
              d="M36 16 L16 36"
              stroke="#1f0808"
              strokeWidth="5.5"
              strokeLinecap="round"
              fill="none"
              style={{ animationDelay: "700ms" }}
            />
          </svg>
        </div>
      </div>

      <div className="kyc-fade-up" style={{ animationDelay: "650ms" }}>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
             style={{ background: "oklch(0.62 0.26 27 / 0.15)", border: "1px solid oklch(0.62 0.26 27 / 0.35)" }}>
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: "oklch(0.75 0.22 27)" }} />
          <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: "oklch(0.8 0.2 27)" }}>
            Verification Failed
          </span>
        </div>
        <h1 className="text-[30px] font-bold leading-tight">We couldn't verify you</h1>
        <p className="text-[#aaa] text-sm mt-3 max-w-[300px] mx-auto leading-relaxed">
          Don't worry — this happens sometimes. Review the reason below and try again.
        </p>
      </div>

      {/* Reason card */}
      <div className="kyc-fade-up kyc-card-glass-red mt-6 w-full max-w-[320px] rounded-2xl p-4 text-left"
           style={{ animationDelay: "850ms" }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: "oklch(0.62 0.26 27 / 0.2)" }}>
            <Info className="w-4 h-4" style={{ color: "oklch(0.78 0.22 27)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "oklch(0.8 0.2 27)" }}>
              Reason for Rejection
            </p>
            <p className="text-sm mt-1 leading-relaxed text-foreground/90">
              {reason ?? "Your selfie didn't match the Aadhaar photo clearly. Please retake in good lighting with a neutral expression."}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleRetake}
        className="kyc-fade-up btn-primary mt-7"
        style={{ animationDelay: "1000ms" }}
      >
        <RefreshCw className="w-4 h-4" /> Retake KYC
      </button>

      {submissionId && (
        <p className="kyc-fade-up mt-5 text-[10px] text-muted-foreground"
           style={{ animationDelay: "1150ms" }}>
          Submission: <span className="num-mono">{submissionId.slice(0, 8)}…</span>
        </p>
      )}
    </div>
  );
}
