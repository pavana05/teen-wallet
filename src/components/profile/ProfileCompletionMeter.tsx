import { useEffect, useMemo } from "react";
import { CheckCircle2, Circle, ChevronRight, Sparkles } from "lucide-react";

export interface ProfileForCompletion {
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  kyc_status: "not_started" | "pending" | "approved" | "rejected";
}

interface Item {
  key: string;
  label: string;
  done: boolean;
  hint?: string;
}

const CACHE_KEY = "tw-profile-completion-v1";

function isFilled(v: string | null | undefined): boolean {
  return !!(v && String(v).trim().length > 0);
}

export function computeCompletion(p: ProfileForCompletion | null) {
  const items: Item[] = [
    { key: "phone", label: "Phone number", done: isFilled(p?.phone ?? null) },
    { key: "email", label: "Email address", done: isFilled(p?.email ?? null) },
    { key: "dob", label: "Date of birth", done: isFilled(p?.dob ?? null) },
    { key: "gender", label: "Gender", done: isFilled(p?.gender ?? null) },
    {
      key: "kyc",
      label: "KYC verification",
      done: p?.kyc_status === "approved",
      hint:
        p?.kyc_status === "pending" ? "In review" :
        p?.kyc_status === "rejected" ? "Rejected — re-submit" :
        p?.kyc_status === "approved" ? "Verified" :
        "Not started",
    },
  ];
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  return { items, done, total: items.length, pct };
}

interface Props {
  profile: ProfileForCompletion | null;
  loading: boolean;
  onCompleteClick?: (key: string) => void;
}

/**
 * Profile completion meter — shows a percentage ring + checklist.
 * Source of truth = Supabase `profiles` table. We additionally cache the last
 * computed percentage in localStorage so the meter renders instantly on the
 * next app open before the network call resolves (no flicker from 0% → real %).
 */
export function ProfileCompletionMeter({ profile, loading, onCompleteClick }: Props) {
  const computed = useMemo(() => computeCompletion(profile), [profile]);

  // Persist the latest computed value so we can hydrate instantly next time.
  useEffect(() => {
    if (!profile) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ pct: computed.pct, done: computed.done, total: computed.total, ts: Date.now() }));
    } catch { /* quota / privacy */ }
  }, [profile, computed.pct, computed.done, computed.total]);

  // Hydrate from cache while loading, so the user sees a meaningful % immediately.
  const display = useMemo(() => {
    if (profile) return computed;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { pct: number; done: number; total: number };
        return { ...computed, pct: parsed.pct, done: parsed.done, total: parsed.total };
      }
    } catch { /* ignore */ }
    return computed;
  }, [profile, computed]);

  const ringSize = 64;
  const stroke = 6;
  const radius = (ringSize - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (display.pct / 100) * circ;
  const complete = display.pct === 100;

  return (
    <section
      aria-label="Profile completion"
      className="pp-card overflow-hidden"
    >
      <div className="px-4 py-4 flex items-center gap-4">
        {/* Ring */}
        <div className="relative shrink-0" style={{ width: ringSize, height: ringSize }}>
          <svg width={ringSize} height={ringSize} className="-rotate-90" aria-hidden="true">
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke}
            />
            <circle
              cx={ringSize / 2} cy={ringSize / 2} r={radius}
              fill="none"
              stroke={complete ? "rgb(110,231,183)" : "var(--primary, #c8f135)"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.2,0.8,0.2,1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[14px] font-bold num-mono text-white leading-none">{display.pct}%</span>
            <span className="text-[8.5px] uppercase tracking-wider text-white/50 mt-0.5">{display.done}/{display.total}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[13.5px] font-semibold text-white">Profile completion</p>
            {complete && <Sparkles className="w-3 h-3 text-emerald-300" aria-hidden />}
          </div>
          <p className="text-[11.5px] text-white/60 leading-snug mt-0.5">
            {complete
              ? "All set. Your account is fully verified."
              : loading && !profile
                ? "Loading your profile…"
                : `Finish ${display.total - display.done} more step${display.total - display.done === 1 ? "" : "s"} to unlock everything.`}
          </p>
        </div>
      </div>

      {/* Checklist */}
      <ul className="border-t border-white/5 divide-y divide-white/5" role="list">
        {display.items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              disabled={item.done || !onCompleteClick}
              onClick={() => onCompleteClick?.(item.key)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[.02] transition-colors disabled:cursor-default"
              aria-label={`${item.label} — ${item.done ? "done" : "incomplete"}`}
            >
              {item.done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" strokeWidth={2.2} aria-hidden />
                : <Circle className="w-4 h-4 text-white/30 shrink-0" strokeWidth={2} aria-hidden />}
              <span className={`flex-1 text-[12.5px] ${item.done ? "text-white/55 line-through" : "text-white"}`}>
                {item.label}
              </span>
              {item.hint && (
                <span className={`text-[10.5px] ${item.done ? "text-emerald-300/80" : "text-white/50"}`}>{item.hint}</span>
              )}
              {!item.done && onCompleteClick && (
                <ChevronRight className="w-3.5 h-3.5 text-white/30" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
