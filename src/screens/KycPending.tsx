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

export function KycPending({ onApproved }: { onApproved: () => void }) {
  const [latest, setLatest] = useState<LatestSubmission | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [pollMs, setPollMs] = useState(POLL_INTERVAL_MS);
  const stoppedRef = useRef(false);

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
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center tw-slide-up">
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(circle, oklch(0.92 0.21 122 / 0.6), transparent 70%)" }} />
          <div className="relative w-24 h-24 rounded-full bg-primary flex items-center justify-center lime-glow">
            <Check className="w-12 h-12 text-primary-foreground" strokeWidth={3} />
          </div>
        </div>
        <h1 className="text-[28px] font-bold">You're verified!</h1>
        <p className="text-[#888] text-sm mt-3 max-w-[280px]">Your wallet is ready. Taking you home…</p>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center tw-slide-up">
        <div className="w-24 h-24 rounded-full bg-destructive/15 flex items-center justify-center mb-8">
          <AlertTriangle className="w-12 h-12 text-destructive" />
        </div>
        <h1 className="text-[28px] font-bold">Verification failed</h1>
        <p className="text-[#888] text-sm mt-3 max-w-[280px]">
          {latest?.reason ?? "Your KYC was rejected by the provider. Please retake the selfie and try again."}
        </p>
        <button
          onClick={async () => { await persistStage("STAGE_3"); window.location.reload(); }}
          className="btn-primary mt-8"
        >
          <RefreshCw className="w-4 h-4" /> Retake KYC
        </button>
        {latest && (
          <div className="mt-8 text-[10px] text-muted-foreground space-y-1">
            <p>Submission: <span className="num-mono">{latest.submissionId.slice(0, 8)}…</span></p>
            {latest.providerRef && <p>Provider ref: <span className="num-mono">{latest.providerRef}</span></p>}
          </div>
        )}
      </div>
    );
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
