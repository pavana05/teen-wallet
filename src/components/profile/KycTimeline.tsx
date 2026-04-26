import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, FileText, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  userId: string | null;
  currentStatus: "not_started" | "pending" | "approved" | "rejected";
}

interface Submission {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  provider: string;
  created_at: string;
  updated_at: string;
}

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
  } catch {
    return ts;
  }
}

export function KycTimeline({ userId, currentStatus }: Props) {
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("kyc_submissions")
        .select("id,status,reason,provider,created_at,updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as Submission[]);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!userId) return null;

  if (err) {
    return (
      <div className="pp-card px-3.5 py-3.5 text-[12.5px] text-red-200/80 border-red-400/20">
        Couldn't load KYC timeline: {err}
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

  const latest = rows.at(-1) ?? null;
  const submittedTs = rows.at(0)?.created_at ?? null;
  const reviewTs = latest?.created_at ?? null;
  const decisionTs = latest && latest.status !== "pending" ? latest.updated_at : null;

  const steps: Step[] = [
    {
      key: "submitted",
      label: "Documents submitted",
      hint: rows.length ? `${rows.length} submission${rows.length > 1 ? "s" : ""} via ${latest?.provider ?? "—"}` : "Not started yet",
      ts: submittedTs,
      state: rows.length ? "done" : currentStatus === "not_started" ? "current" : "future",
      icon: FileText,
    },
    {
      key: "review",
      label: "Under review",
      hint: latest?.status === "pending" ? "Our team is reviewing your documents." : reviewTs ? "Review completed" : "Awaiting submission",
      ts: reviewTs,
      state:
        currentStatus === "pending" ? "current" :
        latest && latest.status !== "pending" ? "done" :
        "future",
      icon: Clock,
    },
    {
      key: "decision",
      label:
        currentStatus === "approved" ? "Verified" :
        currentStatus === "rejected" ? "Rejected" :
        "Decision",
      hint:
        currentStatus === "approved" ? "Your identity is verified. All features unlocked." :
        currentStatus === "rejected" ? (latest?.reason ?? "We couldn't verify your documents. Please re-submit.") :
        "Pending review",
      ts: decisionTs,
      state:
        currentStatus === "approved" ? "done" :
        currentStatus === "rejected" ? "failed" :
        "future",
      icon: currentStatus === "rejected" ? XCircle : currentStatus === "approved" ? CheckCircle2 : ShieldCheck,
    },
  ];

  return (
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
  );
}
