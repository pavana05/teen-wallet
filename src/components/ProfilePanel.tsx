import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft, X, QrCode, Copy, Check, ChevronRight, ChevronDown, Pencil, Camera, ShieldCheck,
  ShieldAlert, BadgeCheck, Wallet, CreditCard, Building2, Bell, Lock, Smartphone,
  Eye, EyeOff, Languages, Moon, HelpCircle, FileText, LogOut, Star, Gift, Users,
  Settings, Sparkles, IndianRupee, Activity, Mail, Cake,
  TrendingUp, Trash2, Share2, Download, AlertTriangle, Receipt, GraduationCap,
  Instagram, Ticket, Loader2,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { logout } from "@/lib/auth";
import { useAppLock } from "@/lib/appLock";
import { AppLockSettings } from "@/components/app-lock/AppLockSettings";
import { TrustedDevices } from "@/screens/TrustedDevices";
import { usePersistentState } from "./profile/usePersistentState";
import { NotificationPrefs, DEFAULT_NOTIF_PREFS, type NotifPrefs } from "./profile/NotificationPrefs";
import { KycTimeline } from "./profile/KycTimeline";
import { ProfileCompletionMeter } from "./profile/ProfileCompletionMeter";
import { QuickActions } from "./profile/QuickActions";
import { InlineEditCard } from "./profile/InlineEditCard";
import { useMotionLevel, type MotionLevel } from "@/lib/motionPrefs";
import { qrColors } from "@/lib/themeTokens";
import { ReferralProgram } from "@/screens/ReferralProgram";
import { FloatingDock } from "@/components/FloatingDock";

interface Props {
  onClose: () => void;
  onTransactions?: () => void;
}

type Tab = "overview" | "account" | "security" | "preferences" | "support";

interface Stats {
  totalSpent: number;
  txnCount: number;
  monthSpent: number;
  successRate: number;
}

export function ProfilePanel({ onClose, onTransactions }: Props) {
  const { fullName, userId, balance, reset } = useApp();
  const navigate = useNavigate();
  // Helper: close the panel and push an internal route via the router.
  // Avoids window.location.assign which forces a full document reload and
  // (on native shells) can look like a browser redirect.
  const goTo = (to: string) => { onClose(); void navigate({ to }); };

  // Persisted: which tab the user was on, and which collapsible sections were expanded.
  const [tab, setTab] = usePersistentState<Tab>("tw-profile-tab", "overview");
  const [expanded, setExpanded] = usePersistentState<Record<string, boolean>>("tw-profile-expanded", {});
  const toggleSection = (id: string, defaultOpen: boolean) =>
    setExpanded((p) => ({ ...p, [id]: !(p[id] ?? defaultOpen) }));
  const isOpen = (id: string, defaultOpen: boolean) => expanded[id] ?? defaultOpen;

  const [profile, setProfile] = useState<{
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    gender: string | null;
    email: string | null;
    aadhaar_last4: string | null;
    school_name: string | null;
    kyc_status: "not_started" | "pending" | "approved" | "rejected";
    notif_prefs: NotifPrefs;
    created_at: string;
  } | null>(null);
  const [stats, setStats] = useState<Stats>({ totalSpent: 0, txnCount: 0, monthSpent: 0, successRate: 100 });
  const [profileLoading, setProfileLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editPhoneOpen, setEditPhoneOpen] = useState(false);
  // Virtual Card is on the roadmap but not shipped yet. Tapping the section
  // opens a friendly "Under Construction" modal instead of dead-end clicks.
  const [vcardOpen, setVcardOpen] = useState(false);
  const [appLockOpen, setAppLockOpen] = useState(false);
  const [trustedDevicesOpen, setTrustedDevicesOpen] = useState(false);
  const [trustedDeviceCount, setTrustedDeviceCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("trusted_devices")
        .select("id", { count: "exact", head: true });
      if (!cancelled) setTrustedDeviceCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [trustedDevicesOpen]);
  const appLockStatus = useAppLock((s) => s.status);

  // app-level preferences (toggles unrelated to notification channels)
  const [prefs, setPrefs] = usePersistentState("tw-profile-prefs", {
    biometric: true, darkMode: true, lang: "English", sounds: true,
  });

  // Connected Instagram handle (persisted locally — server hookup is future work)
  const [instagram, setInstagram] = usePersistentState<string>("tw-profile-instagram", "");
  const [igOpen, setIgOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);

  const refetch = async () => {
    if (!userId) return;
    setProfileLoading(true); setStatsLoading(true); setProfileError(false);
    const [{ data: p, error: pErr }, { data: txns, error: tErr }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name,phone,dob,gender,email,aadhaar_last4,school_name,kyc_status,notif_prefs,created_at")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("transactions")
        .select("amount,status,created_at")
        .eq("user_id", userId),
    ]);
    if (pErr) {
      setProfileError(true);
      toast.error("Couldn't load your profile", { description: pErr.message });
    } else if (p) {
      setProfile({
        ...p,
        notif_prefs: { ...DEFAULT_NOTIF_PREFS, ...((p.notif_prefs ?? {}) as Partial<NotifPrefs>) },
      } as typeof profile extends infer T ? T : never);
    }
    setProfileLoading(false);

    if (tErr) {
      toast.error("Couldn't load your transaction stats", { description: tErr.message });
    } else if (txns) {
      const total = txns.reduce((s, t) => s + Number(t.amount || 0), 0);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const monthSpent = txns
        .filter((t) => new Date(t.created_at) >= monthStart && t.status === "success")
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      const succ = txns.filter((t) => t.status === "success").length;
      setStats({
        totalSpent: total,
        txnCount: txns.length,
        monthSpent,
        successRate: txns.length ? Math.round((succ / txns.length) * 100) : 100,
      });
    }
    setStatsLoading(false);
  };

  useEffect(() => { void refetch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  // Reset scroll to the top of the panel whenever the user switches tabs so
  // each section opens at its header instead of preserving the prior position.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "auto" });
    else el.scrollTop = 0;
  }, [tab]);

  const phone = profile?.phone ?? "+91 ••••• •••••";
  const upiId = useMemo(() => {
    const digits = (profile?.phone ?? "").replace(/\D/g, "").slice(-10);
    return digits ? `${digits}@teenwallet` : "—";
  }, [profile?.phone]);

  const memberSince = useMemo(() => {
    if (!profile?.created_at) return "—";
    return new Date(profile.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }, [profile?.created_at]);

  const initials = useMemo(() => {
    const n = profile?.full_name ?? fullName ?? "";
    const parts = n.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }, [profile?.full_name, fullName]);

  const copy = async (val: string, key: string) => {
    try { await navigator.clipboard.writeText(val); setCopied(key); setTimeout(() => setCopied(null), 1400); } catch {}
  };

  const clearLocalState = () => {
    try {
      // Wipe everything we own without nuking the whole storage (other apps may share origin in dev).
      const keysToClear: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("tw-") || k === "teenwallet-app")) keysToClear.push(k);
      }
      keysToClear.forEach((k) => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch { /* ignore quota / privacy mode */ }
  };

  const [loggingOut, setLoggingOut] = useState(false);
  const onLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    // Close the confirm sheet immediately so the UI feels responsive even
    // if the network call to Supabase is slow.
    setConfirmLogout(false);
    const t = toast.loading("Signing you out…");
    // Kick off remote sign-out but don't block local cleanup on it. If the
    // network is flaky, the user still gets logged out on this device.
    const remote = logout().catch((e) => {
      console.warn("[logout] remote signOut failed", e);
    });
    // Race remote sign-out against a 2.5s timeout — whichever wins, we
    // proceed to clear local state and bounce back to onboarding.
    await Promise.race([
      remote,
      new Promise((res) => setTimeout(res, 2500)),
    ]);
    try {
      clearLocalState();
      reset();
      toast.success("Signed out", { id: t });
      onClose();
    } catch (e) {
      toast.error("Couldn't sign out", { id: t, description: (e as Error).message });
    } finally {
      setLoggingOut(false);
    }
  };

  const onDeleteAccount = async () => {
    if (!userId) return;
    const t = toast.loading("Deleting your account…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Please sign in again.");
      const { error } = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      // Sign out locally + nuke caches
      await supabase.auth.signOut().catch(() => {});
      clearLocalState();
      reset();
      toast.success("Account deleted", { id: t });
      onClose();
    } catch (e) {
      toast.error("Couldn't delete account", { id: t, description: (e as Error).message });
    }
  };

  const kyc = profile?.kyc_status ?? "not_started";
  const kycMeta = {
    approved: { label: "KYC Verified", icon: BadgeCheck, color: "text-emerald-300", bg: "bg-emerald-400/10", border: "border-emerald-400/30" },
    pending: { label: "KYC In Review", icon: ShieldAlert, color: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/30" },
    rejected: { label: "KYC Rejected", icon: ShieldAlert, color: "text-red-300", bg: "bg-red-400/10", border: "border-red-400/30" },
    not_started: { label: "Complete KYC", icon: ShieldAlert, color: "text-white/80", bg: "bg-white/5", border: "border-white/15" },
  }[kyc];

  return (
    <div
      className="qa-root absolute inset-0 z-[60] flex flex-col bg-background overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-panel-title"
      aria-describedby="profile-panel-desc"
    >
      <div className="qa-bg" />
      <div className="qa-grid" />
      <div className="pp-aurora" aria-hidden="true" />

      {/* header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
        <button onClick={onClose} aria-label="Back to home" className="qa-icon-btn">
          <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} aria-hidden="true" />
        </button>
        <h1 id="profile-panel-title" className="text-[15px] font-semibold text-white tracking-tight">Profile</h1>
        <p id="profile-panel-desc" className="sr-only">Manage your TeenWallet account, security, preferences and support options.</p>
        <div className="qa-icon-btn invisible" aria-hidden="true" />
      </header>

      <div ref={scrollRef} className="pp-scroll relative z-10 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-32 qa-enter">
        {/* error banner */}
        {profileError && (
          <div className="px-5 mt-3">
            <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-3.5 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-red-300 shrink-0" strokeWidth={2.2} />
              <p className="text-[12.5px] text-red-100/90 flex-1">Couldn't load your profile. Check your connection and try again.</p>
              <button onClick={() => void refetch()} className="text-[11.5px] font-semibold text-red-100 px-2.5 py-1 rounded-full bg-red-400/15 border border-red-400/30">Retry</button>
            </div>
          </div>
        )}

        {/* ── HERO CARD v3 (premium phone-centric) ──
            Render fallback hero (with safe defaults) when profile fetch fails so
            the screen stays usable. Skeleton is only shown on the initial load,
            not after an error — the error banner above already conveys the state. */}
        <div className="px-5 mt-3">
          {profileLoading && !profileError ? <HeroSkeleton /> : (
          <div className="pp-hero pp-hero-v3">
            <div className="pp-hero-shine" />
            <div className="pp-hero-topglow" aria-hidden="true" />

            {/* Top: phone number + member since */}
            <div className="relative text-center pt-1">
              <p className="pp-hero-phone num-mono">{phone}</p>
              <p className="pp-hero-since mt-0.5">Member since {memberSince}</p>
            </div>

            {/* Centered avatar with edit camera */}
            <div className="relative mt-4 flex justify-center">
              <button
                onClick={() => setTab("account")}
                className="pp-avatar-xl-wrap"
                aria-label="Edit profile photo"
              >
                <div className="pp-avatar pp-avatar-xl">{initials}</div>
                <span className="pp-avatar-xl-cam" aria-hidden="true">
                  <Camera className="w-3.5 h-3.5 text-zinc-900" strokeWidth={2.4} />
                </span>
              </button>
            </div>

            {/* Name + KYC badge */}
            <div className="relative mt-3 text-center">
              <div className="inline-flex items-center gap-1.5">
                <p className="text-white text-[15px] font-semibold tracking-tight truncate max-w-[220px]">
                  {profile?.full_name ?? fullName ?? "Add your name"}
                </p>
                <button onClick={() => setTab("account")} className="text-white/55 hover:text-white transition-colors" aria-label="Edit name">
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
              <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-[3px] rounded-full border ${kycMeta.border} ${kycMeta.bg}`}>
                <kycMeta.icon className={`w-3 h-3 ${kycMeta.color}`} strokeWidth={2.2} />
                <span className={`text-[9.5px] font-semibold ${kycMeta.color} tracking-wide`}>{kycMeta.label}</span>
              </div>
            </div>

            {/* Info rows: UPI ID + Phone No */}
            <div className="relative mt-4 pp-info-block">
              <button
                onClick={() => copy(upiId, "upi")}
                disabled={upiId === "—"}
                className="pp-info-row w-full text-left disabled:opacity-60"
                aria-label="Copy UPI ID"
              >
                <span className="pp-info-label">UPI ID</span>
                <span className="pp-info-value num-mono truncate">{upiId}</span>
                <span className="pp-info-action">
                  {copied === "upi" ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 text-white/55" />}
                </span>
              </button>
              <div className="pp-info-divider" />
              <button
                onClick={() => copy(phone, "phone")}
                className="pp-info-row w-full text-left"
                aria-label="Copy phone number"
              >
                <span className="pp-info-label">Phone No.</span>
                <span className="pp-info-value num-mono truncate">{phone}</span>
                <span className="pp-info-action">
                  {copied === "phone" ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 text-white/55" />}
                </span>
              </button>
            </div>

            {/* Wallet balance pill row (compact) */}
            <div className="relative mt-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-white/45">Balance</span>
                <button
                  onClick={() => setHideBalance((v) => !v)}
                  className="text-white/55 hover:text-white transition-colors"
                  aria-label="Toggle balance visibility"
                >
                  {hideBalance ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-white text-[13.5px] font-semibold num-mono">
                {hideBalance ? "₹ ••••" : `₹${Number(balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
              </p>
            </div>

            {/* My QR centered button */}
            <div className="relative mt-4 flex justify-center">
              <button
                onClick={() => setQrOpen(true)}
                disabled={upiId === "—"}
                className="pp-myqr-btn disabled:opacity-50"
                aria-label="Show my QR code"
              >
                <span>My QR</span>
                <QrCode className="w-3.5 h-3.5" strokeWidth={2.2} />
              </button>
            </div>
          </div>
          )}
        </div>

        {/* ── BIG STAT TILES (Points + Cashback) ── */}
        <section
          aria-label="Rewards summary"
          aria-busy={statsLoading}
          className="px-5 mt-3.5 grid grid-cols-2 gap-3"
        >
          {statsLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <BigStatTile
                tone="orange"
                icon={Sparkles}
                value={String(stats.txnCount * 10)}
                label="TWPoints"
              />
              <BigStatTile
                tone="green"
                icon={IndianRupee}
                value={`₹${Math.round(stats.totalSpent * 0.01).toLocaleString("en-IN")}`}
                label="Cashback"
              />
            </>
          )}
        </section>


        {/* ── TABS ── */}
        <div className="px-5 mt-5">
          <div className="pp-tabs" role="tablist" aria-label="Profile sections">
            {(["overview", "account", "security", "preferences", "support"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                id={`pp-tab-${t}`}
                aria-controls={`pp-panel-${t}`}
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                className={`pp-tab ${tab === t ? "pp-tab-active" : ""}`}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB CONTENT ── */}
        <div
          className="px-5 mt-4 space-y-3"
          role="tabpanel"
          id={`pp-panel-${tab}`}
          aria-labelledby={`pp-tab-${tab}`}
        >
          {tab === "overview" && (
            <>
              {/* Profile completion — phone, email, DOB, gender, KYC */}
              <ProfileCompletionMeter
                profile={profile ? {
                  phone: profile.phone, email: profile.email, dob: profile.dob,
                  gender: profile.gender, kyc_status: profile.kyc_status,
                } : null}
                loading={profileLoading}
                onCompleteClick={(key) => {
                  if (key === "phone") setEditPhoneOpen(true);
                  else setTab("account");
                }}
              />

              {/* Rewards group — claimed cashback + vouchers */}
              <p className="pp-group-label">Rewards</p>
              <div className="pp-card divide-y divide-white/5">
                <Row
                  icon={IndianRupee}
                  label="Claimed Cashback"
                  hint={
                    <span className="text-emerald-300 num-mono font-semibold">
                      ₹{Math.round(stats.totalSpent * 0.01).toLocaleString("en-IN")}
                    </span>
                  }
                  onClick={() => toast.success("Cashback wallet", { description: `You've earned ₹${Math.round(stats.totalSpent * 0.01).toLocaleString("en-IN")} so far. Keep paying to unlock more.` })}
                />
                <Row
                  icon={Ticket}
                  label="My Vouchers"
                  hint={<span className="text-amber-300 font-semibold">3 active</span>}
                  onClick={() => toast("Vouchers", { description: "Amazon ₹100 · Zomato 20% off · Myntra ₹250" })}
                />
                <Row
                  icon={Users}
                  label="Referral Program"
                  hint={<span className="text-fuchsia-300 font-semibold">Invite & earn</span>}
                  onClick={() => setReferralOpen(true)}
                />
              </div>

              {/* UPI group */}
              <p className="pp-group-label">UPI</p>
              <div className="pp-card divide-y divide-white/5">
                <Row
                  icon={Settings}
                  label="Account management"
                  hint="Profile · KYC"
                  onClick={() => setTab("account")}
                />
                <Row icon={Receipt} label="Transaction history" onClick={() => { onTransactions?.(); }} />
                <Row
                  icon={Wallet}
                  label="Everything UPI"
                  hint="Manage"
                  onClick={() => toast("Everything UPI", { description: "Manage UPI handles, autopay & limits — launching soon." })}
                />
              </div>

              {/* Education & Social */}
              <p className="pp-group-label">About you</p>
              <div className="pp-card divide-y divide-white/5">
                <Row
                  icon={Cake}
                  label="Birthday"
                  hint={
                    <span className="text-white/70">
                      {profile?.dob ? formatBirthday(profile.dob) : "Add"}
                    </span>
                  }
                  onClick={() => setTab("account")}
                />
                <Row
                  icon={GraduationCap}
                  label="School / College"
                  hint={
                    <span className="text-white/70 truncate max-w-[140px] inline-block">
                      {profile?.school_name || "Add"}
                    </span>
                  }
                  onClick={() => setSchoolOpen(true)}
                />
                <Row
                  icon={Instagram}
                  label="Connect Instagram"
                  hint={
                    instagram ? (
                      <span className="text-pink-300 font-medium">@{instagram}</span>
                    ) : (
                      <span className="text-white/55">Not linked</span>
                    )
                  }
                  onClick={() => setIgOpen(true)}
                />
              </div>

              {/* Shop group */}
              <p className="pp-group-label">Shop</p>
              <div className="pp-card divide-y divide-white/5">
                <Row
                  icon={Gift}
                  label="Orders"
                  hint="0 active"
                  onClick={() => toast("Orders", { description: "Your TeenWallet shop orders will appear here." })}
                />
                <Row
                  icon={Star}
                  label="Wishlist"
                  hint="Empty"
                  onClick={() => toast("Wishlist", { description: "Save items you love — coming with the shop launch." })}
                />
                <Row
                  icon={Building2}
                  label="Saved address"
                  hint="Add"
                  onClick={() => toast("Saved address", { description: "Add delivery & billing addresses — launching soon." })}
                />
              </div>

              {/* Promo card */}
              <p className="pp-group-label">YES Bank POP RuPay credit card</p>
              <div className="pp-card">
                <button
                  type="button"
                  onClick={() => toast.success("You're on the waitlist!", { description: "We'll notify you when the YES Bank POP RuPay credit card opens up." })}
                  className="w-full px-3.5 py-3.5 flex items-center gap-3 hover:bg-white/[.02] transition-colors text-left"
                >
                  <div className="pp-row-icon"><CreditCard className="w-4 h-4 text-amber-300" strokeWidth={2} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white font-medium">Apply now</p>
                    <p className="text-[11px] text-amber-300/90 mt-0.5">⚡ Earn 5% TWPoints</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>
              </div>

              {/* Recharges & Bills */}
              <p className="pp-group-label">Recharges & Bills</p>
              <div className="pp-card divide-y divide-white/5">
                <Row
                  icon={Receipt}
                  label="Pay bills"
                  hint="Electricity · DTH · Gas"
                  onClick={() => toast("Pay bills", { description: "Bill payments for utilities are launching soon." })}
                />
                <Row
                  icon={Gift}
                  label="Rewards"
                  hint={<span className="text-emerald-300">New</span>}
                  onClick={() => toast.success("Your rewards", { description: `You've earned ₹${Math.round(stats.totalSpent * 0.01).toLocaleString("en-IN")} in cashback so far.` })}
                />
              </div>

              {/* Settings shortcuts */}
              <p className="pp-group-label">Settings</p>
              <div className="pp-card divide-y divide-white/5">
                <Row icon={Bell} label="Notifications" hint="Manage" onClick={() => setTab("preferences")} />
                <Row icon={Lock} label="Privacy Policy" onClick={() => goTo("/preview/privacy")} />
                <Row icon={FileText} label="Terms & Conditions" onClick={() => goTo("/preview/terms")} />
              </div>

              {/* Others */}
              <p className="pp-group-label">Others</p>
              <div className="pp-card divide-y divide-white/5">
                <Row icon={HelpCircle} label="Help & Support" onClick={() => goTo("/preview/profile-help")} />
                <Row icon={Star} label="Rate us" onClick={() => toast.success("Thanks for the love! ❤️")} />
                <Row icon={LogOut} label="Logout" onClick={() => setConfirmLogout(true)} />
              </div>

              <p className="text-center text-[10.5px] text-white/35 pt-3 pb-1">v1.0.6</p>
            </>
          )}

          {tab === "account" && (
            profileLoading ? (
              <SectionSkeleton title="Personal details" rows={5} />
            ) : (
              <>
                <CollapsibleSection
                  id="ac-personal"
                  title="Personal details"
                  defaultOpen
                  isOpen={isOpen("ac-personal", true)}
                  onToggle={() => toggleSection("ac-personal", true)}
                >
                  {profile && (
                    <InlineEditCard
                      profile={{
                        full_name: profile.full_name,
                        email: profile.email,
                        dob: profile.dob,
                        gender: profile.gender,
                      }}
                      userId={userId}
                      onSaved={(p) => setProfile((prev) => prev ? { ...prev, ...p } : prev)}
                    />
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  id="ac-contact"
                  title="Contact & identity"
                  defaultOpen
                  isOpen={isOpen("ac-contact", true)}
                  onToggle={() => toggleSection("ac-contact", true)}
                >
                  <DetailRow icon={Smartphone} label="Phone" value={phone} onEdit={() => setEditPhoneOpen(true)} />
                  <DetailRow icon={Cake} label="Birthday" value={profile?.dob ? formatBirthday(profile.dob) : "Not added"} />
                  <DetailRow icon={ShieldCheck} label="Aadhaar" value={profile?.aadhaar_last4 ? `XXXX XXXX ${profile.aadhaar_last4}` : "Not added"} />
                  <DetailRow icon={BadgeCheck} label="KYC status" value={kycMeta.label} />
                </CollapsibleSection>

                <CollapsibleSection
                  id="ac-kyc-timeline"
                  title="KYC timeline"
                  defaultOpen
                  isOpen={isOpen("ac-kyc-timeline", true)}
                  onToggle={() => toggleSection("ac-kyc-timeline", true)}
                >
                  <div className="px-3.5 py-3.5">
                    <KycTimeline
                      userId={userId}
                      currentStatus={kyc}
                      onStatusChange={(s) => setProfile((prev) => prev ? { ...prev, kyc_status: s } : prev)}
                    />
                  </div>
                </CollapsibleSection>
              </>
            )
          )}

          {tab === "security" && (
            <>
              <CollapsibleSection
                id="se-security"
                title="Security"
                defaultOpen
                isOpen={isOpen("se-security", true)}
                onToggle={() => toggleSection("se-security", true)}
              >
                <Row
                  icon={Lock}
                  label="App Lock"
                  hint={appLockStatus?.enabled ? (appLockStatus.biometric_enrolled ? "PIN + Biometric" : "PIN only") : "Off"}
                  onClick={() => setAppLockOpen(true)}
                />
                <ToggleRow icon={Sparkles} label="Biometric login" desc="Face / Fingerprint" value={prefs.biometric} onChange={(v) => setPrefs({ ...prefs, biometric: v })} />
                <Row
                  icon={Smartphone}
                  label="Trusted devices"
                  hint={trustedDeviceCount === null ? "—" : `${trustedDeviceCount} active`}
                  onClick={() => setTrustedDevicesOpen(true)}
                />
                <Row icon={Activity} label="Login activity" hint="Last 30 days" />
              </CollapsibleSection>
              <CollapsibleSection
                id="se-limits"
                title="Limits"
                defaultOpen={false}
                isOpen={isOpen("se-limits", false)}
                onToggle={() => toggleSection("se-limits", false)}
              >
                <DetailRow icon={IndianRupee} label="Daily limit" value="₹10,000" onEdit={() => {}} />
                <DetailRow icon={IndianRupee} label="Per transaction" value="₹5,000" onEdit={() => {}} />
              </CollapsibleSection>
            </>
          )}

          {tab === "preferences" && (
            <>
              <CollapsibleSection
                id="pr-notifs"
                title="Notification preferences"
                defaultOpen
                isOpen={isOpen("pr-notifs", true)}
                onToggle={() => toggleSection("pr-notifs", true)}
              >
                {profile && (
                  <NotificationPrefs
                    userId={userId}
                    initial={profile.notif_prefs}
                    email={profile.email}
                  />
                )}
              </CollapsibleSection>

              <CollapsibleSection
                id="pr-app"
                title="App preferences"
                defaultOpen={false}
                isOpen={isOpen("pr-app", false)}
                onToggle={() => toggleSection("pr-app", false)}
              >
                <ToggleRow icon={Moon} label="Dark mode" desc="Follow app theme" value={prefs.darkMode} onChange={(v) => setPrefs({ ...prefs, darkMode: v })} />
                <ToggleRow icon={Sparkles} label="Sounds & haptics" desc="Feedback on actions" value={prefs.sounds} onChange={(v) => setPrefs({ ...prefs, sounds: v })} />
                <Row icon={Languages} label="Language" hint={prefs.lang} />
              </CollapsibleSection>

              <CollapsibleSection
                id="pr-motion"
                title="Motion & animations"
                defaultOpen={false}
                isOpen={isOpen("pr-motion", false)}
                onToggle={() => toggleSection("pr-motion", false)}
              >
                <MotionPrefs />
              </CollapsibleSection>
            </>
          )}

          {tab === "support" && (
            <>
              <CollapsibleSection
                id="su-help"
                title="Help & support"
                defaultOpen
                isOpen={isOpen("su-help", true)}
                onToggle={() => toggleSection("su-help", true)}
              >
                <Row
                  icon={HelpCircle}
                  label="Help center"
                  hint="My reports & shake settings"
                  onClick={() => goTo("/preview/profile-help")}
                />
                <Row
                  icon={FileText}
                  label="Terms of service"
                  onClick={() => goTo("/preview/terms")}
                />
                <Row
                  icon={FileText}
                  label="Privacy policy"
                  onClick={() => goTo("/preview/privacy")}
                />
                <Row icon={Settings} label="App version" hint="v1.0.6" />
              </CollapsibleSection>
              <CollapsibleSection
                id="su-danger"
                title="Danger zone"
                defaultOpen={false}
                isOpen={isOpen("su-danger", false)}
                onToggle={() => toggleSection("su-danger", false)}
              >
                <button onClick={() => setConfirmLogout(true)} className="w-full px-3.5 py-3.5 flex items-center gap-3 hover:bg-white/[.02] transition-colors">
                  <div className="pp-row-icon bg-red-400/10"><LogOut className="w-4 h-4 text-red-300" strokeWidth={2} /></div>
                  <span className="text-[13px] text-red-300 flex-1 text-left">Log out</span>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>
                <button onClick={() => setConfirmDelete(true)} className="w-full px-3.5 py-3.5 flex items-center gap-3 hover:bg-white/[.02] transition-colors border-t border-white/5">
                  <div className="pp-row-icon bg-red-400/10"><Trash2 className="w-4 h-4 text-red-300" strokeWidth={2} /></div>
                  <span className="text-[13px] text-red-300 flex-1 text-left">Delete account</span>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>
              </CollapsibleSection>
            </>
          )}
        </div>
      </div>

      {editPhoneOpen && profile && (
        <EditPhoneSheet
          initial={profile.phone}
          userId={userId}
          onClose={() => setEditPhoneOpen(false)}
          onSaved={(newPhone) => { setProfile((prev) => prev ? { ...prev, phone: newPhone } : prev); setEditPhoneOpen(false); }}
        />
      )}
      {qrOpen && (
        <MyQrSheet upiId={upiId} payeeName={profile?.full_name ?? fullName ?? "TeenWallet user"} onClose={() => setQrOpen(false)} />
      )}
      {confirmLogout && (
        <ConfirmSheet
          title="Log out?"
          desc="You'll need to sign in again to use TeenWallet."
          confirmLabel="Log out"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={onLogout}
        />
      )}
      {confirmDelete && (
        <DeleteAccountSheet
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => { setConfirmDelete(false); await onDeleteAccount(); }}
        />
      )}
      {vcardOpen && <VirtualCardModal onClose={() => setVcardOpen(false)} />}
      {referralOpen && (
        <div className="absolute inset-0 z-50 bg-[#0B0B0B] flex flex-col">
          <ReferralProgram onBack={() => setReferralOpen(false)} />
        </div>
      )}
      {igOpen && (
        <InstagramSheet
          initial={instagram}
          onClose={() => setIgOpen(false)}
          onSaved={(handle) => { setInstagram(handle); setIgOpen(false); toast.success(handle ? `Connected @${handle}` : "Instagram unlinked"); }}
        />
      )}
      {schoolOpen && (
        <SchoolSheet
          initial={profile?.school_name ?? ""}
          userId={userId}
          onClose={() => setSchoolOpen(false)}
          onSaved={(name) => { setProfile((prev) => prev ? { ...prev, school_name: name } : prev); setSchoolOpen(false); }}
        />
      )}

      {appLockOpen && <AppLockSettings onBack={() => setAppLockOpen(false)} />}
      {trustedDevicesOpen && <TrustedDevices onBack={() => setTrustedDevicesOpen(false)} />}

      {/* Pinned floating dock — Home & Profile share the same dock so the
          QR scan FAB is always one tap away. Hidden when any modal is open. */}
      <FloatingDock
        active="profile"
        onHome={onClose}
        hidden={editPhoneOpen || qrOpen || confirmLogout || confirmDelete || vcardOpen || referralOpen || igOpen || schoolOpen || appLockOpen}
      />
    </div>
  );
}

/* ───────── Virtual Card "Under Construction" modal ───────── */

function VirtualCardModal({ onClose }: { onClose: () => void }) {
  // Lock body scroll + close on ESC for accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vcard-title"
      aria-describedby="vcard-desc"
      className="absolute inset-0 z-[80] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm tw-fade-in" />
      <div
        className="relative w-full max-w-[420px] mx-3 mb-3 sm:mb-0 rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,.7)] tw-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mini virtual card preview */}
        <div className="relative mx-auto mb-5 aspect-[1.6/1] w-full max-w-[300px] rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-br from-primary/30 via-zinc-900 to-zinc-950 vcard-shimmer">
          <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(200,241,53,.35), transparent 60%)" }} />
          <div className="absolute top-3 left-4 text-[10px] font-bold tracking-[.2em] text-white/80">TEEN WALLET</div>
          <div className="absolute top-3 right-4 text-[10px] font-bold text-amber-300 px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30">SOON</div>
          <div className="absolute bottom-12 left-4 right-4 text-[15px] num-mono text-white/90 tracking-[.18em]">•••• •••• •••• ••••</div>
          <div className="absolute bottom-3 left-4 text-[9px] text-white/55 uppercase tracking-wider">Cardholder<br/><span className="text-white/85 normal-case text-[11px]">Coming Soon</span></div>
          <div className="absolute bottom-3 right-4 text-[9px] text-white/55 uppercase tracking-wider text-right">Valid<br/><span className="text-white/85 text-[11px]">••/••</span></div>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 mb-3">
            <Sparkles className="w-3 h-3 text-amber-300" strokeWidth={2.4} />
            <span className="text-[10.5px] font-semibold text-amber-300 tracking-wide">UNDER CONSTRUCTION</span>
          </div>
          <h3 id="vcard-title" className="text-white text-[18px] font-bold tracking-tight">Virtual Card is on the way</h3>
          <p id="vcard-desc" className="mt-2 text-[12.5px] text-white/65 leading-relaxed max-w-[300px] mx-auto">
            We're building a tap-to-pay virtual card you can use anywhere Mastercard is accepted — with instant freeze, custom limits, and rich rewards. We'll notify you the moment it's live.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { toast.success("You're on the waitlist!", { description: "We'll notify you when Virtual Card launches." }); onClose(); }}
            className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-[14px] hover:opacity-95 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Notify me when it's ready
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl text-[13px] text-white/60 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── building blocks ───────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useMemo(
    () => `pp-sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    [title],
  );
  return (
    <section aria-labelledby={id}>
      <p id={id} className="pp-section-title">{title}</p>
      <div className="pp-card divide-y divide-white/5">{children}</div>
    </section>
  );
}

function StatChip({ icon: Icon, label, value, tint }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; value: string; tint: string }) {
  return (
    <div className={`pp-statchip bg-gradient-to-br ${tint}`}>
      <Icon className="w-4 h-4 text-white/85" strokeWidth={2} />
      <p className="text-[10px] text-white/55 uppercase tracking-wider mt-1.5">{label}</p>
      <p className="text-[14px] text-white font-semibold num-mono mt-0.5 truncate">{value}</p>
    </div>
  );
}

function BigStatTile({
  tone, icon: Icon, value, label,
}: {
  tone: "orange" | "green";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  value: string;
  label: string;
}) {
  return (
    <div className={`pp-bigstat pp-bigstat-${tone}`}>
      <div className="pp-bigstat-shine" aria-hidden="true" />
      <div className={`pp-bigstat-icon pp-bigstat-icon-${tone}`}>
        <Icon className="w-4 h-4 text-white" strokeWidth={2.4} />
      </div>
      <div className="flex flex-col">
        <p className="text-white text-[18px] font-bold num-mono leading-none">{value}</p>
        <p className="text-[11px] text-white/80 font-medium mt-1">{label}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-white/55 ml-auto self-center" />
    </div>
  );
}

function Row({ icon: Icon, label, hint, onClick }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; hint?: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-3.5 py-3.5 flex items-center gap-3 hover:bg-white/[.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
      <div className="pp-row-icon"><Icon className="w-4 h-4 text-white/85" strokeWidth={2} /></div>
      <span className="text-[13px] text-white flex-1 text-left">{label}</span>
      {hint && <span className="text-[11.5px] text-white/55">{hint}</span>}
      <ChevronRight className="w-4 h-4 text-white/30" />
    </button>
  );
}

function DetailRow({ icon: Icon, label, value, onEdit }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="px-3.5 py-3.5 flex items-center gap-3">
      <div className="pp-row-icon"><Icon className="w-4 h-4 text-white/80" strokeWidth={2} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-white/50">{label}</p>
        <p className="text-[13px] text-white truncate">{value}</p>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="text-[11px] text-primary px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">Edit</button>
      )}
    </div>
  );
}

function ToggleRow({ icon: Icon, label, desc, value, onChange }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="px-3.5 py-3.5 flex items-center gap-3">
      <div className="pp-row-icon"><Icon className="w-4 h-4 text-white/85" strokeWidth={2} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white">{label}</p>
        {desc && <p className="text-[11px] text-white/50 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)} aria-pressed={value} className={`pp-switch ${value ? "pp-switch-on" : ""}`}>
        <span className="pp-switch-knob" />
      </button>
    </div>
  );
}

/* ───────── Edit phone sheet (focused single-field editor) ───────── */

function EditPhoneSheet({
  initial, userId, onClose, onSaved,
}: {
  initial: string | null;
  userId: string | null;
  onClose: () => void;
  onSaved: (newPhone: string) => void;
}) {
  const [phone, setPhone] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const digits = phone.replace(/\D/g, "");
    if (!/^[0-9]{10,15}$/.test(digits)) { setErr("Enter a valid phone number"); return; }
    const normalised = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    if (!userId) { setErr("Please sign in again"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ phone: normalised }).eq("id", userId);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    toast.success("Phone updated");
    onSaved(normalised);
  };

  return (
    <div
      className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-phone-title"
    >
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <p id="pp-phone-title" className="text-[15px] font-semibold text-white px-1">Update phone</p>
        <p className="text-[12px] text-white/55 px-1 mt-0.5 mb-4">We'll use this for OTPs and payment alerts.</p>
        <label className="pp-field">
          <span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" inputMode="tel" autoComplete="tel" maxLength={18} autoFocus />
          {err && <p className="pp-field-err">{err}</p>}
        </label>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="pp-btn-primary flex-1 disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Section (always expanded — collapse removed for clarity) ───────── */

function CollapsibleSection({
  id, title, children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;
  return (
    <section aria-labelledby={headerId}>
      <h3 id={headerId} className="pp-section-title flex items-center justify-between w-full">
        <span>{title}</span>
      </h3>
      <div id={panelId} role="region" aria-labelledby={headerId} className="pp-card divide-y divide-white/5">
        {children}
      </div>
    </section>
  );
}

/** Format a stored DOB ("YYYY-MM-DD") as a friendly birthday with age. */
function formatBirthday(dob: string): string {
  // Parse as local date to avoid TZ shifting (DOB is a calendar date, not an instant)
  const [y, m, d] = dob.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dob;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return dob;
  const pretty = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBday = today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d);
  if (beforeBday) age -= 1;
  return age >= 0 && age < 130 ? `${pretty} · ${age}y` : pretty;
}

/* ───────── My QR sheet ───────── */
function MyQrSheet({ upiId, payeeName, onClose }: { upiId: string; payeeName: string; onClose: () => void }) {
  const upiLink = useMemo(
    () => `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&cu=INR`,
    [upiId, payeeName],
  );
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const { dark, light } = qrColors();
    QRCode.toDataURL(upiLink, { errorCorrectionLevel: "M", margin: 2, width: 320, color: { dark, light } })
      .then((url) => { if (active) setDataUrl(url); })
      .catch((e: unknown) => { if (active) setErr(e instanceof Error ? e.message : "Couldn't generate QR"); });
    return () => { active = false; };
  }, [upiLink]);

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `teenwallet-${upiId.replace(/[^a-z0-9]/gi, "_")}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    toast.success("QR saved to downloads");
  };

  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: "Pay me on TeenWallet", text: `Pay ${payeeName} via UPI`, url: upiLink }); return; }
      await navigator.clipboard.writeText(upiLink);
      toast.success("Payment link copied");
    } catch { /* user cancelled */ }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center pp-qr-backdrop p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="pp-qr-title">
      <div className="pp-qr-card hp-shimmer-reveal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-1 mb-3">
          <p id="pp-qr-title" className="text-[15px] font-semibold text-white">My UPI QR</p>
          <button onClick={onClose} aria-label="Close" className="qa-icon-btn"><X className="w-4 h-4 text-white/80" /></button>
        </div>
        <div className="flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-2xl">
            {dataUrl ? <img src={dataUrl} alt="UPI QR code" width={240} height={240} className="block rounded-md" /> : <div className="w-[240px] h-[240px] rounded-md bg-neutral-200 animate-pulse" />}
          </div>
          <p className="mt-4 text-[13px] text-white font-medium">{payeeName}</p>
          <p className="text-[12px] text-white/60 num-mono">{upiId}</p>
          {err && <p className="text-[12px] text-red-300 mt-2">{err}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={download} disabled={!dataUrl} className="pp-btn-ghost flex-1 disabled:opacity-50"><Download className="w-4 h-4 inline -mt-0.5 mr-1.5" /> Save</button>
          <button onClick={share} className="pp-btn-primary flex-1"><Share2 className="w-4 h-4 inline -mt-0.5 mr-1.5" /> Share</button>
        </div>
        <p className="text-[11px] text-white/45 text-center mt-3">Scan this QR in any UPI app to pay you instantly.</p>
      </div>
    </div>
  );
}

/* ───────── Confirm + Delete sheets ───────── */
function ConfirmSheet({ title, desc, confirmLabel, danger, onCancel, onConfirm }: { title: string; desc: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onCancel} role="alertdialog" aria-modal="true" aria-labelledby="pp-confirm-title" aria-describedby="pp-confirm-desc">
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <p id="pp-confirm-title" className="text-[16px] font-semibold text-white">{title}</p>
        <p id="pp-confirm-desc" className="text-[12.5px] text-white/60 mt-1">{desc}</p>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={onConfirm} className={`flex-1 ${danger ? "pp-btn-danger" : "pp-btn-primary"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = text.trim().toUpperCase() === "DELETE";
  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onCancel} role="alertdialog" aria-modal="true" aria-labelledby="pp-del-title" aria-describedby="pp-del-desc">
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-9 h-9 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center" aria-hidden="true">
            <AlertTriangle className="w-4 h-4 text-red-300" strokeWidth={2.2} />
          </div>
          <p id="pp-del-title" className="text-[16px] font-semibold text-white">Delete your account?</p>
        </div>
        <p id="pp-del-desc" className="text-[12.5px] text-white/65 mt-2 px-1">This permanently removes your profile, transactions, notifications and KYC records. Your wallet balance will be lost.</p>
        <label className="pp-field">
          <span>Type DELETE to confirm</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" autoCapitalize="characters" />
        </label>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }} disabled={!ok || busy} className="pp-btn-danger flex-1 disabled:opacity-50">
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── skeletons ───────── */
function HeroSkeleton() {
  return (
    <div className="pp-hero" aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading your profile…</span>
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl pp-skel" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="pp-skel-line w-2/3" />
          <div className="pp-skel-line w-1/3 h-2.5" />
          <div className="h-5 w-28 rounded-full pp-skel mt-2.5" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="pp-skel-2 h-[68px] p-3" />
        <div className="pp-skel-2 h-[68px] p-3" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="h-10 rounded-2xl pp-skel" />
        <div className="h-10 rounded-2xl pp-skel" />
      </div>
    </div>
  );
}
function StatSkeleton() {
  return <div className="pp-statchip pp-skel-2 h-[78px] p-3" aria-hidden="true" />;
}
function SectionSkeleton({ title, rows = 4 }: { title: string; rows?: number }) {
  return (
    <section aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">Loading {title}…</span>
      <p className="pp-section-title">{title}</p>
      <div className="pp-card divide-y divide-white/5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-3.5 py-3.5 flex items-center gap-3" aria-hidden="true">
            <div className="w-9 h-9 rounded-xl pp-skel" />
            <div className="flex-1 space-y-1.5">
              <div className="pp-skel-line h-2 w-1/4" />
              <div className="pp-skel-line w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────── Instagram connect sheet ───────── */
function InstagramSheet({
  initial, onClose, onSaved,
}: {
  initial: string;
  onClose: () => void;
  onSaved: (handle: string) => void;
}) {
  const [handle, setHandle] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const clean = handle.trim().replace(/^@/, "");
    if (clean && !/^[a-zA-Z0-9._]{1,30}$/.test(clean)) {
      setErr("Letters, numbers, dot and underscore only");
      return;
    }
    onSaved(clean);
  };
  return (
    <div
      className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-ig-title"
    >
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <div className="flex items-center gap-2.5 px-1 mb-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-br from-pink-500/30 via-fuchsia-500/30 to-amber-400/30 border border-pink-300/30">
            <Instagram className="w-4 h-4 text-pink-200" strokeWidth={2.2} />
          </div>
          <div>
            <p id="pp-ig-title" className="text-[15px] font-semibold text-white">Connect Instagram</p>
            <p className="text-[11.5px] text-white/55 mt-0.5">Show off your handle on your TeenWallet card.</p>
          </div>
        </div>
        <label className="pp-field">
          <span>Instagram handle</span>
          <input
            value={handle}
            onChange={(e) => { setHandle(e.target.value); setErr(null); }}
            placeholder="yourhandle"
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={32}
            autoFocus
            inputMode="text"
          />
          {err && <p className="pp-field-err">{err}</p>}
        </label>
        <div className="flex gap-2 mt-5">
          {initial && (
            <button onClick={() => onSaved("")} className="pp-btn-ghost flex-1">Unlink</button>
          )}
          <button onClick={onClose} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={save} className="pp-btn-primary flex-1">Save</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── School / College edit sheet ───────── */
function SchoolSheet({
  initial, userId, onClose, onSaved,
}: {
  initial: string;
  userId: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const clean = name.trim().slice(0, 120);
    if (clean && clean.length < 2) { setErr("Enter at least 2 characters"); return; }
    if (!userId) { setErr("Please sign in again"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ school_name: clean || null })
      .eq("id", userId);
    setSaving(false);
    if (error) { setErr(error.message); toast.error("Couldn't save", { description: error.message }); return; }
    toast.success(clean ? "School updated" : "School cleared");
    onSaved(clean);
  };

  return (
    <div
      className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-school-title"
    >
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <div className="flex items-center gap-2.5 px-1 mb-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-sky-400/15 border border-sky-300/30">
            <GraduationCap className="w-4 h-4 text-sky-200" strokeWidth={2.2} />
          </div>
          <div>
            <p id="pp-school-title" className="text-[15px] font-semibold text-white">School / College</p>
            <p className="text-[11.5px] text-white/55 mt-0.5">Helps unlock student-only rewards.</p>
          </div>
        </div>
        <label className="pp-field">
          <span>Institution name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Delhi Public School, RK Puram"
            maxLength={120}
            autoFocus
          />
          {err && <p className="pp-field-err">{err}</p>}
        </label>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="pp-btn-primary flex-1 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 inline animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Motion / animation preferences
   ============================================================ */
const MOTION_OPTIONS: { value: MotionLevel; title: string; desc: string }[] = [
  { value: "full", title: "Full animations", desc: "Premium effects, perspective, particles." },
  { value: "reduced", title: "Reduced motion", desc: "Subtle fades only. Skips heavy effects." },
  { value: "off", title: "No motion", desc: "Static UI. Accessible & battery-friendly." },
];

function MotionPrefs() {
  const [level, setLevel] = useMotionLevel();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11.5px] text-white/55 px-1 -mt-1">
        Choose how lively the app feels. Applies everywhere — including the payment screen.
      </p>
      {MOTION_OPTIONS.map((opt) => {
        const active = level === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLevel(opt.value)}
            aria-pressed={active}
            className={`flex items-start gap-3 text-left rounded-xl px-3 py-3 border transition-colors ${
              active
                ? "bg-primary/10 border-primary/50"
                : "bg-white/5 border-white/10 hover:bg-white/8"
            }`}
          >
            <span
              aria-hidden
              className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                active ? "border-primary" : "border-white/30"
              }`}
            >
              {active && <span className="w-2 h-2 rounded-full bg-primary" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-[14px] font-semibold ${active ? "text-white" : "text-white/85"}`}>
                {opt.title}
              </span>
              <span className="block text-[11.5px] text-white/55 mt-0.5">{opt.desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
