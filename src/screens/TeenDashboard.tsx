import { useState, useEffect, useCallback } from "react";
import {
  Bell, ScanLine, Wallet, History, Target, Clock, Award, Shield,
  ChevronRight, Sparkles, User, LogOut, Link2
} from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { offlineCache } from "@/lib/offlineCache";
import { logout } from "@/lib/auth";
import { toast } from "sonner";

interface Transaction {
  id: string;
  merchant_name: string;
  amount: number;
  created_at: string;
  status: string;
}

interface FamilyLink {
  id: string;
  parent_user_id: string;
  status: string;
}

export function TeenDashboard() {
  const { fullName, balance, userId } = useApp();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(null);
  const [showLinking, setShowLinking] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [notifications, setNotifications] = useState(0);
  const [activePanel, setActivePanel] = useState<"scan" | "history" | "profile" | null>(null);

  const firstName = fullName?.split(" ")[0] || "there";

  const loadData = useCallback(async () => {
    const cached = offlineCache.get<Transaction[]>("teen_txns");
    if (cached) setTxns(cached);

    const { data: t } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    if (t) { setTxns(t as Transaction[]); offlineCache.set("teen_txns", t); }

    const { data: fl } = await supabase
      .from("family_links")
      .select("*")
      .eq("status", "active")
      .limit(1);
    if (fl && fl.length > 0) setFamilyLink(fl[0] as FamilyLink);

    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("read", false);
    if (count) setNotifications(count);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAcceptInvite = async () => {
    if (!inviteCode.trim() || linkBusy) return;
    haptics.tap();
    setLinkBusy(true);
    setLinkError("");
    try {
      const { data, error } = await supabase.rpc("accept_family_invite", { _code: inviteCode.trim() });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row && !row.ok) { setLinkError(row.message); setLinkBusy(false); return; }
      toast.success("Parent linked successfully!");
      setShowLinking(false);
      setInviteCode("");
      loadData();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Failed to link");
    }
    setLinkBusy(false);
  };

  const handleLogout = async () => {
    haptics.tap();
    await logout();
    useApp.getState().reset();
  };

  const formatAmt = (n: number) =>
    "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="flex-1 flex flex-col td-root overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <div>
          <p className="text-[11px] font-medium tracking-widest uppercase td-label">
            <Sparkles className="w-3.5 h-3.5 inline mr-1" />Teen Wallet
          </p>
          <h1 className="text-xl font-bold td-heading mt-0.5">Hey, {firstName}! 👋</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { haptics.tap(); }} className="td-icon-btn relative">
            <Bell className="w-5 h-5" />
            {notifications > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold">{notifications > 9 ? "9+" : notifications}</span>
            )}
          </button>
          <button onClick={handleLogout} className="td-icon-btn"><LogOut className="w-4.5 h-4.5" /></button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="mx-5 mt-2 td-balance-card">
        <p className="text-[11px] font-medium tracking-wider uppercase td-balance-label">Available Balance</p>
        <p className="text-3xl font-bold mt-1 td-balance-amt">{formatAmt(balance)}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={() => { haptics.tap(); setActivePanel("scan"); }} className="td-action-chip">
            <ScanLine className="w-4 h-4" /> Scan & Pay
          </button>
          <button onClick={() => { haptics.tap(); setActivePanel("history"); }} className="td-action-chip">
            <History className="w-4 h-4" /> History
          </button>
        </div>
      </div>

      {/* Family Status */}
      <div className="mx-5 mt-4">
        {familyLink ? (
          <div className="td-status-card td-status-linked">
            <Shield className="w-5 h-5 td-accent" />
            <div className="flex-1">
              <p className="text-sm font-semibold td-heading">Parent Connected</p>
              <p className="text-[11px] td-sub">Your account is supervised</p>
            </div>
            <span className="td-status-badge">Active</span>
          </div>
        ) : (
          <button onClick={() => { haptics.tap(); setShowLinking(true); }} className="td-status-card td-status-unlinked w-full text-left">
            <Link2 className="w-5 h-5 td-accent" />
            <div className="flex-1">
              <p className="text-sm font-semibold td-heading">Link with Parent</p>
              <p className="text-[11px] td-sub">Enter your parent's invite code</p>
            </div>
            <ChevronRight className="w-4 h-4 td-chevron" />
          </button>
        )}
      </div>

      {/* Quick Actions Grid */}
      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase td-label mb-3">Quick Actions</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Target, label: "Goals", color: "#6366f1" },
            { icon: Clock, label: "Timer", color: "#f59e0b" },
            { icon: Award, label: "Rewards", color: "#10b981" },
            { icon: Wallet, label: "Savings", color: "#8b5cf6" },
          ].map(({ icon: Icon, label, color }) => (
            <button key={label} onClick={() => haptics.tap()} className="td-quick-action">
              <div className="td-qa-icon" style={{ background: `${color}20`, color }}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[11px] mt-1.5 td-qa-label">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="mx-5 mt-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium tracking-widest uppercase td-label">Recent Activity</p>
          <button onClick={() => { haptics.tap(); setActivePanel("history"); }} className="text-[11px] td-accent font-medium">See All</button>
        </div>
        {txns.length === 0 ? (
          <div className="td-empty-state">
            <History className="w-8 h-8 td-sub" />
            <p className="text-sm td-sub mt-2">No transactions yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {txns.map((tx) => (
              <div key={tx.id} className="td-txn-row">
                <div className="td-txn-icon"><Wallet className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium td-heading truncate">{tx.merchant_name}</p>
                  <p className="text-[11px] td-sub">{timeAgo(tx.created_at)}</p>
                </div>
                <p className="text-sm font-semibold td-amt-debit">-{formatAmt(tx.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Code Modal */}
      {showLinking && (
        <div className="td-overlay" onClick={() => setShowLinking(false)}>
          <div className="td-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold td-heading">Link with Parent</h3>
            <p className="text-sm td-sub mt-1">Enter the invite code your parent shared with you.</p>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Enter 8-digit code"
              maxLength={8}
              className="td-input mt-4"
              autoFocus
            />
            {linkError && <p className="text-xs text-red-400 mt-2">{linkError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowLinking(false)} className="td-btn-secondary flex-1">Cancel</button>
              <button onClick={handleAcceptInvite} disabled={inviteCode.length < 6 || linkBusy} className="td-btn-primary flex-1">
                {linkBusy ? "Linking…" : "Link"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .td-root { background: var(--background); }
        .td-label { color: oklch(0.82 0.06 85); }
        .td-heading { color: var(--foreground); }
        .td-sub { color: oklch(0.55 0.01 250); }
        .td-accent { color: oklch(0.82 0.06 85); }
        .td-chevron { color: oklch(0.4 0.01 250); }

        .td-icon-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250);
          border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center;
          color: oklch(0.7 0.01 250);
        }

        .td-balance-card {
          padding: 20px;
          border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.18 0.02 85 / 0.8), oklch(0.14 0.01 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
          box-shadow: 0 8px 32px -8px oklch(0.82 0.06 85 / 0.1);
        }
        .td-balance-label { color: oklch(0.65 0.03 85); }
        .td-balance-amt { color: oklch(0.92 0.04 85); }

        .td-action-chip {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 12px;
          background: oklch(0.82 0.06 85 / 0.12);
          color: oklch(0.82 0.06 85);
          font-size: 13px; font-weight: 600;
          border: none; cursor: pointer;
        }

        .td-status-card {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          border: 1px solid oklch(0.22 0.005 250);
          background: oklch(0.13 0.005 250);
        }
        .td-status-linked { border-color: oklch(0.5 0.1 145 / 0.3); }
        .td-status-unlinked { cursor: pointer; }
        .td-status-badge {
          font-size: 10px; font-weight: 700; padding: 3px 10px;
          border-radius: 999px; background: oklch(0.5 0.1 145 / 0.15);
          color: oklch(0.7 0.1 145); text-transform: uppercase; letter-spacing: 0.05em;
        }

        .td-quick-action {
          display: flex; flex-direction: column; align-items: center;
          padding: 12px 4px; border-radius: 16px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.2 0.005 250);
          cursor: pointer;
        }
        .td-qa-icon {
          width: 44px; height: 44px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
        }
        .td-qa-label { color: oklch(0.65 0.01 250); font-weight: 500; }

        .td-txn-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 14px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.2 0.005 250);
        }
        .td-txn-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: oklch(0.2 0.005 250);
          display: flex; align-items: center; justify-content: center;
          color: oklch(0.6 0.01 250);
        }
        .td-amt-debit { color: oklch(0.65 0.08 25); }

        .td-empty-state {
          display: flex; flex-direction: column; align-items: center;
          padding: 28px; border-radius: 16px;
          background: oklch(0.12 0.005 250);
          border: 1px dashed oklch(0.22 0.005 250);
        }

        .td-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: oklch(0.05 0 0 / 0.8);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .td-modal {
          width: 100%; max-width: 360px;
          padding: 24px; border-radius: 20px;
          background: oklch(0.14 0.005 250);
          border: 1px solid oklch(0.25 0.005 250);
        }
        .td-input {
          width: 100%; padding: 14px 16px; border-radius: 14px;
          background: oklch(0.1 0.005 250);
          border: 1.5px solid oklch(0.25 0.005 250);
          color: var(--foreground); font-size: 16px;
          text-align: center; letter-spacing: 0.2em; font-weight: 700;
        }
        .td-input::placeholder { color: oklch(0.4 0.01 250); letter-spacing: 0.1em; font-weight: 400; }
        .td-input:focus { outline: none; border-color: oklch(0.82 0.06 85 / 0.5); }
        .td-btn-primary {
          padding: 12px; border-radius: 14px; font-weight: 600; font-size: 14px;
          background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
          color: oklch(0.12 0.005 250); border: none; cursor: pointer;
        }
        .td-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .td-btn-secondary {
          padding: 12px; border-radius: 14px; font-weight: 600; font-size: 14px;
          background: oklch(0.2 0.005 250);
          color: oklch(0.7 0.01 250); border: none; cursor: pointer;
        }

        @media (prefers-reduced-motion: reduce) {
          .td-balance-card, .td-status-card, .td-quick-action, .td-txn-row { transition: none; }
        }
      `}</style>
    </div>
  );
}
