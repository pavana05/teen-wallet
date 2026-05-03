import { ArrowLeft, Award, Star, Gift, Zap, Crown } from "lucide-react";
import { haptics } from "@/lib/haptics";

interface Props { onBack: () => void }

const REWARDS = [
  { id: "1", title: "5% Cashback on Food", desc: "Valid on all food payments", icon: "🍔", earned: true },
  { id: "2", title: "Free Movie Ticket", desc: "Spend ₹2000 this month", icon: "🎬", earned: false, progress: 65 },
  { id: "3", title: "₹50 Bonus", desc: "Complete 10 transactions", icon: "💰", earned: false, progress: 80 },
  { id: "4", title: "Premium Badge", desc: "Link parent account", icon: "👑", earned: true },
];

export function TeenRewards({ onBack }: Props) {
  const earned = REWARDS.filter(r => r.earned).length;

  return (
    <div className="flex-1 flex flex-col tr-root overflow-y-auto">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="tr-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold tr-heading">Rewards & Cashback</h1>
      </div>

      <div className="mx-5 mt-2 tr-overview-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-wider uppercase tr-label">Rewards Earned</p>
            <p className="text-2xl font-bold mt-1 tr-amount">{earned}/{REWARDS.length}</p>
          </div>
          <div className="tr-icon-box">
            <Award className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="mx-5 mt-5 mb-6">
        <p className="text-[11px] font-medium tracking-widest uppercase tr-label mb-3">All Rewards</p>
        <div className="flex flex-col gap-3">
          {REWARDS.map((r) => (
            <div key={r.id} className="tr-reward-card">
              <span className="text-2xl">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold tr-heading">{r.title}</p>
                <p className="text-[11px] tr-sub">{r.desc}</p>
                {!r.earned && r.progress !== undefined && (
                  <div className="tr-progress-track mt-2">
                    <div className="tr-progress-fill" style={{ width: `${r.progress}%` }} />
                  </div>
                )}
              </div>
              {r.earned ? (
                <span className="tr-earned-badge">Earned</span>
              ) : (
                <span className="text-[11px] font-medium tr-sub">{r.progress}%</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .tr-root { background: var(--background); }
        .tr-heading { color: var(--foreground); }
        .tr-sub { color: oklch(0.55 0.01 250); }
        .tr-label { color: oklch(0.82 0.06 85); }
        .tr-amount { color: oklch(0.92 0.04 85); }
        .tr-back-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250); border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center; color: oklch(0.7 0.01 250); cursor: pointer;
        }
        .tr-overview-card {
          padding: 20px; border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
        }
        .tr-icon-box {
          width: 48px; height: 48px; border-radius: 14px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          display: flex; align-items: center; justify-content: center;
        }
        .tr-reward-card {
          display: flex; align-items: center; gap: 12px;
          padding: 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250); border: 1px solid oklch(0.22 0.005 250);
        }
        .tr-earned-badge {
          font-size: 10px; font-weight: 700; padding: 3px 10px;
          border-radius: 999px; background: oklch(0.5 0.1 145 / 0.15);
          color: oklch(0.7 0.1 145); text-transform: uppercase;
        }
        .tr-progress-track { height: 4px; border-radius: 2px; background: oklch(0.2 0.005 250); }
        .tr-progress-fill {
          height: 100%; border-radius: 2px;
          background: linear-gradient(90deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
        }
      `}</style>
    </div>
  );
}
