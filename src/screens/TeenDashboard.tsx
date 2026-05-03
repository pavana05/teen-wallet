import { useState, useEffect, useCallback, useRef, memo, Suspense } from "react";
import { createPortal } from "react-dom";
import {
  Bell, Shield, Wallet, BarChart3, Clock, Target, Award,
  ChevronRight, Sparkles, LogOut, Link2, Eye, ScanLine, History,
  RefreshCw, ArrowUpRight, Building2, Smartphone, CreditCard,
  Zap, MoreHorizontal, Home as HomeIcon, User, Send
} from "lucide-react";
import React from "react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { offlineCache } from "@/lib/offlineCache";
import { logout } from "@/lib/auth";
import { toast } from "sonner";
import { useAppImage } from "@/lib/useAppImage";
import { useGenderPersona } from "@/lib/genderPersona";
import heroScan from "@/assets/home-hero-scan.jpg";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const ScanPay = lazyWithRetry(() => import("@/screens/ScanPay").then(m => ({ default: m.ScanPay })));
const Transactions = lazyWithRetry(() => import("@/screens/Transactions").then(m => ({ default: m.Transactions })));
const NotificationsPanel = lazyWithRetry(() => import("@/components/NotificationsPanel").then(m => ({ default: m.NotificationsPanel })));

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

type SubScreen = "savings" | "screentime" | "spending" | "rewards" | "txhistory" | "scanpay" | "notifications" | "linking" | "linkstatus" | "haptics" | null;

/* ── Reusable tile components (same as Home) ── */

function QuickAction({ icon: Icon, label, onClick, locked, lockLabel }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick?: () => void;
  locked?: boolean;
  lockLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => { void haptics.tap(); onClick?.(); }}
      aria-label={label.replace(/\n/g, " ")}
      className={`flex flex-col items-center gap-2 group rounded-2xl focus:outline-none relative ${locked ? "opacity-50" : ""}`}
    >
      <div className="hp-tile" aria-hidden="true">
        <Icon className="w-6 h-6 text-white/90" strokeWidth={1.6} />
      </div>
      <span className="text-[11px] text-white/70 leading-tight text-center whitespace-pre-line">{label}</span>
      {locked && lockLabel && (
        <span className="absolute -top-1 -right-1 text-[7px] font-extrabold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 uppercase tracking-wider">{lockLabel}</span>
      )}
    </button>
  );
}

function RechargeTile({ icon: Icon, label, tint }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  tint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => { void haptics.tap(); }}
      aria-label={label}
      className="flex flex-col items-center gap-2 rounded-2xl focus:outline-none"
    >
      <div className={`hp-tile bg-gradient-to-br ${tint}`} aria-hidden="true">
        <Icon className="w-6 h-6 text-white" strokeWidth={1.7} />
      </div>
      <span className="text-[11px] text-white/70 leading-tight text-center">{label}</span>
    </button>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => { void haptics.select(); onClick?.(); }}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex-1 flex flex-col items-center py-2 rounded-full transition-colors focus:outline-none ${active ? "hp-nav-active text-white" : "text-white/55 hover:text-white/80"}`}
    >
      <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
      <span className={`text-[11px] mt-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}

export function TeenDashboard() {
  const { fullName, balance, userId } = useApp();
  const persona = useGenderPersona();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [familyLink, setFamilyLink] = useState<FamilyLink | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [liveBalance, setLiveBalance] = useState<number>(balance);
  const [view, setView] = useState<"home" | "scan" | "transactions">("home");
  const [activeScreen, setActiveScreen] = useState<SubScreen>(null);
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [scanLaunching, setScanLaunching] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const firstName = fullName?.split(" ")[0] || "there";
  const scanHero = useAppImage("home.scan_hero", heroScan, "Scan and pay");

  const loadData = useCallback(async () => {
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
      setUnreadCount(count ?? 0);
    } catch (e) {
      console.error("[teen-dash] load error", e);
      setLinkLoading(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll for family link
  useEffect(() => {
    if (familyLink) return;
    const poll = setInterval(async () => {
      if (!userId) return;
      const { data: fl } = await supabase
        .from("family_links")
        .select("id, parent_user_id, status")
        .eq("teen_user_id", userId)
        .eq("status", "active")
        .limit(1);
      if (fl && fl.length > 0) {
        setFamilyLink(fl[0] as FamilyLink);
        setLinkLoading(false);
        offlineCache.set("teen_family_linked", true);
        if (userId) {
          supabase.from("profiles").update({ family_link_status: "accepted" as any }).eq("id", userId);
        }
        haptics.press();
        toast.success("Parent linked! 🎉", { description: "All wallet features are now unlocked." });
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [familyLink, userId]);

  // Hydrate family_link_status
  useEffect(() => {
    const hydrate = async () => {
      const { data } = await supabase.from("profiles").select("family_link_status").single();
      if (data && (data as any).family_link_status === "accepted" && !familyLink) {
        const { data: fl } = await supabase
          .from("family_links")
          .select("id, parent_user_id, status")
          .eq("status", "active")
          .limit(1);
        if (fl && fl.length > 0) {
          setFamilyLink(fl[0] as FamilyLink);
          offlineCache.set("teen_family_linked", true);
        }
        setLinkLoading(false);
      }
    };
    hydrate();
  }, []);

  // Realtime
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
        setUnreadCount((prev) => prev + 1);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, () => {
        supabase.from("notifications").select("*", { count: "exact", head: true }).eq("read", false)
          .then(({ count }) => setUnreadCount(count ?? 0));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(txnChannel);
      supabase.removeChannel(notifChannel);
    };
  }, []);

  // Scroll collapse nav
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setNavCollapsed(el.scrollTop > 60);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    haptics.tap();
    await logout();
    useApp.getState().reset();
  };

  const kycApproved = kycStatus === "approved";
  const isLinked = !!familyLink;

  const handleGatedAction = (action: () => void) => {
    if (!kycApproved) {
      haptics.tap();
      toast.error("Complete Aadhaar KYC to unlock this feature", {
        description: "Your identity must be verified first.",
        duration: 4000,
      });
      return;
    }
    action();
  };

  const getLockLabel = () => {
    if (!kycApproved) return "KYC";
    return undefined;
  };

  const isGated = !kycApproved;

  // Pull to refresh
  const onTouchStart = (e: React.TouchEvent) => {
    if ((scrollerRef.current?.scrollTop ?? 0) <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80));
  };
  const onTouchEnd = () => {
    if (pullY > 60) { void haptics.swipe(); setRefreshing(true); loadData().then(() => setTimeout(() => setRefreshing(false), 400)); }
    setPullY(0);
    touchStartY.current = null;
  };

  const launchScan = useCallback(() => {
    handleGatedAction(() => {
      void haptics.bloom();
      setScanLaunching(true);
      window.setTimeout(() => {
        setView("scan");
        window.setTimeout(() => setScanLaunching(false), 50);
      }, 420);
    });
  }, [kycApproved]);

  // Sub-screen overlays
  if (view === "scan") return (
    <Suspense fallback={null}>
      <ScanPay onBack={() => { setView("home"); void loadData(); }} />
    </Suspense>
  );
  if (view === "transactions") return (
    <Suspense fallback={null}>
      <Transactions onBack={() => { setView("home"); void loadData(); }} />
    </Suspense>
  );
  if (activeScreen === "notifications" || showNotifs) {
    return (
      <Suspense fallback={null}>
        <NotificationsPanel onClose={() => { setActiveScreen(null); setShowNotifs(false); loadData(); }} />
      </Suspense>
    );
  }
  if (activeScreen === "linking") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <FamilyLinkingInline onBack={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }
  if (activeScreen === "linkstatus") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <TeenLinkStatusInline onBack={() => setActiveScreen(null)} onLinked={() => { setActiveScreen(null); loadData(); }} />
      </div>
    );
  }
  if (activeScreen === "savings" || activeScreen === "screentime" || activeScreen === "spending" || activeScreen === "rewards") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <SubScreenInline screen={activeScreen} onBack={() => setActiveScreen(null)} />
      </div>
    );
  }
  if (activeScreen === "haptics") {
    return (
      <div className="fixed inset-0 z-50" style={{ background: "var(--background)" }}>
        <HapticsSettingsInline onBack={() => setActiveScreen(null)} />
      </div>
    );
  }

    <div
      ref={scrollerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`hp-root ${persona.accentClass} flex-1 min-h-0 flex flex-col tw-slide-up pb-32 overflow-y-auto relative`}
      style={{ transform: pullY ? `translateY(${pullY}px)` : undefined, transition: pullY ? "none" : "transform 220ms ease" }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || refreshing) && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
          <RefreshCw className={`w-3.5 h-3.5 text-white ${refreshing ? "animate-spin" : ""}`} style={{ transform: !refreshing ? `rotate(${pullY * 4}deg)` : undefined }} aria-hidden="true" />
          <span className="text-[11px] text-white/80">{refreshing ? "Refreshing…" : pullY > 60 ? "Release to refresh" : "Pull to refresh"}</span>
        </div>
      )}

      {/* ===== HERO (orange grid bg + scan card) ===== */}
      <div className="hp-hero hp-shimmer-reveal relative">
        <div className="hp-hero-bg" />
        <div className="hp-hero-pattern" />
        <div className="hp-hero-spot" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-8">
          <button type="button" className="hp-greeting-tap text-left hp-greeting-enter">
            <p className="hp-greeting">
              <span className="hp-greeting-text">Hey, {firstName}</span>
              <span className="hp-greeting-emoji-stage">
                <span className="hp-greeting-emoji hp-greeting-emoji-in" role="img" aria-label="waving hand">
                  {persona.emoji}
                </span>
              </span>
            </p>
            <p className="hp-greeting-sub">{persona.subtitle}</p>
          </button>
          <button
            type="button"
            onClick={() => { void haptics.tap(); setShowNotifs(true); }}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className="hp-bell"
          >
            <Bell className="w-[18px] h-[18px] text-white/90" strokeWidth={1.6} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="hp-bell-badge" aria-hidden="true">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </button>
        </div>

        {/* Scan hero card */}
        <button
          type="button"
          onClick={() => handleGatedAction(() => setView("scan"))}
          className="hp-scan-card group"
          aria-label="Open scanner to scan and pay"
        >
          <img src={scanHero.url} alt={scanHero.alt} className="hp-scan-img" />
        </button>

        <div className="hp-hero-fade" aria-hidden="true" />
      </div>

      {/* ===== OFFERS CAROUSEL ===== */}
      <section aria-label="Offers" className="px-5 mt-6">
        {loading ? (
          <div className="flex gap-3 overflow-hidden pb-1" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="hp-skeleton snap-start shrink-0" style={{ width: "84%", minHeight: 140 }} />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto hp-scroll snap-x snap-mandatory pb-1 hp-fade-in" role="list" aria-label="Available offers">
            <div className="hp-offer hp-offer-1 snap-start shrink-0" role="listitem">
              <div className="relative z-10">
                <p className="hp-offer-eyebrow">P2P UPI · Limited</p>
                <p className="hp-offer-headline">20%<em>flat off</em></p>
                <p className="hp-offer-sub">On every peer transfer this month</p>
                <button type="button" onClick={() => void haptics.success()} className="hp-offer-cta" aria-label="Apply 20% flat off offer">
                  <span>Apply offer</span>
                  <ArrowUpRight className="w-3.5 h-3.5 hp-offer-cta-icon" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="hp-offer hp-offer-2 snap-start shrink-0" role="listitem">
              <div className="relative z-10">
                <p className="hp-offer-eyebrow">First recharge</p>
                <p className="hp-offer-headline">40%<em>cashback</em></p>
                <p className="hp-offer-sub">Credited instantly to your wallet</p>
                <button type="button" onClick={() => void haptics.success()} className="hp-offer-cta" aria-label="Claim 40% cashback offer">
                  <span>Claim now</span>
                  <Sparkles className="w-3.5 h-3.5 hp-offer-cta-icon" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===== PARENTAL CONTROL (optional) ===== */}
      {!isLinked && !linkLoading && (
        <div className="px-5 mt-6">
          <div className="td-link-banner">
            <Shield className="w-8 h-8" style={{ color: "oklch(0.82 0.06 85)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">Parental Controls</p>
              <p className="text-[11px] text-white/50 mt-0.5">Optionally link a parent for spending oversight</p>
            </div>
            <button onClick={() => { haptics.tap(); setActiveScreen("linking"); }} className="td-link-cta">
              <Link2 className="w-3.5 h-3.5" /> Link
            </button>
          </div>
        </div>
      )}
      {isLinked && (
        <div className="px-5 mt-6">
          <div className="td-link-banner">
            <Shield className="w-8 h-8" style={{ color: "oklch(0.65 0.12 145)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">Parent Linked ✓</p>
              <p className="text-[11px] text-white/50 mt-0.5">Parental controls are active</p>
            </div>
          </div>
        </div>
      )}

      {/* ===== EVERYTHING UPI ===== */}
      <div className="px-5 mt-10">
        <div className="hp-section-head">
          <div>
            <span className="hp-section-eyebrow">Quick actions</span>
            <h3 className="hp-section-title">Everything UPI</h3>
          </div>
          <button className="hp-section-link" onClick={() => handleGatedAction(() => setView("transactions"))}>View all</button>
        </div>

        {/* Send money CTA */}
        <button
          type="button"
          onClick={() => handleGatedAction(() => setView("scan"))}
          aria-label="Send money instantly"
          className={`hp-send-cta group ${isGated ? "opacity-50" : ""}`}
        >
          <span className="hp-send-cta-glow" aria-hidden="true" />
          <span className="hp-send-cta-icon" aria-hidden="true">
            <Send className="w-5 h-5 text-black" strokeWidth={2.4} />
          </span>
          <span className="flex-1 text-left min-w-0">
            <span className="block text-[14px] font-semibold text-white leading-tight">Send money instantly</span>
            <span className="block text-[11px] text-white/65 mt-0.5 truncate">Phone number or UPI ID · End-to-end secure</span>
          </span>
          <ArrowUpRight className="w-4 h-4 text-white/70 group-hover:text-white shrink-0" strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="grid grid-cols-4 gap-3 mt-4">
          <QuickAction icon={ArrowUpRight} label={"Pay\nfriends"} locked={isGated} lockLabel={getLockLabel()} onClick={() => handleGatedAction(() => setView("scan"))} />
          <QuickAction icon={Building2} label={"To bank &\nself a/c"} locked={isGated} lockLabel={getLockLabel()} onClick={() => handleGatedAction(() => setView("scan"))} />
          <QuickAction icon={Wallet} label={"Check\nbalance"} onClick={() => toast.info(`Balance: ₹${liveBalance.toLocaleString("en-IN")}`)} />
          <QuickAction icon={History} label={"Transaction\nhistory"} locked={isGated} lockLabel={getLockLabel()} onClick={() => handleGatedAction(() => setView("transactions"))} />
        </div>
      </div>

      <div className="hp-divider mt-14" aria-hidden="true" />

      {/* ===== RECHARGES AND BILLS ===== */}
      <div className="px-5 mt-10">
        <div className="hp-section-head">
          <div>
            <span className="hp-section-eyebrow">Pay bills</span>
            <h3 className="hp-section-title">Recharges & utilities</h3>
          </div>
          <button className="hp-section-link">View all</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <RechargeTile icon={Smartphone} label="Recharge" tint="from-indigo-500/40 to-fuchsia-500/30" />
          <RechargeTile icon={CreditCard} label="Credit card bill" tint="from-emerald-500/40 to-teal-500/20" />
          <RechargeTile icon={Zap} label="Utilities" tint="from-violet-500/40 to-purple-600/30" />
          <RechargeTile icon={MoreHorizontal} label="More" tint="from-white/10 to-white/5" />
        </div>
      </div>

      <div className="h-6" />

      {/* ===== FLOATING BOTTOM NAV ===== */}
      {mounted && typeof document !== "undefined" && createPortal(
        <>
          <nav
            aria-label="Primary"
            data-mode="full"
            data-collapsed={navCollapsed ? "true" : "false"}
            className="hp-nav-shell hp-nav-fixed z-[60]"
          >
            <div className="flex items-center gap-3">
              <div className="hp-nav hp-nav-pill flex-1" role="tablist" aria-label="Sections">
                <NavItem icon={HomeIcon} label="Home" active />
                <span className="hp-nav-tab" data-hidden={navCollapsed ? "true" : "false"}>
                  <NavItem icon={History} label="Transactions" onClick={() => handleGatedAction(() => setView("transactions"))} />
                </span>
                <span className="hp-nav-tab" data-hidden="false">
                  <NavItem icon={User} label="Profile" onClick={handleLogout} />
                </span>
              </div>
              <button
                type="button"
                onClick={launchScan}
                className="hp-scan-fab"
                aria-label="Scan to pay"
                data-launching={scanLaunching ? "true" : "false"}
              >
                <ScanLine className="w-6 h-6 text-black" strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>
          </nav>
          {scanLaunching && (
            <div className="hp-scan-launch" aria-hidden="true">
              <span className="hp-scan-launch-bubble" />
            </div>
          )}
        </>,
        document.body,
      )}

      <style>{teenExtraStyles}</style>
    </div>
  );
}

const teenExtraStyles = `
  .td-link-banner {
    display: flex; align-items: center; gap: 14px;
    padding: 16px 18px; border-radius: 18px;
    background: linear-gradient(135deg, oklch(0.16 0.015 85), oklch(0.12 0.005 250));
    border: 1px solid oklch(0.82 0.06 85 / 0.2);
  }
  .td-link-cta {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 12px;
    background: oklch(0.82 0.06 85 / 0.15);
    color: oklch(0.82 0.06 85);
    font-size: 12px; font-weight: 700;
    border: 1px solid oklch(0.82 0.06 85 / 0.3);
    cursor: pointer; white-space: nowrap;
  }
  .td-link-cta:active { transform: scale(0.96); }
`;

/* ----- Lazy Inline Wrappers ----- */

function FamilyLinkingInline({ onBack }: { onBack: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void }> | null>(null);
  useEffect(() => {
    import("@/screens/FamilyLinking").then((m) => setComp(() => m.FamilyLinking));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} />;
}

function TeenLinkStatusInline({ onBack, onLinked }: { onBack: () => void; onLinked: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onBack: () => void; onLinked: () => void }> | null>(null);
  useEffect(() => {
    import("@/screens/TeenLinkStatus").then((m) => setComp(() => m.TeenLinkStatus));
  }, []);
  if (!Comp) return <LoadingPlaceholder />;
  return <Comp onBack={onBack} onLinked={onLinked} />;
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
