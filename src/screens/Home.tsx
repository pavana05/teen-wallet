import { Bell, Home as HomeIcon, ScanLine, ShoppingBag, CreditCard, ArrowUpRight, Building2, Wallet, History, Smartphone, Zap, MoreHorizontal, Gift, ArrowDownLeft, RefreshCw, User, Sparkles, Inbox } from "lucide-react";
import { useApp } from "@/lib/store";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScanPay } from "@/screens/ScanPay";
import { QuickActionsPanel, type QuickActionKind } from "@/components/QuickActionsPanel";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { ProfilePanel } from "@/components/ProfilePanel";
import heroScan from "@/assets/home-hero-scan.jpg";

interface Txn {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; onClick?: () => void }) {
  const accessibleLabel = label.replace(/\n/g, " ");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      className="flex flex-col items-center gap-2 group rounded-2xl focus:outline-none"
    >
      <div className="hp-tile" aria-hidden="true">
        <Icon className="w-6 h-6 text-white/90" strokeWidth={1.6} />
      </div>
      <span className="text-[11px] text-white/70 leading-tight text-center whitespace-pre-line">{label}</span>
    </button>
  );
}

function RechargeTile({ icon: Icon, label, tint }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; tint: string }) {
  return (
    <button
      type="button"
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

function TxnRow({ txn }: { txn: Txn }) {
  const date = new Date(txn.created_at);
  const time = date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const failed = txn.status === "failed";
  const amountStr = `−₹${Number(txn.amount).toFixed(2)}`;
  return (
    <div
      className="hp-row"
      role="article"
      aria-label={`Payment to ${txn.merchant_name}, ${amountStr}, status ${txn.status}, on ${time}`}
      tabIndex={0}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${failed ? "bg-destructive/15" : "bg-primary/15"}`} aria-hidden="true">
        <ArrowDownLeft className={`w-5 h-5 ${failed ? "text-destructive" : "text-primary"}`} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white truncate">{txn.merchant_name}</p>
        <p className="text-[11px] text-white/50 truncate">{txn.note ? txn.note : txn.upi_id} · {time}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-[14px] font-semibold num-mono ${failed ? "text-destructive line-through" : "text-white"}`}>{amountStr}</p>
        <p className={`text-[10px] uppercase tracking-wider ${txn.status === "success" ? "text-primary/80" : txn.status === "pending" ? "text-yellow-400/80" : "text-destructive/80"}`}>{txn.status}</p>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex-1 flex flex-col items-center py-2 rounded-full transition-colors focus:outline-none ${active ? "hp-nav-active text-white" : "text-white/55 hover:text-white/80"}`}
    >
      <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
      <span className={`text-[11px] mt-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}

export function Home() {
  const { fullName, userId } = useApp();
  const first = fullName?.split(" ")[0] ?? "Alex";
  const [view, setView] = useState<"home" | "scan">("home");
  const [quickAction, setQuickAction] = useState<QuickActionKind | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [navMode, setNavMode] = useState<"full" | "profile-morph">("full");
  const [scanLaunching, setScanLaunching] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadStartRef = useRef<number>(performance.now());

  const fetchTxns = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    loadStartRef.current = performance.now();
    const { data, error: err } = await supabase
      .from("transactions")
      .select("id,amount,merchant_name,upi_id,note,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    // Anti-flicker: keep skeleton on screen for at least 480ms total so it
    // never flashes briefly on instant network responses, then crossfades into
    // the loaded content via the .hp-fade-in 400ms ease-out animation.
    const elapsed = performance.now() - loadStartRef.current;
    const minSkeletonMs = 480;
    if (elapsed < minSkeletonMs) {
      await new Promise((r) => setTimeout(r, minSkeletonMs - elapsed));
    }
    if (err) {
      setError(err.message);
      setShakeKey((k) => k + 1);
    } else {
      setError(null);
      setTxns((data ?? []) as Txn[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { void fetchTxns(); }, [fetchTxns]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("home-txns")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` }, () => {
        void fetchTxns();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchTxns]);

  // Unread notifications badge — count + realtime
  useEffect(() => {
    if (!userId) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false);
      setUnreadCount(count ?? 0);
    };
    void fetchUnread();
    const ch = supabase
      .channel("home-notifs")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        void fetchUnread();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, showNotifs]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTxns();
    setTimeout(() => setRefreshing(false), 400);
  }, [fetchTxns]);

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
    if (pullY > 60) void handleRefresh();
    setPullY(0);
    touchStartY.current = null;
  };

  // Collapse the bottom nav as the user scrolls — at top, expanded with all tabs;
  // beyond ~60px, collapses into a compact Home-only pill (with a smooth liquid morph).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const next = el.scrollTop > 60;
      setNavCollapsed((prev) => (prev === next ? prev : next));
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Profile tap → fluid morph: nav contracts to a single Profile pill,
  // then we open the Profile panel after the morph settles. Works in both
  // expanded and collapsed scroll states because the Profile tab is always
  // kept reachable (never hidden) — and we briefly force-expand the nav so
  // the morph reads as a continuous liquid transition either way.
  const openProfile = useCallback(() => {
    setNavCollapsed(false);
    setNavMode("profile-morph");
    window.setTimeout(() => setShowProfile(true), 360);
  }, []);

  const closeProfile = useCallback(() => {
    setShowProfile(false);
    window.setTimeout(() => setNavMode("full"), 80);
  }, []);

  // Scan FAB → liquid expansion into ScanPay. The FAB grows into a circular
  // overlay that fills the shell, then we mount ScanPay underneath.
  const launchScan = useCallback(() => {
    setScanLaunching(true);
    window.setTimeout(() => {
      setView("scan");
      window.setTimeout(() => setScanLaunching(false), 50);
    }, 420);
  }, []);

  if (view === "scan") return <ScanPay onBack={() => { setView("home"); void fetchTxns(); }} />;

  return (
    <div
      ref={scrollerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="hp-root flex-1 flex flex-col tw-slide-up pb-32 overflow-y-auto relative"
      style={{ transform: pullY ? `translateY(${pullY}px)` : undefined, transition: pullY ? "none" : "transform 220ms ease" }}
    >
      {/* Keyboard skip-link to payment history */}
      <a href="#hp-payment-history" className="hp-skip-link">Skip to payment history</a>

      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || refreshing) && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-white ${refreshing ? "animate-spin" : ""}`} style={{ transform: !refreshing ? `rotate(${pullY * 4}deg)` : undefined }} aria-hidden="true" />
          <span className="text-[11px] text-white/80">{refreshing ? "Refreshing…" : pullY > 60 ? "Release to refresh" : "Pull to refresh"}</span>
        </div>
      )}
      {/* ===== HERO (orange grid bg + scan card image) ===== */}
      <div className="hp-hero relative">
        <div className="hp-hero-bg" />
        <div className="hp-hero-pattern" />
        <div className="hp-hero-spot" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-8">
          <div>
            <p className="hp-greeting">Hey, {first}</p>
            <p className="hp-greeting-sub">Welcome back</p>
          </div>
          <button
            type="button"
            onClick={() => setShowNotifs(true)}
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
          onClick={() => setView("scan")}
          className="hp-scan-card group"
          aria-label="Open scanner to scan and pay"
        >
          <img src={heroScan} alt="" className="hp-scan-img" />
        </button>

        {/* Grass to black blend */}
        <div className="hp-hero-fade" aria-hidden="true" />
      </div>

      {/* ===== OFFERS CAROUSEL ===== */}
      <section
        aria-label="Offers"
        aria-busy={loading}
        aria-live="polite"
        className="px-5 mt-6"
      >
        {loading ? (
          <div className="flex gap-3 overflow-hidden pb-1" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="hp-skeleton snap-start shrink-0" style={{ width: "84%", minHeight: 140 }} />
            ))}
          </div>
        ) : error ? (
          <div key={`offers-err-${shakeKey}`} role="alert" className="hp-empty hp-shake-error hp-fade-in">
            <div className="hp-empty-illu" aria-hidden="true">
              <Sparkles className="w-7 h-7 text-white/85" strokeWidth={1.6} />
            </div>
            <p className="hp-empty-title">Couldn't load offers</p>
            <p className="hp-empty-sub">Check your connection and try again — your rewards will be right back.</p>
            <button
              type="button"
              onClick={() => { setLoading(true); void fetchTxns(); }}
              className="hp-cta-pill"
              aria-label="Retry loading offers"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <div
            className="flex gap-3 overflow-x-auto hp-scroll snap-x snap-mandatory pb-1 hp-fade-in"
            role="list"
            aria-label="Available offers"
          >
            <div className="hp-offer hp-offer-1 snap-start shrink-0" role="listitem">
              <div className="relative z-10">
                <p className="hp-offer-eyebrow">P2P UPI · Limited</p>
                <p className="hp-offer-headline">20%<em>flat off</em></p>
                <p className="hp-offer-sub">On every peer transfer this month</p>
                <button type="button" className="hp-offer-cta" aria-label="Apply 20% flat off offer on peer transfers">
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
                <button type="button" className="hp-offer-cta" aria-label="Claim 40% cashback offer on your first recharge">
                  <span>Claim now</span>
                  <Sparkles className="w-3.5 h-3.5 hp-offer-cta-icon" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ===== EVERYTHING UPI ===== */}
      <div className="px-5 mt-10">
        <div className="hp-section-head">
          <div>
            <span className="hp-section-eyebrow">Quick actions</span>
            <h3 className="hp-section-title">Everything UPI</h3>
          </div>
          <button className="hp-section-link">View all</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <QuickAction icon={ArrowUpRight} label={"Pay\nfriends"} onClick={() => setQuickAction("pay-friends")} />
          <QuickAction icon={Building2} label={"To bank &\nself a/c"} onClick={() => setQuickAction("to-bank")} />
          <QuickAction icon={Wallet} label={"Check\nbalance"} onClick={() => setQuickAction("balance")} />
          <QuickAction icon={History} label={"Transaction\nhistory"} onClick={() => setQuickAction("history")} />
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

      <div className="hp-divider mt-14" aria-hidden="true" />

      {/* ===== PAYMENT HISTORY ===== */}
      <section
        id="hp-payment-history"
        aria-label="Payment history"
        aria-busy={loading}
        aria-live="polite"
        tabIndex={-1}
        className="px-5 mt-10 scroll-mt-4"
      >
        <div className="hp-section-head">
          <div>
            <span className="hp-section-eyebrow">Activity</span>
            <h3 className="hp-section-title">Payment history</h3>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={refreshing ? "Refreshing payment history" : "Refresh payment history"}
            className="hp-section-link inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="hp-skeleton-row" />
            ))}
          </div>
        ) : error ? (
          <div key={`hist-err-${shakeKey}`} role="alert" className="hp-empty hp-shake-error hp-fade-in">
            <div className="hp-empty-illu" aria-hidden="true">
              <RefreshCw className="w-7 h-7 text-white/85" strokeWidth={1.6} />
            </div>
            <p className="hp-empty-title">Couldn't load payments</p>
            <p className="hp-empty-sub">We hit a snag fetching your history. Tap retry — we'll fix it on the next try.</p>
            <button
              type="button"
              onClick={() => { setLoading(true); void fetchTxns(); }}
              className="hp-cta-pill"
              aria-label="Retry loading payment history"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        ) : txns.length === 0 ? (
          <div className="hp-empty hp-fade-in">
            <div className="hp-empty-illu" aria-hidden="true">
              <Inbox className="w-7 h-7 text-white/85" strokeWidth={1.6} />
            </div>
            <p className="hp-empty-title">No transactions yet</p>
            <p className="hp-empty-sub">Tap the scan button below to make your first payment — it'll show up here instantly.</p>
          </div>
        ) : (
          <div className="space-y-2 hp-fade-in" role="list" aria-label="Recent transactions">
            {txns.map((t) => <TxnRow key={t.id} txn={t} />)}
          </div>
        )}
      </section>

      {/* trailing breathing room above floating nav */}
      <div className="h-6" />

      {/* ===== FLOATING BOTTOM NAV (scroll-collapsing + liquid morph) ===== */}
      <nav
        aria-label="Primary"
        data-mode={navMode}
        data-collapsed={navCollapsed ? "true" : "false"}
        className="hp-nav-shell fixed bottom-5 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="flex items-center gap-3">
          <div className="hp-nav hp-nav-pill flex-1" role="tablist" aria-label="Sections">
            <NavItem icon={HomeIcon} label="Home" active />
            <span
              className="hp-nav-tab"
              data-hidden={navCollapsed || navMode === "profile-morph" ? "true" : "false"}
              aria-hidden={navCollapsed || navMode === "profile-morph" ? "true" : "false"}
            >
              <NavItem icon={Gift} label="Shop" />
            </span>
            {/* Profile is ALWAYS reachable: never hidden in collapsed/morph states.
                Keeps keyboard focus order intact and ensures the liquid morph
                transition has a consistent target element. */}
            <span className="hp-nav-tab" data-hidden="false" data-testid="hp-nav-profile-wrap">
              <NavItem icon={User} label="Profile" onClick={openProfile} />
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

      {/* Liquid expansion overlay for the Scan FAB → ScanPay transition */}
      {scanLaunching && (
        <div className="hp-scan-launch" aria-hidden="true">
          <span className="hp-scan-launch-bubble" />
        </div>
      )}

      {quickAction && <QuickActionsPanel kind={quickAction} onClose={() => setQuickAction(null)} />}
      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
      {showProfile && <ProfilePanel onClose={closeProfile} />}
    </div>
  );
}
