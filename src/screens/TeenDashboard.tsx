import { useState, useEffect, useCallback } from "react";
import {
  Bell, Shield, Wallet, BarChart3, Clock, Target, Award,
  ChevronRight, Sparkles, LogOut, Link2, Eye, ScanLine, History,
  RefreshCw, AlertCircle
} from "lucide-react";
import React from "react";
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

type SubScreen = "savings" | "screentime" | "spending" | "rewards" | "txhistory" | "scanpay" | "notifications" | "linking" | null;

export function TeenDashboard() {
  const { fullName, balance, userId } = useApp();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [notifications, setNotifications] = useState(0);
  const [liveBalance, setLiveBalance] = useState<number>(balance);
  const [activeScreen, setActiveScreen] = useState<SubScreen>(null);
  const [kycStatus, setKycStatus] = useState<string | null>(null);

  const firstName = fullName?.split(" ")[0] || "there";

  const loadData = useCallback(async () => {
    // Cached data first
    const cachedTxns = offlineCache.get<Transaction[]>("teen_txns");
    if (cachedTxns) setTxns(cachedTxns);
    const cachedBal = offlineCache.get<number>("teen_balance");
    if (cachedBal !== null && cachedBal !== undefined) setLiveBalance(cachedBal);

    try {
      const { data: profile } = await supabase.from("profiles").select("balance, kyc_status").single();
      if (profile) {
        const b = Number(profile.balance);
        setLiveBalance(b);
        offlineCache.set("teen_balance", b);
        setKycStatus((profile as Record<string, unknown>).kyc_status as string | null);
      }

      const { data: t } = await supabase
        .from("transactions")
        .select("id, merchant_name, amount, created_at, status")
        .order("created_at", { ascending: false })
        .limit(10);
      if (t) { setTxns(t as Transaction[]); offlineCache.set("teen_txns", t); }

      setLinkLoading(true);
      const { data: fl } = await supabase
        .from("family_links")
        .select("id, parent_user_id, status")
        .eq("status", "active")
        .limit(1);
      if (fl && fl.length > 0) setFamilyLink(fl[0] as FamilyLink);
      else setFamilyLink(null);
      setLinkLoading(false);

      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("read", false);
      setNotifications(count ?? 0);
    } catch (e) {
      console.error("[teen-dash] load error", e);
      setLinkLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime: transactions + notifications
  useEffect(() => {
    const txnChannel = supabase
      .channel("teen_txns_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, (payload) => {
        const newTx = payload.new as Transaction;
        setTxns((prev) => [newTx, ...prev].slice(0, 10));
        supabase.from("profiles").select("balance").single().then(({ data }) => {
          if (data) {
            const b = Number(data.balance);
            setLiveBalance(b);
            offlineCache.set("teen_balance", b);
          }
        });
      })
      .subscribe();

    const notifChannel = supabase
      .channel("teen_notifs_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => {
        setNotifications((prev) => prev + 1);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, () => {
        // Re-count unread on any update
        supabase.from("notifications").select("*", { count: "exact", head: true }).eq("read", false)
          .then(({ count }) => setNotifications(count ?? 0));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(txnChannel);
      supabase.removeChannel(notifChannel);
    };
  }, []);

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

  const isLinked = !!familyLink;

  const kycApproved = kycStatus === "approved";

  const handleKycGatedAction = (screen: SubScreen) => {
    if (!kycApproved) {
      haptics.tap();
      toast.error("Complete Aadhaar KYC to unlock this feature", {
        description: "Your identity must be verified before using Scan & Pay or viewing transactions.",
        duration: 4000,
      });
      return;
    }
    haptics.tap();
    setActiveScreen(screen);
  };

  // Sub-screen overlays
  if (activeScreen === "notifications") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <NotificationsPanelInline onClose={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }
  if (activeScreen === "linking") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <FamilyLinkingInline onBack={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }
  if (activeScreen === "scanpay") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <ScanPayInline onBack={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }
  if (activeScreen === "savings") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <SubScreenInline screen="savings" onBack={() => setActiveScreen(null)} />
      </div>
    );
  }
  if (activeScreen === "screentime") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <SubScreenInline screen="screentime" onBack={() => setActiveScreen(null)} />
      </div>
    );
  }
  if (activeScreen === "spending") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <SubScreenInline screen="spending" onBack={() => setActiveScreen(null)} />
      </div>
    );
  }
  if (activeScreen === "rewards") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <SubScreenInline screen="rewards" onBack={() => setActiveScreen(null)} />
      </div>
    );
  }
  if (activeScreen === "txhistory") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <TxHistoryInline onBack={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }

  const CONTROLS: { icon: React.ComponentType<{ className?: string }>; label: string; desc: string; color: string; screen: SubScreen }[] = [
    { icon: Target, label: "Savings Goals", desc: "Set & track your targets", color: "#6366f1", screen: "savings" },
    { icon: Clock, label: "Screen Time", desc: "View your daily usage", color: "#f59e0b", screen: "screentime" },
    { icon: BarChart3, label: "Spending Insights", desc: "Weekly breakdowns", color: "#10b981", screen: "spending" },
    { icon: Award, label: "Rewards & Cashback", desc: "Earn while you spend", color: "#ef4444", screen: "rewards" },
    { icon: Eye, label: "Transaction History", desc: "Full activity log", color: "#8b5cf6", screen: "txhistory" },
  ];

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
          <button onClick={() => { haptics.tap(); setActiveScreen("notifications"); }} className="td-icon-btn relative">
            <Bell className="w-5 h-5" />
            {notifications > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold">{notifications > 9 ? "9+" : notifications}</span>
            )}
          </button>
          <button onClick={handleLogout} className="td-icon-btn"><LogOut className="w-4.5 h-4.5" /></button>
        </div>
      </div>

      {/* Balance Overview Card */}
      <div className="mx-5 mt-2 td-family-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium tracking-wider uppercase td-family-label">Available Balance</p>
            <p className="text-2xl font-bold mt-1 td-family-count">{formatAmt(liveBalance)}</p>
          </div>
          <div className="td-family-icon">
            <Wallet className="w-7 h-7" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => handleKycGatedAction("scanpay")}
            className={`td-invite-btn flex-1 ${!kycApproved ? "td-btn-locked" : ""}`}
          >
            <ScanLine className="w-4 h-4" /> Scan & Pay
            {!kycApproved && <span className="td-lock-badge">KYC</span>}
          </button>
          <button
            onClick={() => handleKycGatedAction("txhistory")}
            className={`td-invite-btn flex-1 ${!kycApproved ? "td-btn-locked" : ""}`}
          >
            <History className="w-4 h-4" /> History
            {!kycApproved && <span className="td-lock-badge">KYC</span>}
          </button>
        </div>
      </div>

      {/* Parent Link Status */}
      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase td-label mb-3">Family Connection</p>
        {linkLoading ? (
          <div className="td-empty-state">
            <RefreshCw className="w-6 h-6 td-sub animate-spin" />
            <p className="text-sm td-sub mt-2">Checking link status…</p>
          </div>
        ) : familyLink ? (
          <div className="td-child-card">
            <div className="td-child-avatar">
              <Shield className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold td-heading">Parent Connected</p>
              <p className="text-[11px] td-sub">Your account is supervised</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="td-active-badge">Active</span>
              <ChevronRight className="w-4 h-4 td-chevron" />
            </div>
          </div>
        ) : (
          <div className="td-empty-state">
            <Shield className="w-10 h-10 td-sub" />
            <p className="text-sm td-heading mt-3 font-semibold">No parent linked yet</p>
            <p className="text-[12px] td-sub mt-1">Ask your parent to share their invite code</p>
            <button onClick={() => { haptics.tap(); setActiveScreen("linking"); }} className="td-cta-btn mt-4">
              <Link2 className="w-4 h-4" /> Link Parent Account
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mx-5 mt-5">
        <p className="text-[11px] font-medium tracking-widest uppercase td-label mb-3">Quick Actions</p>
        <div className="flex flex-col gap-2">
          {CONTROLS.map(({ icon: Icon, label, desc, color, screen }) => (
            <button key={label} onClick={() => { haptics.tap(); setActiveScreen(screen); }} className="td-control-row">
              <div className="td-control-icon" style={{ background: `${color}15`, color }}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium td-heading">{label}</p>
                <p className="text-[11px] td-sub">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 td-chevron" />
            </button>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mx-5 mt-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium tracking-widest uppercase td-label">Recent Activity</p>
          <button onClick={() => { haptics.tap(); setActiveScreen("txhistory"); }} className="text-[11px] td-accent-text font-medium">See All</button>
        </div>
        {txns.length === 0 ? (
          <div className="td-empty-state">
            <History className="w-8 h-8 td-sub" />
            <p className="text-sm td-sub mt-2">No transactions yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {txns.map((tx) => (
              <div key={tx.id} className="td-child-card">
                <div className="td-child-avatar" style={{ background: "oklch(0.2 0.005 250)" }}>
                  <Wallet className="w-4 h-4" style={{ color: "oklch(0.6 0.01 250)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold td-heading truncate">{tx.merchant_name}</p>
                  <p className="text-[11px] td-sub">{timeAgo(tx.created_at)}</p>
                </div>
                <p className="text-sm font-semibold td-amt-debit">-{formatAmt(tx.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .td-root { background: var(--background); }
        .td-label { color: oklch(0.82 0.06 85); }
        .td-heading { color: var(--foreground); }
        .td-sub { color: oklch(0.55 0.01 250); }
        .td-accent-text { color: oklch(0.82 0.06 85); }
        .td-chevron { color: oklch(0.35 0.01 250); }

        .td-icon-btn {
          width: 40px; height: 40px; border-radius: 14px;
          background: oklch(0.15 0.005 250);
          border: 1px solid oklch(0.22 0.005 250);
          display: flex; align-items: center; justify-content: center;
          color: oklch(0.7 0.01 250);
        }

        .td-family-card {
          padding: 20px; border-radius: 22px;
          background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
          border: 1px solid oklch(0.82 0.06 85 / 0.2);
          box-shadow: 0 8px 32px -8px oklch(0.82 0.06 85 / 0.08);
        }
        .td-family-label { color: oklch(0.65 0.03 85); }
        .td-family-count { color: oklch(0.92 0.04 85); }
        .td-family-icon {
          width: 52px; height: 52px; border-radius: 16px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          display: flex; align-items: center; justify-content: center;
        }
        .td-invite-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 11px; border-radius: 14px;
          background: oklch(0.82 0.06 85 / 0.12); color: oklch(0.82 0.06 85);
          font-size: 13px; font-weight: 600;
          border: 1px solid oklch(0.82 0.06 85 / 0.25); cursor: pointer;
        }

        .td-empty-state {
          display: flex; flex-direction: column; align-items: center;
          padding: 32px 24px; border-radius: 18px;
          background: oklch(0.12 0.005 250);
          border: 1.5px dashed oklch(0.25 0.005 250);
        }
        .td-cta-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 20px; border-radius: 12px;
          background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
          color: oklch(0.12 0.005 250);
          font-size: 13px; font-weight: 600; border: none; cursor: pointer;
        }

        .td-child-card {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.22 0.005 250);
        }
        .td-child-avatar {
          width: 42px; height: 42px; border-radius: 14px;
          background: linear-gradient(135deg, oklch(0.45 0.1 250), oklch(0.35 0.08 280));
          color: oklch(0.9 0.04 250);
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 16px;
        }
        .td-active-badge {
          font-size: 10px; font-weight: 700; padding: 3px 10px;
          border-radius: 999px; background: oklch(0.5 0.1 145 / 0.15);
          color: oklch(0.7 0.1 145); text-transform: uppercase; letter-spacing: 0.05em;
        }

        .td-control-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          background: oklch(0.13 0.005 250);
          border: 1px solid oklch(0.2 0.005 250);
          cursor: pointer; width: 100%;
        }
        .td-control-icon {
          width: 42px; height: 42px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .td-amt-debit { color: oklch(0.65 0.08 25); }

        @media (prefers-reduced-motion: reduce) {
          .td-family-card, .td-child-card, .td-control-row { transition: none; }
        }
      `}</style>
    </div>
  );
}

/* ----- Lazy Inline Wrappers ----- */

function FamilyLinkingInline({ onBack }: { onBack: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void }> | null>(null);
  useEffect(() => {
    import("@/screens/FamilyLinking").then((m) => setComp(() => m.FamilyLinking));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} />;
}

function NotificationsPanelInline({ onClose }: { onClose: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onClose: () => void }> | null>(null);
  useEffect(() => {
    import("@/components/NotificationsPanel").then((m) => setComp(() => m.NotificationsPanel));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onClose={onClose} />;
}

function ScanPayInline({ onBack }: { onBack: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void }> | null>(null);
  useEffect(() => {
    import("@/screens/ScanPay").then((m) => setComp(() => m.ScanPay));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} />;
}

function TxHistoryInline({ onBack }: { onBack: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void }> | null>(null);
  useEffect(() => {
    import("@/screens/Transactions").then((m) => setComp(() => m.Transactions));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} />;
}

function SubScreenInline({ screen, onBack }: { screen: "savings" | "screentime" | "spending" | "rewards"; onBack: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void }> | null>(null);
  useEffect(() => {
    const loaders: Record<string, () => Promise<{ default: React.ComponentType<{ onBack: () => void }> }>> = {
      savings: () => import("@/screens/TeenSavingsGoals").then(m => ({ default: m.TeenSavingsGoals })),
      screentime: () => import("@/screens/TeenScreenTime").then(m => ({ default: m.TeenScreenTime })),
      spending: () => import("@/screens/TeenSpendingInsights").then(m => ({ default: m.TeenSpendingInsights })),
      rewards: () => import("@/screens/TeenRewards").then(m => ({ default: m.TeenRewards })),
    };
    loaders[screen]().then((m) => setComp(() => m.default));
  }, [screen]);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} />;
}

function LoadingPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "oklch(0.55 0.01 250)" }}>Loading…</p>
    </div>
  );
}
