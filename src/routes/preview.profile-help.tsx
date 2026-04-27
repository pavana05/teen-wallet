import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Smartphone, RefreshCw, X, Image as ImageIcon, Camera, Loader2, ExternalLink } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import {
  getShakeSensitivity,
  setShakeSensitivity,
  type ShakeSensitivity,
} from "@/lib/shakeSensitivity";

export const Route = createFileRoute("/preview/profile-help")({
  component: ProfileHelpPage,
});

interface ReportRow {
  id: string;
  category: string;
  message: string;
  status: string;
  route: string | null;
  created_at: string;
  resolved_at: string | null;
}

function ProfileHelpPage() {
  const nav = useNavigate();
  const { userId } = useApp();
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSens] = useState<ShakeSensitivity>("normal");

  useEffect(() => {
    setSens(getShakeSensitivity());
  }, []);

  const fetchReports = async () => {
    if (!userId) {
      setReports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("issue_reports")
      .select("id,category,message,status,route,created_at,resolved_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      setError(error.message);
      setReports([]);
    } else {
      setReports(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const onPickSensitivity = (s: ShakeSensitivity) => {
    setSens(s);
    setShakeSensitivity(s);
  };

  return (
    <PhoneShell>
      <div className="absolute inset-0 flex flex-col bg-background overflow-hidden">
        <div className="qa-bg" />
        <div className="qa-grid" />

        <header className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
          <button
            onClick={() => nav({ to: "/preview/home" })}
            aria-label="Back"
            className="qa-icon-btn"
          >
            <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
          </button>
          <h1 className="text-[15px] font-semibold text-white tracking-tight">Help & Reports</h1>
          <button
            onClick={() => void fetchReports()}
            aria-label="Refresh"
            className="qa-icon-btn"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto px-5 pb-24 pt-3 space-y-5">
          {/* ── Shake sensitivity card ── */}
          <section>
            <p className="text-[10.5px] uppercase tracking-wider text-white/45 mb-2 px-1">
              Shake to report
            </p>
            <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-white/80" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white">Detection sensitivity</p>
                  <p className="text-[11.5px] text-white/55 mt-0.5 leading-relaxed">
                    Shake the phone to report a problem. Pick how sensitive the detector should be.
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Shake sensitivity">
                {(["off", "normal", "strict"] as ShakeSensitivity[]).map((opt) => {
                  const active = sensitivity === opt;
                  return (
                    <button
                      key={opt}
                      role="radio"
                      aria-checked={active}
                      onClick={() => onPickSensitivity(opt)}
                      className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors ${
                        active
                          ? "bg-white text-zinc-900 border-white"
                          : "bg-white/[.02] text-white/75 border-white/10 hover:bg-white/[.05]"
                      }`}
                    >
                      {opt[0].toUpperCase() + opt.slice(1)}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-white/40 mt-2 leading-relaxed">
                {sensitivity === "off" && "Detection is off — shake won't open the report dialog."}
                {sensitivity === "normal" && "Default — three brisk shakes within ~1.2s."}
                {sensitivity === "strict" && "Harder to trigger — ideal if it fires accidentally."}
              </p>
            </div>
          </section>

          {/* ── My reports ── */}
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[10.5px] uppercase tracking-wider text-white/45">Your reports</p>
              {reports && reports.length > 0 && (
                <p className="text-[10.5px] text-white/40">{reports.length} total</p>
              )}
            </div>

            {error && (
              <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-3.5 py-3 flex items-center gap-3 mb-3">
                <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" strokeWidth={2.2} />
                <p className="text-[12px] text-red-100/90 flex-1">Couldn't load: {error}</p>
                <button
                  onClick={() => void fetchReports()}
                  className="text-[11px] font-semibold text-red-100 px-2.5 py-1 rounded-full bg-red-400/15 border border-red-400/30"
                >
                  Retry
                </button>
              </div>
            )}

            {loading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[68px] rounded-2xl bg-white/[.03] border border-white/5 animate-pulse" />
                ))}
              </div>
            )}

            {!loading && reports && reports.length === 0 && !error && (
              <div className="rounded-2xl border border-white/10 bg-white/[.02] px-4 py-8 text-center">
                <p className="text-[13px] text-white/70 font-medium">No reports yet</p>
                <p className="text-[11.5px] text-white/45 mt-1">
                  Shake your phone anywhere in the app to report an issue.
                </p>
                {!userId && (
                  <p className="text-[10.5px] text-white/40 mt-3">
                    Sign in to see reports tied to your account.
                  </p>
                )}
              </div>
            )}

            {!loading && reports && reports.length > 0 && (
              <ul className="space-y-2">
                {reports.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-2xl border border-white/10 bg-white/[.03] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-white/50 px-1.5 py-0.5 rounded bg-white/[.05] border border-white/10">
                            {r.category}
                          </span>
                          {r.route && (
                            <span className="text-[10px] text-white/40 truncate">
                              {r.route}
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-white mt-1.5 leading-snug line-clamp-2">
                          {r.message}
                        </p>
                        <p className="text-[10.5px] text-white/45 mt-1.5">
                          {new Date(r.created_at).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {r.resolved_at && (
                            <>
                              {" · resolved "}
                              {new Date(r.resolved_at).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                            </>
                          )}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="text-center">
            <Link
              to="/preview/home"
              className="text-[12px] text-white/55 underline-offset-4 hover:underline"
            >
              Back to app
            </Link>
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const resolved = status === "resolved";
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-semibold ${
        resolved
          ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-300"
          : "bg-amber-400/10 border-amber-400/30 text-amber-300"
      }`}
    >
      {resolved ? (
        <CheckCircle2 className="w-3 h-3" strokeWidth={2.4} />
      ) : (
        <Clock className="w-3 h-3" strokeWidth={2.4} />
      )}
      {resolved ? "Resolved" : "Open"}
    </span>
  );
}
