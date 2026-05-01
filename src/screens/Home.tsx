import { Bell, Home as HomeIcon, ScanLine, CreditCard, ArrowUpRight, Building2, Wallet, History, Smartphone, Zap, MoreHorizontal, RefreshCw, User, Sparkles, Send } from "lucide-react";
import { useApp } from "@/lib/store";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
// Heavy panels are lazy-loaded — they only mount when the user opens them
// (Scan, Transactions, Notifications, Profile, or a Quick Action). Eagerly
// importing them was forcing ~6500 LOC into the Home chunk and slowing
// first paint significantly on cold loads.
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { QuickActionKind } from "@/components/QuickActionsPanel";
const ScanPay = lazyWithRetry(() => import("@/screens/ScanPay").then(m => ({ default: m.ScanPay })));
const Transactions = lazyWithRetry(() => import("@/screens/Transactions").then(m => ({ default: m.Transactions })));
const QuickActionsPanel = lazyWithRetry(() => import("@/components/QuickActionsPanel").then(m => ({ default: m.QuickActionsPanel })));
const NotificationsPanel = lazyWithRetry(() => import("@/components/NotificationsPanel").then(m => ({ default: m.NotificationsPanel })));
const ProfilePanel = lazyWithRetry(() => import("@/components/ProfilePanel").then(m => ({ default: m.ProfilePanel })));
import heroScan from "@/assets/home-hero-scan.jpg";
import heroScanDiwali from "@/assets/home-hero-scan-diwali.png";
import heroScanHoli from "@/assets/home-hero-scan-holi.png";
import { useAppImage } from "@/lib/useAppImage";
import { haptics } from "@/lib/haptics";
import { useGenderPersona } from "@/lib/genderPersona";
import { notifyPaymentReceived, maybeInsertGreeting, maybeNotifyLowBalance, notifyAppIssue } from "@/lib/notify";
import { toast } from "sonner";

interface PersonaOffer {
  id: string;
  eyebrow: string;
  headline: string;
  emphasis: string;
  subtitle: string;
  cta_label: string;
  accent: string;
}

// Returns true during the Diwali festival window so the scan hero swaps to
// the festive variant. Diwali 2026 falls on Nov 8 — we light the banner from
// Oct 25 → Nov 15 (covers Dhanteras through Bhai Dooj). A `?festival=diwali`
// query param forces it on year-round for testing/preview.
function isDiwaliSeason(now: Date = new Date()): boolean {
  if (typeof window !== "undefined") {
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("festival");
    if (f === "diwali") return true;
    if (f === "off") return false;
  }
  // Diwali date table — extend yearly. Keys are YYYY, values are the main
  // Lakshmi Puja date. Window: 14 days before → 7 days after.
  const DIWALI: Record<number, string> = {
    2024: "2024-11-01",
    2025: "2025-10-21",
    2026: "2026-11-08",
    2027: "2027-10-29",
    2028: "2028-11-17",
  };
  const iso = DIWALI[now.getUTCFullYear()];
  if (!iso) return false;
  const peak = new Date(iso + "T00:00:00Z").getTime();
  const day = 86400000;
  return now.getTime() >= peak - 14 * day && now.getTime() <= peak + 7 * day;
}

// Returns true during the Holi festival window. Holi (Rangwali Holi / Dhulandi)
// dates: 2025-03-14, 2026-03-04, 2027-03-22, 2028-03-11, 2029-02-28.
// Window: 5 days before (covers Holika Dahan eve) → 2 days after.
// `?festival=holi` query param forces it on for testing/preview.
function isHoliSeason(now: Date = new Date()): boolean {
  if (typeof window !== "undefined") {
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("festival");
    if (f === "holi") return true;
    if (f === "off") return false;
  }
  const HOLI: Record<number, string> = {
    2025: "2025-03-14",
    2026: "2026-03-04",
    2027: "2027-03-22",
    2028: "2028-03-11",
    2029: "2029-02-28",
  };
  const iso = HOLI[now.getUTCFullYear()];
  if (!iso) return false;
  const peak = new Date(iso + "T00:00:00Z").getTime();
  const day = 86400000;
  return now.getTime() >= peak - 5 * day && now.getTime() <= peak + 2 * day;
}


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
      onClick={() => { void haptics.tap(); onClick?.(); }}
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

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  loading,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        void haptics.select();
        onClick?.();
      }}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      aria-busy={loading ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      className={`flex-1 flex flex-col items-center py-2 rounded-full transition-colors focus:outline-none ${active ? "hp-nav-active text-white" : "text-white/55 hover:text-white/80"} ${disabled ? "opacity-55 cursor-progress" : ""}`}
    >
      <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
      <span className={`text-[11px] mt-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}

export function Home() {
  const { fullName, userId } = useApp();
  const persona = useGenderPersona();
  const first = fullName?.split(" ")[0] ?? "Alex";
  // Admin-managed scan hero images (live via Realtime). Falls back to bundled assets.
  const scanHeroDefault = useAppImage("home.scan_hero", heroScan, "Scan and pay");
  const scanHeroDiwali = useAppImage("home.scan_hero_diwali", heroScanDiwali, "Diwali scan and pay");
  const scanHeroHoli = useAppImage("home.scan_hero_holi", heroScanHoli, "Holi scan and pay");
  const [view, setView] = useState<"home" | "scan" | "transactions">("home");
  const [quickAction, setQuickAction] = useState<QuickActionKind | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [personaOffers, setPersonaOffers] = useState<PersonaOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [navMode, setNavMode] = useState<"full" | "profile-morph">("full");
  const [scanLaunching, setScanLaunching] = useState(false);
  const [greetingPulse, setGreetingPulse] = useState(0);
  const [showGreetingTip, setShowGreetingTip] = useState(false);
  const [waveEnabled, setWaveEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("tw_greeting_wave"); return v === null ? true : v === "1"; } catch { return true; }
  });
  const toggleWave = useCallback(() => {
    setWaveEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem("tw_greeting_wave", next ? "1" : "0"); } catch { /* ignore */ }
      void haptics.select();
      return next;
    });
  }, []);
  const handleGreetingTap = useCallback(() => {
    setGreetingPulse((k) => k + 1);
    setShowGreetingTip(true);
    void haptics.heartbeat();
    window.setTimeout(() => setShowGreetingTip(false), 2200);
  }, []);
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
    // Show data as soon as it arrives. The previous 480ms artificial
    // skeleton hold was making Home feel sluggish on every cold mount —
    // the .hp-fade-in CSS animation already provides a smooth crossfade,
    // so a tiny natural delay is enough.
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

  // Push-notification deep link → switch into the Transactions screen.
  // Transactions.tsx then resolves the txn id (or falls back to the most recent).
  useEffect(() => {
    const onDeepLink = () => setView("transactions");
    // Handle a deep-link captured before this listener attached.
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("tw-pending-deeplink-v1");
        if (raw) setView("transactions");
      } catch { /* ignore */ }
    }
    window.addEventListener("tw:deeplink", onDeepLink);
    return () => window.removeEventListener("tw:deeplink", onDeepLink);
  }, []);

  // Persona-targeted offers feed (admin-managed via gender_offers).
  // Depend on the primitive `persona.persona` — `offerFilter` is a fresh
  // array literal on every render, which previously caused a duplicate
  // fetch every time the persona resolved (neutral → boy/girl).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("gender_offers")
        .select("id,eyebrow,headline,emphasis,subtitle,cta_label,accent,sort_order,gender_target")
        .eq("active", true)
        .in("gender_target", persona.offerFilter)
        .order("sort_order", { ascending: true })
        .limit(8);
      if (!cancelled) setPersonaOffers((data ?? []) as PersonaOffer[]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.persona]);

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

  // Payment-received watcher — listens for balance credits on the user's
  // profile and emits a rich in-app notification (+ toast) whenever the
  // balance goes UP. Initial balance is loaded once so we don't fire on
  // first mount; subsequent UPDATE events with a positive delta count as
  // an incoming credit (parent top-up, refund, cashback settlement, etc).
  const lastBalanceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("balance")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled && data) lastBalanceRef.current = Number(data.balance);
    })();
    const ch = supabase
      .channel("home-balance")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          const next = Number((payload.new as { balance?: number | string }).balance);
          if (!Number.isFinite(next)) return;
          const prev = lastBalanceRef.current;
          lastBalanceRef.current = next;
          // Always re-evaluate low-balance threshold on any balance change.
          void maybeNotifyLowBalance(userId, next);
          if (prev == null) return; // baseline only
          const delta = +(next - prev).toFixed(2);
          if (delta > 0) {
            const formatted = `₹${delta.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
            toast.success(`${formatted} received`, {
              description: "Credited to your wallet",
              icon: "💰",
            });
            void notifyPaymentReceived(userId, delta);
            void haptics.swipe();
          }
        },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [userId]);

  // Time-of-day greeting — fires once per (slot, day) when Home mounts.
  useEffect(() => {
    if (!userId) return;
    void maybeInsertGreeting(userId, fullName ?? null);
  }, [userId, fullName]);

  // Surface uncaught runtime issues into the notification feed (throttled).
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const isNoise = (msg: string) =>
      /Failed to fetch dynamically imported module|Importing a module script failed|ResizeObserver loop|Load failed/i.test(msg);
    const onError = (e: ErrorEvent) => {
      const msg = e.message || "";
      if (isNoise(msg)) return;
      void notifyAppIssue(userId, "We hit a hiccup", msg || "An unexpected error occurred. We're on it.");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = (e.reason && typeof e.reason === "object" && "message" in e.reason)
        ? String((e.reason as { message: unknown }).message)
        : (typeof e.reason === "string" ? e.reason : "Background task failed");
      if (isNoise(msg)) return;
      void notifyAppIssue(userId, "Something didn't go through", msg);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [userId]);

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
    if (showProfile) return;
    if ((scrollerRef.current?.scrollTop ?? 0) <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (showProfile) return;
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80));
  };
  const onTouchEnd = () => {
    if (showProfile) {
      setPullY(0);
      touchStartY.current = null;
      return;
    }
    if (pullY > 60) { void haptics.swipe(); void handleRefresh(); }
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

  // Idle-time prefetch — warm the heavy panels after Home has painted so
  // the first tap on Scan / Notifications / Profile / Quick actions feels
  // instant without bloating the initial Home chunk.
  // Track whether the lazy ProfilePanel chunk is fully loaded. We disable the
  // Profile nav button until it is, so a flurry of taps can never spawn
  // overlapping mounts or race with Suspense (e.g. user double-taps before
  // the chunk arrives → only one open is registered, no flicker).
  const [profileReady, setProfileReady] = useState(false);

  // Eagerly prefetch ProfilePanel right after first paint — it's the largest
  // lazy chunk on this screen and waiting until idle made the first tap feel
  // like the app was hanging. Other panels stay idle-prefetched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    // Kick the Profile panel chunk on next microtask so initial paint isn't
    // blocked, but it's downloading well before the user can tap.
    import("@/components/ProfilePanel")
      .then(() => { if (!cancelled) setProfileReady(true); })
      .catch(() => { /* network hiccup — button stays disabled, retried on hover */ });

    const idle = (cb: () => void) => {
      const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
      if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb);
      else window.setTimeout(cb, 800);
    };
    idle(() => {
      void import("@/screens/ScanPay");
      void import("@/components/NotificationsPanel");
      void import("@/components/QuickActionsPanel");
      void import("@/screens/Transactions");
    });
    return () => { cancelled = true; };
  }, []);

  // Warm the chunk on hover / pointerdown so even slow networks have it ready
  // by the time the click lands. Safe to call repeatedly — module imports are
  // de-duped by the bundler. Also flips profileReady once the chunk arrives,
  // re-enabling the nav button if the initial prefetch failed.
  const warmProfile = useCallback(() => {
    if (profileReady) return;
    import("@/components/ProfilePanel")
      .then(() => setProfileReady(true))
      .catch(() => { /* still not ready — keep disabled */ });
  }, [profileReady]);

  // Profile tap → open immediately. We guard against double-taps and race
  // conditions by requiring the chunk to be loaded AND that the panel isn't
  // already open before flipping state.
  const openProfile = useCallback(() => {
    if (showProfile) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // Kick the import in case the prefetch failed — Suspense will show
    // the skeleton fallback while the chunk arrives.
    if (!profileReady) {
      import("@/components/ProfilePanel")
        .then(() => setProfileReady(true))
        .catch(() => { /* Suspense fallback covers this */ });
    }
    void haptics.bloom();
    setNavCollapsed(false);
    setNavMode("profile-morph");
    setShowProfile(true);
  }, [showProfile, profileReady]);

  const closeProfile = useCallback(() => {
    void haptics.swipe();
    setShowProfile(false);
    window.setTimeout(() => setNavMode("full"), 80);
    // Page-transition reset: bring Home back to the top so the user lands at
    // the hero instead of wherever they had scrolled before opening Profile.
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const openTransactionsFromProfile = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setShowProfile(false);
    setNavMode("full");
    setView("transactions");
  }, []);

  // Scan FAB → liquid expansion into ScanPay. The FAB grows into a circular
  // overlay that fills the shell, then we mount ScanPay underneath.
  const launchScan = useCallback(() => {
    void haptics.bloom();
    setScanLaunching(true);
    window.setTimeout(() => {
      setView("scan");
      window.setTimeout(() => setScanLaunching(false), 50);
    }, 420);
  }, []);

  if (view === "scan") return (
    <Suspense fallback={null}>
      <ScanPay onBack={() => { setView("home"); void fetchTxns(); }} />
    </Suspense>
  );
  if (view === "transactions") return (
    <Suspense fallback={null}>
      <Transactions onBack={() => { setView("home"); void fetchTxns(); }} />
    </Suspense>
  );

  return (
    <div
      ref={scrollerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`hp-root ${persona.accentClass} flex-1 min-h-0 flex flex-col tw-slide-up pb-32 ${showProfile ? "overflow-hidden" : "overflow-y-auto"} relative`}
      style={{ transform: pullY ? `translateY(${pullY}px)` : undefined, transition: pullY ? "none" : "transform 220ms ease" }}
    >


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
      <div className="hp-hero hp-shimmer-reveal relative">
        <div className="hp-hero-bg" />
        <div className="hp-hero-pattern" />
        <div className="hp-hero-spot" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-8">
          <button
            type="button"
            onClick={handleGreetingTap}
            onDoubleClick={toggleWave}
            aria-label={`Greeting for ${first}. Double-tap to ${waveEnabled ? "hide" : "show"} the wave emoji.`}
            className="hp-greeting-tap text-left"
          >
            <p key={greetingPulse} className="hp-greeting hp-greeting-pulse">
              Hey, {first}{waveEnabled ? ` ${persona.emoji}` : ""}
            </p>
            <p className="hp-greeting-sub">{persona.subtitle}</p>
            <span
              role="status"
              aria-live="polite"
              className={`hp-greeting-tip ${showGreetingTip ? "is-visible" : ""}`}
            >
              {waveEnabled ? "Double-tap to hide 👋" : "Double-tap to bring back 👋"}
            </span>
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

        {/* Scan hero card — swaps to a Holi or Diwali themed banner during the festival */}
        {(() => {
          const holi = isHoliSeason();
          const diwali = !holi && isDiwaliSeason();
          const hero = holi ? scanHeroHoli : diwali ? scanHeroDiwali : scanHeroDefault;
          const festival = holi ? "holi" : diwali ? "diwali" : undefined;
          return (
            <button
              type="button"
              onClick={() => setView("scan")}
              className="hp-scan-card group"
              aria-label="Open scanner to scan and pay"
              data-festival={festival}
            >
              <img src={hero.url} alt={hero.alt} className="hp-scan-img" />
            </button>
          );
        })()}

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
            {personaOffers.length > 0 ? (
              personaOffers.map((o) => (
                <div
                  key={o.id}
                  className="hp-offer hp-offer-persona snap-start shrink-0"
                  role="listitem"
                  data-accent={o.accent}
                >
                  <div className="relative z-10">
                    <p className="hp-offer-eyebrow">{o.eyebrow}</p>
                    <p className="hp-offer-headline">{o.headline}<em>{o.emphasis}</em></p>
                    <p className="hp-offer-sub">{o.subtitle}</p>
                    <button
                      type="button"
                      onClick={() => void haptics.success()}
                      className="hp-offer-cta"
                      aria-label={`${o.cta_label} — ${o.headline} ${o.emphasis}`}
                    >
                      <span>{o.cta_label}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 hp-offer-cta-icon" strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <>
                <div className="hp-offer hp-offer-1 snap-start shrink-0" role="listitem">
                  <div className="relative z-10">
                    <p className="hp-offer-eyebrow">P2P UPI · Limited</p>
                    <p className="hp-offer-headline">20%<em>flat off</em></p>
                    <p className="hp-offer-sub">On every peer transfer this month</p>
                    <button type="button" onClick={() => void haptics.success()} className="hp-offer-cta" aria-label="Apply 20% flat off offer on peer transfers">
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
                    <button type="button" onClick={() => void haptics.success()} className="hp-offer-cta" aria-label="Claim 40% cashback offer on your first recharge">
                      <span>Claim now</span>
                      <Sparkles className="w-3.5 h-3.5 hp-offer-cta-icon" strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </>
            )}
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

        {/* Primary P2P CTA — phone or UPI ID, instant transfer */}
        <button
          type="button"
          onClick={() => { void haptics.bloom(); setQuickAction("send-money"); }}
          aria-label="Send money to anyone using a phone number or UPI ID"
          className="hp-send-cta group"
        >
          <span className="hp-send-cta-glow" aria-hidden="true" />
          <span className="hp-send-cta-icon" aria-hidden="true">
            <Send className="w-5 h-5 text-black" strokeWidth={2.4} />
          </span>
          <span className="flex-1 text-left min-w-0">
            <span className="block text-[14px] font-semibold text-white leading-tight">
              Send money instantly
            </span>
            <span className="block text-[11px] text-white/65 mt-0.5 truncate">
              Phone number or UPI ID · End-to-end secure
            </span>
          </span>
          <ArrowUpRight className="w-4 h-4 text-white/70 group-hover:text-white shrink-0" strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="grid grid-cols-4 gap-3 mt-4">
          <QuickAction icon={ArrowUpRight} label={"Pay\nfriends"} onClick={() => setQuickAction("pay-friends")} />
          <QuickAction icon={Building2} label={"To bank &\nself a/c"} onClick={() => setQuickAction("to-bank")} />
          <QuickAction icon={Wallet} label={"Check\nbalance"} onClick={() => setQuickAction("balance")} />
          <QuickAction icon={History} label={"Transaction\nhistory"} onClick={() => setView("transactions")} />
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

      {/* Payment history moved to dedicated Transactions screen — accessible
          via the bottom nav and the "Transaction history" quick action. */}

      {/* trailing breathing room above floating nav */}
      <div className="h-6" />

      {/* ===== FLOATING BOTTOM NAV (scroll-collapsing + liquid morph) =====
          Portaled to <body> so no transformed/scrolling ancestor (e.g. the
          pull-to-refresh wrapper) can trap position: fixed. This guarantees
          the dock stays pinned to the device viewport on every device. */}
      {typeof document !== "undefined" && createPortal(
        <>
          <nav
            aria-label="Primary"
            data-mode={navMode}
            data-collapsed={navCollapsed ? "true" : "false"}
            className={`hp-nav-shell hp-nav-fixed z-[60] transition-opacity duration-300 ease-out ${showProfile ? "opacity-0 pointer-events-none translate-y-4" : "opacity-100"}`}
          >
            <div className="flex items-center gap-3">
              <div className="hp-nav hp-nav-pill flex-1" role="tablist" aria-label="Sections">
                <NavItem icon={HomeIcon} label="Home" active />
                <span
                  className="hp-nav-tab"
                  data-hidden={navCollapsed || navMode === "profile-morph" ? "true" : "false"}
                  aria-hidden={navCollapsed || navMode === "profile-morph" ? "true" : "false"}
                >
                  <NavItem icon={History} label="Transactions" onClick={() => setView("transactions")} />
                </span>
                <span
                  className="hp-nav-tab"
                  data-hidden="false"
                  data-testid="hp-nav-profile-wrap"
                  onPointerEnter={warmProfile}
                  onPointerDown={warmProfile}
                  onTouchStart={warmProfile}
                >
                  <NavItem
                    icon={User}
                    label="Profile"
                    onClick={openProfile}
                    disabled={showProfile}
                    loading={!profileReady}
                  />
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
        </>,
        document.body,
      )}

      {quickAction && (
        <Suspense fallback={null}>
          <QuickActionsPanel kind={quickAction} onClose={() => setQuickAction(null)} />
        </Suspense>
      )}
      {showNotifs && (
        <Suspense fallback={null}>
          <NotificationsPanel onClose={() => setShowNotifs(false)} />
        </Suspense>
      )}
      {showProfile && (
        <Suspense
          fallback={
            <div
              className="absolute inset-0 z-[60] flex flex-col bg-background overflow-hidden tw-skel-root"
              aria-busy="true"
              aria-label="Loading profile"
            >
              <div className="qa-bg" />
              <div className="qa-grid" />
              {/* Header skeleton */}
              <div className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
                <div className="w-9 h-9 rounded-full tw-skel" />
                <div className="h-4 w-20 rounded-full tw-skel" />
                <div className="w-9 h-9" />
              </div>
              {/* Avatar + name skeleton */}
              <div className="relative z-10 px-5 mt-4 flex flex-col items-center gap-3">
                <div className="w-20 h-20 rounded-full tw-skel" />
                <div className="h-4 w-32 rounded-full tw-skel" />
                <div className="h-3 w-24 rounded-full tw-skel" />
              </div>
              {/* Tabs skeleton */}
              <div className="relative z-10 px-5 mt-6 flex gap-2">
                {[0,1,2,3].map((i) => (
                  <div key={i} className="h-8 flex-1 rounded-full tw-skel" />
                ))}
              </div>
              {/* Cards skeleton */}
              <div className="relative z-10 px-5 mt-5 space-y-3">
                {[0,1,2].map((i) => (
                  <div key={i} className="h-20 rounded-2xl tw-skel" />
                ))}
              </div>
            </div>
          }
        >
          <ProfilePanel onClose={closeProfile} onTransactions={openTransactionsFromProfile} />
        </Suspense>
      )}
    </div>
  );
}
