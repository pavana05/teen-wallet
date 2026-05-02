import { useState } from "react";
import { GraduationCap, ShieldCheck, ChevronRight, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";

interface Props {
  onDone: (type: "teen" | "parent") => void;
}

export function AccountTypeSelection({ onDone }: Props) {
  const [selected, setSelected] = useState<"teen" | "parent" | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (type: "teen" | "parent") => {
    haptics.light();
    setSelected(type);
  };

  const handleContinue = async () => {
    if (!selected || saving) return;
    haptics.medium();
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({ account_type: selected } as never).eq("id", user.id);
      }
      onDone(selected);
    } catch (err) {
      console.error("[account-type] save failed", err);
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col ats-root">
      {/* Header */}
      <div className="px-6 pt-12 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 ats-accent" />
          <span className="text-xs font-medium tracking-widest uppercase ats-label">Choose Your Account</span>
        </div>
        <h1 className="text-[26px] font-bold leading-tight ats-heading">
          How will you use<br />Teen Wallet?
        </h1>
        <p className="text-sm mt-2 ats-sub">
          Pick the account type that fits you best. You can always adjust later.
        </p>
      </div>

      {/* Cards */}
      <div className="flex-1 flex flex-col gap-4 px-6 pt-4">
        {/* Teen Card */}
        <button
          type="button"
          onClick={() => handleSelect("teen")}
          className={`ats-card group ${selected === "teen" ? "ats-card--active" : ""}`}
        >
          <div className="ats-card-icon ats-card-icon--teen">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold ats-card-title">Teen Account</span>
              {selected === "teen" && (
                <span className="ats-badge">Selected</span>
              )}
            </div>
            <p className="text-[13px] mt-1 ats-card-desc">
              For students &amp; kids. Manage your money, earn rewards, track spending and build great habits.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {["UPI Payments", "Rewards", "Goals", "Safe Spending"].map(tag => (
                <span key={tag} className="ats-tag">{tag}</span>
              ))}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 ats-chevron shrink-0" />
        </button>

        {/* Parent Card */}
        <button
          type="button"
          onClick={() => handleSelect("parent")}
          className={`ats-card group ${selected === "parent" ? "ats-card--active" : ""}`}
        >
          <div className="ats-card-icon ats-card-icon--parent">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold ats-card-title">Parent Account</span>
              {selected === "parent" && (
                <span className="ats-badge">Selected</span>
              )}
            </div>
            <p className="text-[13px] mt-1 ats-card-desc">
              For guardians. Link your child's account, set spending limits, monitor activity and keep them safe.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {["Child Controls", "Reports", "Limits", "Safety Alerts"].map(tag => (
                <span key={tag} className="ats-tag">{tag}</span>
              ))}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 ats-chevron shrink-0" />
        </button>
      </div>

      {/* Continue Button */}
      <div className="px-6 pb-8 pt-4">
        <button
          type="button"
          disabled={!selected || saving}
          onClick={handleContinue}
          className="ats-btn"
        >
          {saving ? "Setting up…" : "Continue"}
        </button>
        <p className="text-center text-[11px] mt-3 ats-fine">
          Your account type helps us personalise your experience
        </p>
      </div>

      <style>{`
        .ats-root {
          background: var(--background);
        }
        .ats-accent { color: oklch(0.82 0.06 85); }
        .ats-label { color: oklch(0.82 0.06 85); }
        .ats-heading { color: var(--foreground); }
        .ats-sub { color: oklch(0.65 0.01 250); }

        .ats-card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 18px 16px;
          border-radius: 20px;
          border: 1.5px solid oklch(0.25 0.005 250);
          background: oklch(0.14 0.005 250);
          transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .ats-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 20px;
          opacity: 0;
          transition: opacity 0.3s;
          background: linear-gradient(135deg, oklch(0.82 0.06 85 / 0.08), transparent 60%);
        }
        .ats-card--active {
          border-color: oklch(0.82 0.06 85 / 0.5);
          background: oklch(0.16 0.01 85 / 0.95);
          box-shadow: 0 0 24px -4px oklch(0.82 0.06 85 / 0.15),
                      inset 0 1px 0 oklch(0.82 0.06 85 / 0.1);
        }
        .ats-card--active::before { opacity: 1; }

        .ats-card-icon {
          width: 52px; height: 52px;
          border-radius: 16px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          position: relative;
        }
        .ats-card-icon--teen {
          background: linear-gradient(135deg, oklch(0.45 0.12 250), oklch(0.35 0.08 280));
          color: oklch(0.9 0.04 250);
        }
        .ats-card-icon--parent {
          background: linear-gradient(135deg, oklch(0.5 0.08 85), oklch(0.4 0.06 60));
          color: oklch(0.95 0.03 85);
        }

        .ats-card-title { color: var(--foreground); }
        .ats-card-desc { color: oklch(0.6 0.01 250); line-height: 1.5; }
        .ats-chevron { color: oklch(0.4 0.01 250); transition: transform 0.2s; }
        .ats-card--active .ats-chevron { color: oklch(0.82 0.06 85); transform: translateX(2px); }

        .ats-badge {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          padding: 2px 8px;
          border-radius: 999px;
          background: oklch(0.82 0.06 85 / 0.15);
          color: oklch(0.82 0.06 85);
          animation: ats-badge-in 0.3s cubic-bezier(0.22,1,0.36,1);
        }
        @keyframes ats-badge-in {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }

        .ats-tag {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 999px;
          background: oklch(0.2 0.005 250);
          color: oklch(0.65 0.01 250);
          font-weight: 500;
        }
        .ats-card--active .ats-tag {
          background: oklch(0.82 0.06 85 / 0.1);
          color: oklch(0.82 0.06 85);
        }

        .ats-btn {
          width: 100%;
          padding: 16px;
          border-radius: 16px;
          font-size: 16px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
          color: oklch(0.12 0.005 250);
          transition: all 0.2s;
          box-shadow: 0 4px 16px -4px oklch(0.75 0.08 85 / 0.3);
        }
        .ats-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }
        .ats-btn:not(:disabled):active {
          transform: scale(0.98);
        }

        .ats-fine { color: oklch(0.45 0.01 250); }

        @media (prefers-reduced-motion: reduce) {
          .ats-card, .ats-card::before, .ats-badge, .ats-chevron, .ats-btn {
            transition: none;
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
