import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, XCircle, FileText, Loader2, ShieldCheck, RefreshCw, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  userId: string | null;
  /** Initial status from parent — we keep this in sync with realtime updates from `profiles`. */
  currentStatus: "not_started" | "pending" | "approved" | "rejected";
  /** Optional callback so the parent can mirror status changes (e.g. update header badge). */
  onStatusChange?: (s: "not_started" | "pending" | "approved" | "rejected") => void;
}

interface Submission {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  provider: string;
  created_at: string;
  updated_at: string;
}

type KycStatus = "not_started" | "pending" | "approved" | "rejected";

interface Step {
  key: string;
  label: string;
  hint: string;
  ts: string | null;
  state: "done" | "current" | "future" | "failed";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function fmtRelative(ts: string | null): string {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}

const POLL_MS = 15_000;

export function KycTimeline({ userId, currentStatus, onStatusChange }: Props) {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [status, setStatus] = useState<KycStatus>(currentStatus);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<number>(Date.now());
  const [tick, setTick] = useState(0); // forces relative-time re-render
  const mountedRef = useRef(true);

  // Keep prop->state in sync if parent re-fetches.
  useEffect(() => { setStatus(currentStatus); }, [currentStatus]);

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!userId) return;
    if (!opts?.silent) setRefreshing(true);
    const [{ data: subs, error: sErr }, { data: prof, error: pErr }] = await Promise.all([
      supabase.from("kyc_submissions")
        .select("id,status,reason,provider,created_at,updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase.from("profiles")
        .select("kyc_status")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (!mountedRef.current) return;
    if (sErr) setErr(sErr.message);
    else { setErr(null); setRows((subs ?? []) as Submission[]); }
    if (!pErr && prof?.kyc_status) {
      const next = prof.kyc_status as KycStatus;
      setStatus((prev) => {
        if (prev !== next) onStatusChange?.(next);
        return next;
      });
    }
    setLastSync(Date.now());
    if (!opts?.silent) setRefreshing(false);
  }, [userId, onStatusChange]);

  // Initial load + cleanup flag
  useEffect(() => {
    mountedRef.current = true;
    void fetchAll({ silent: true });
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  // Realtime: kyc_submissions + profiles row.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`kyc-live-${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "kyc_submissions", filter: `user_id=eq.${userId}` },
        () => { void fetchAll({ silent: true }); })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        () => { void fetchAll({ silent: true }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchAll]);

  // Polling fallback (every 15s) — covers cases where realtime is throttled
  // or the user's tab missed a notification.
  useEffect(() => {
    if (!userId) return;
    const id = window.setInterval(() => { void fetchAll({ silent: true }); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [userId, fetchAll]);

  // Re-render every 30s so "X minutes ago" stays accurate.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const latest = rows?.at(-1) ?? null;
  const submittedTs = rows?.at(0)?.created_at ?? null;
  const reviewTs = latest?.created_at ?? null;
  const decisionTs = latest && latest.status !== "pending" ? latest.updated_at : null;

  // The most recent timestamp across the whole flow — shown in the live header.
  const latestActivityTs = useMemo(() => {
    const candidates = [decisionTs, reviewTs, submittedTs].filter(Boolean) as string[];
    if (!candidates.length) return null;
    return candidates.sort().at(-1) ?? null;
  }, [decisionTs, reviewTs, submittedTs]);

  // Map effective status into a friendly stage label + tone for the header.
  const stageMeta = useMemo(() => {
    switch (status) {
      case "approved":
        return { label: "Verified", tone: "text-emerald-300", bg: "bg-emerald-400/10", border: "border-emerald-400/30", icon: CheckCircle2 };
      case "rejected":
        return { label: "Rejected", tone: "text-red-300", bg: "bg-red-400/10", border: "border-red-400/30", icon: XCircle };
      case "pending":
        return { label: "In review", tone: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/30", icon: Clock };
      default:
        return { label: "Not started", tone: "text-white/70", bg: "bg-white/5", border: "border-white/15", icon: ShieldCheck };
    }
  }, [status]);

  if (!userId) return null;

  if (err && rows == null) {
    return (
      <div className="pp-card px-3.5 py-3.5 text-[12.5px] text-red-200/80 border-red-400/20">
        Couldn't load KYC timeline: {err}
        <button onClick={() => void fetchAll()} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  if (rows == null) {
    return (
      <div className="pp-card px-3.5 py-6 flex items-center justify-center text-white/55 text-[12px]" role="status" aria-busy>
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Loading KYC history…
      </div>
    );
  }

  const steps: Step[] = [
    {
      key: "submitted",
      label: "Documents submitted",
      hint: rows.length ? `${rows.length} submission${rows.length > 1 ? "s" : ""} via ${latest?.provider ?? "—"}` : "Not started yet",
      ts: submittedTs,
      state: rows.length ? "done" : status === "not_started" ? "current" : "future",
      icon: FileText,
    },
    {
      key: "review",
      label: "Under review",
      hint: latest?.status === "pending" ? "Our team is reviewing your documents." : reviewTs ? "Review completed" : "Awaiting submission",
      ts: reviewTs,
      state:
        status === "pending" ? "current" :
        latest && latest.status !== "pending" ? "done" :
        "future",
      icon: Clock,
    },
    {
      key: "decision",
      label:
        status === "approved" ? "Verified" :
        status === "rejected" ? "Rejected" :
        "Decision",
      hint:
        status === "approved" ? "Your identity is verified. All features unlocked." :
        status === "rejected" ? (latest?.reason ?? "We couldn't verify your documents. Please re-submit.") :
        "Pending review",
      ts: decisionTs,
      state:
        status === "approved" ? "done" :
        status === "rejected" ? "failed" :
        "future",
      icon: status === "rejected" ? XCircle : status === "approved" ? CheckCircle2 : ShieldCheck,
    },
  ];

  return (
    <div className="space-y-3">
      {/* Live status header — surfaces the latest stage + timestamp + a "live" pulse. */}
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl border ${stageMeta.border} ${stageMeta.bg}`}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${stageMeta.bg} border ${stageMeta.border}`}>
          <stageMeta.icon className={`w-4 h-4 ${stageMeta.tone}`} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={`text-[13px] font-semibold ${stageMeta.tone}`}>{stageMeta.label}</p>
            <span className="inline-flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-white/45">
              <span className="relative inline-block w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400" />
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
              </span>
              Live
            </span>
          </div>
          <p className="text-[11px] text-white/55 mt-0.5 truncate">
            {latestActivityTs ? <>Updated {fmtRelative(latestActivityTs)} · {fmt(latestActivityTs)}</> : "No activity yet"}
            {/* invisible dependency so the formatter re-runs every tick */}
            <span className="sr-only">{tick}</span>
          </p>
        </div>
        <button
          onClick={() => void fetchAll()}
          aria-label="Refresh KYC status now"
          className="qa-icon-btn shrink-0"
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 text-white/80 ${refreshing ? "animate-spin" : ""}`} strokeWidth={2} />
        </button>
      </div>

      {/* Timeline */}
      <ol className="pp-timeline" role="list">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={s.key} className={`pp-tl-item pp-tl-${s.state}`}>
              <div className="pp-tl-dot">
                <s.icon className="w-3.5 h-3.5" strokeWidth={2.4} />
              </div>
              {!isLast && <div className="pp-tl-line" aria-hidden />}
              <div className="pp-tl-body">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[13px] text-white font-medium">{s.label}</p>
                  <span className="text-[10.5px] num-mono text-white/50 shrink-0">{fmt(s.ts)}</span>
                </div>
                <p className="text-[11.5px] text-white/60 mt-0.5 leading-snug">{s.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-[10px] text-white/35 text-center inline-flex items-center justify-center gap-1 w-full">
        <Radio className="w-2.5 h-2.5" /> Auto-refreshing · last sync {fmtRelative(new Date(lastSync).toISOString())}
      </p>
    </div>
  );
}
