import { Smartphone, ShieldCheck, Receipt, ChevronRight } from "lucide-react";

interface Props {
  onUpdatePhone: () => void;
  onManageKyc: () => void;
  onViewTransactions: () => void;
}

export function QuickActions({ onUpdatePhone, onManageKyc, onViewTransactions }: Props) {
  const items = [
    { key: "phone", label: "Update phone", desc: "Change your registered number", icon: Smartphone, onClick: onUpdatePhone, tone: "violet" as const },
    { key: "kyc", label: "Manage KYC", desc: "View status, retry verification", icon: ShieldCheck, onClick: onManageKyc, tone: "emerald" as const },
    { key: "txn", label: "Transactions", desc: "Full payment history", icon: Receipt, onClick: onViewTransactions, tone: "amber" as const },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={it.onClick}
          className={`pp-quick-action pp-quick-${it.tone}`}
        >
          <div className="pp-quick-icon"><it.icon className="w-4.5 h-4.5" strokeWidth={2} /></div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[13px] text-white font-semibold truncate">{it.label}</p>
            <p className="text-[11px] text-white/55 truncate">{it.desc}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
        </button>
      ))}
    </div>
  );
}
