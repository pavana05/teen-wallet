import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, X, QrCode, Copy, Check, ChevronRight, Pencil, Camera, ShieldCheck,
  ShieldAlert, BadgeCheck, Wallet, CreditCard, Building2, Bell, Lock, Smartphone,
  Eye, EyeOff, Languages, Moon, HelpCircle, FileText, LogOut, Star, Gift, Users,
  Settings, Sparkles, IndianRupee, Activity, Mail, MapPin, Cake,
  TrendingUp, Trash2, Share2, Download, AlertTriangle,
} from "lucide-react";
import { z } from "zod";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { logout } from "@/lib/auth";

interface Props {
  onClose: () => void;
}

type Tab = "overview" | "account" | "security" | "preferences" | "support";

interface Stats {
  totalSpent: number;
  txnCount: number;
  monthSpent: number;
  successRate: number;
}

export function ProfilePanel({ onClose }: Props) {
  const { fullName, userId, balance, reset } = useApp();
  const [tab, setTab] = useState<Tab>("overview");
  const [profile, setProfile] = useState<{
    full_name: string | null;
    phone: string | null;
    dob: string | null;
    gender: string | null;
    aadhaar_last4: string | null;
    kyc_status: "not_started" | "pending" | "approved" | "rejected";
    created_at: string;
  } | null>(null);
  const [stats, setStats] = useState<Stats>({ totalSpent: 0, txnCount: 0, monthSpent: 0, successRate: 100 });
  const [profileLoading, setProfileLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // Virtual Card is on the roadmap but not shipped yet. Tapping the section
  // opens a friendly "Under Construction" modal instead of dead-end clicks.
  const [vcardOpen, setVcardOpen] = useState(false);

  // preferences (local)
  const [prefs, setPrefs] = useState(() => {
    if (typeof window === "undefined") return { notifs: true, biometric: true, darkMode: true, lang: "English", sounds: true };
    try {
      const raw = localStorage.getItem("tw-profile-prefs");
      return raw ? JSON.parse(raw) : { notifs: true, biometric: true, darkMode: true, lang: "English", sounds: true };
    } catch { return { notifs: true, biometric: true, darkMode: true, lang: "English", sounds: true }; }
  });
  useEffect(() => { try { localStorage.setItem("tw-profile-prefs", JSON.stringify(prefs)); } catch {} }, [prefs]);

  const refetch = async () => {
    if (!userId) return;
    setProfileLoading(true); setStatsLoading(true); setProfileError(false);
    const [{ data: p, error: pErr }, { data: txns, error: tErr }] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name,phone,dob,gender,aadhaar_last4,kyc_status,created_at")
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
      setProfile(p as typeof profile);
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

  const onLogout = async () => {
    try {
      await logout();
      clearLocalState();
      reset();
      toast.success("Signed out");
      onClose();
    } catch (e) {
      toast.error("Couldn't sign out", { description: (e as Error).message });
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

      <div className="relative z-10 flex-1 overflow-y-auto pb-32 qa-enter">
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

        {/* ── HERO CARD ── */}
        <div className="px-5 mt-3">
          {profileLoading ? <HeroSkeleton /> : (
          <div className="pp-hero">
            <div className="pp-hero-shine" />
            <div className="flex items-start gap-4">
              <button onClick={() => setEditOpen(true)} className="pp-avatar-wrap" aria-label="Change photo">
                <div className="pp-avatar">{initials}</div>
                <span className="pp-avatar-cam"><Camera className="w-3.5 h-3.5 text-black" strokeWidth={2.4} /></span>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-white text-[17px] font-semibold truncate">{profile?.full_name ?? fullName ?? "Add your name"}</p>
                  <button onClick={() => setEditOpen(true)} className="text-white/60" aria-label="Edit name">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[12px] text-white/60 mt-0.5">{phone}</p>
                <div className={`pp-kyc-badge mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${kycMeta.border} ${kycMeta.bg}`}>
                  <kycMeta.icon className={`w-3.5 h-3.5 ${kycMeta.color}`} strokeWidth={2.2} />
                  <span className={`text-[10.5px] font-semibold ${kycMeta.color} tracking-wide`}>{kycMeta.label}</span>
                </div>
              </div>
            </div>

            {/* Balance + UPI ID row */}
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <div className="pp-stat">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] uppercase tracking-wider text-white/50">Wallet balance</span>
                  <button onClick={() => setHideBalance((v) => !v)} className="text-white/60" aria-label="Toggle balance">
                    {hideBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-white text-[18px] font-semibold num-mono mt-1">
                  {hideBalance ? "₹ ••••" : `₹${Number(balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                </p>
              </div>
              <button onClick={() => copy(upiId, "upi")} className="pp-stat text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] uppercase tracking-wider text-white/50">UPI ID</span>
                  {copied === "upi" ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 text-white/60" />}
                </div>
                <p className="text-white text-[13px] font-medium mt-1 truncate">{upiId}</p>
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => setQrOpen(true)} disabled={upiId === "—"} className="pp-pill flex-1 disabled:opacity-50">
                <QrCode className="w-4 h-4" strokeWidth={2} /> My QR
              </button>
              <button
                onClick={async () => {
                  if (upiId === "—") { toast.error("Add your phone number first"); return; }
                  const link = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(profile?.full_name ?? "TeenWallet user")}&cu=INR`;
                  if (navigator.share) {
                    try { await navigator.share({ title: "Pay me on TeenWallet", text: `Pay ${profile?.full_name ?? ""} via UPI`, url: link }); return; } catch { /* user cancelled */ return; }
                  }
                  await copy(link, "upi-link");
                  toast.success("Payment link copied");
                }}
                className="pp-pill flex-1"
              >
                {copied === "upi-link" ? <Check className="w-4 h-4 text-emerald-300" /> : <Share2 className="w-4 h-4" />}
                Share QR link
              </button>
            </div>
          </div>
          )}
        </div>

        {/* ── STATS STRIP ── */}
        <section
          aria-label="Account statistics"
          aria-busy={statsLoading}
          className="px-5 mt-4 grid grid-cols-3 gap-2.5"
        >
          {statsLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <StatChip icon={IndianRupee} label="This month" value={`₹${stats.monthSpent.toLocaleString("en-IN")}`} tint="from-white/10 to-white/[.02]" />
              <StatChip icon={Activity} label="Transactions" value={String(stats.txnCount)} tint="from-white/10 to-white/[.02]" />
              <StatChip icon={TrendingUp} label="Success" value={`${stats.successRate}%`} tint="from-white/10 to-white/[.02]" />
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
              <Section title="Quick links">
                <Row icon={Wallet} label="Wallet & balance" hint={`₹${Number(balance).toLocaleString("en-IN")}`} />
                <Row icon={CreditCard} label="Virtual Card" hint={<span className="text-amber-300">Coming soon</span>} onClick={() => setVcardOpen(true)} />
                <Row icon={Building2} label="Bank accounts" hint="Linked" />
                <Row icon={Gift} label="Rewards & cashback" hint={<span className="text-emerald-300">New</span>} />
                <Row icon={Users} label="Refer & earn" hint="₹100" />
              </Section>

              {/* Dedicated Virtual Card teaser — taps open the Under Construction modal */}
              <Section title="Virtual Card">
                <button
                  type="button"
                  onClick={() => setVcardOpen(true)}
                  aria-label="Open Virtual Card details"
                  className="w-full text-left px-3.5 py-3.5 flex items-center justify-between hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="pp-row-icon"><CreditCard className="w-4 h-4 text-primary" strokeWidth={2} /></div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-white">Get your Virtual Card</p>
                      <p className="text-[11px] text-white/50 truncate">Tap and pay anywhere — under construction</p>
                    </div>
                  </div>
                  <span className="text-[10.5px] font-semibold text-amber-300 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/25 shrink-0">SOON</span>
                </button>
              </Section>
              <Section title="Membership">
                <div className="px-3.5 py-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="pp-row-icon"><Star className="w-4 h-4 text-amber-300" strokeWidth={2} /></div>
                      <div>
                        <p className="text-[13px] text-white font-medium">Gold member</p>
                        <p className="text-[11px] text-white/50">Since {memberSince}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold tracking-wider text-amber-300 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/25">GOLD</span>
                  </div>
                  <div className="mt-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10.5px] text-white/55 uppercase tracking-wider">Progress to Platinum</span>
                      <span className="text-[10.5px] text-white/70 num-mono">{Math.min(100, Math.round((stats.txnCount / 50) * 100))}%</span>
                    </div>
                    <div className="pp-progress">
                      <div className="pp-progress-fill" style={{ width: `${Math.min(100, Math.round((stats.txnCount / 50) * 100))}%` }} />
                    </div>
                    <p className="text-[10.5px] text-white/45 mt-1.5">{Math.max(0, 50 - stats.txnCount)} more transactions to unlock Platinum perks</p>
                  </div>
                </div>
              </Section>
            </>
          )}

          {tab === "account" && (
            <>
              <Section title="Personal details">
                <DetailRow icon={Pencil} label="Full name" value={profile?.full_name ?? "—"} onEdit={() => setEditOpen(true)} />
                <DetailRow icon={Smartphone} label="Phone" value={phone} />
                <DetailRow icon={Cake} label="Date of birth" value={profile?.dob ?? "—"} onEdit={() => setEditOpen(true)} />
                <DetailRow icon={Mail} label="Email" value="—" onEdit={() => setEditOpen(true)} />
                <DetailRow icon={MapPin} label="Address" value="—" onEdit={() => setEditOpen(true)} />
              </Section>
              <Section title="Identity">
                <DetailRow icon={ShieldCheck} label="Aadhaar" value={profile?.aadhaar_last4 ? `XXXX XXXX ${profile.aadhaar_last4}` : "Not added"} />
                <DetailRow icon={BadgeCheck} label="KYC status" value={kycMeta.label} />
              </Section>
            </>
          )}

          {tab === "security" && (
            <>
              <Section title="Security">
                <ToggleRow icon={Lock} label="App lock (PIN)" desc="Require PIN every time" value={true} onChange={() => {}} />
                <ToggleRow icon={Sparkles} label="Biometric login" desc="Face / Fingerprint" value={prefs.biometric} onChange={(v) => setPrefs({ ...prefs, biometric: v })} />
                <Row icon={Smartphone} label="Trusted devices" hint="2 active" />
                <Row icon={Activity} label="Login activity" hint="Last 30 days" />
              </Section>
              <Section title="Limits">
                <DetailRow icon={IndianRupee} label="Daily limit" value="₹10,000" onEdit={() => {}} />
                <DetailRow icon={IndianRupee} label="Per transaction" value="₹5,000" onEdit={() => {}} />
              </Section>
            </>
          )}

          {tab === "preferences" && (
            <>
              <Section title="App preferences">
                <ToggleRow icon={Bell} label="Push notifications" desc="Payments, offers & alerts" value={prefs.notifs} onChange={(v) => setPrefs({ ...prefs, notifs: v })} />
                <ToggleRow icon={Moon} label="Dark mode" desc="Follow app theme" value={prefs.darkMode} onChange={(v) => setPrefs({ ...prefs, darkMode: v })} />
                <ToggleRow icon={Sparkles} label="Sounds & haptics" desc="Feedback on actions" value={prefs.sounds} onChange={(v) => setPrefs({ ...prefs, sounds: v })} />
                <Row icon={Languages} label="Language" hint={prefs.lang} />
              </Section>
            </>
          )}

          {tab === "support" && (
            <>
              <Section title="Help & support">
                <Row icon={HelpCircle} label="Help center" hint="FAQs & guides" />
                <Row icon={FileText} label="Terms of service" />
                <Row icon={FileText} label="Privacy policy" />
                <Row icon={Settings} label="App version" hint="v1.0.6" />
              </Section>
              <Section title="Danger zone">
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
              </Section>
            </>
          )}
        </div>
      </div>

      {editOpen && profile && (
        <EditProfileSheet
          initial={{
            full_name: profile.full_name,
            phone: profile.phone,
            dob: profile.dob,
            gender: profile.gender,
          }}
          userId={userId}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => { setProfile((prev) => prev ? { ...prev, ...p } : prev); setEditOpen(false); }}
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
  return (
    <div>
      <p className="pp-section-title">{title}</p>
      <div className="pp-card divide-y divide-white/5">{children}</div>
    </div>
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

/* ───────── edit sheet (validated + upserted to Supabase) ───────── */

const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be 80 characters or fewer")
    .regex(/^[\p{L}\p{M}.''\- ]+$/u, "Name can only contain letters, spaces, . - '"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{10,18}$/, "Enter a valid phone number")
    .transform((s) => {
      const digits = s.replace(/\D/g, "");
      // Normalise to +91XXXXXXXXXX when user types a 10-digit Indian number.
      return digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }),
  dob: z
    .string()
    .trim()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
    .refine((v) => {
      if (!v) return true;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const today = new Date();
      const age = (today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= 13 && age <= 120;
    }, "You must be 13 years or older"),
  gender: z.enum(["male", "female", "other", ""]).optional(),
});

type ProfileFormErrors = Partial<Record<"full_name" | "phone" | "dob" | "gender" | "_form", string>>;

function EditProfileSheet({
  initial,
  userId,
  onClose,
  onSaved,
}: {
  initial: { full_name: string | null; phone: string | null; dob: string | null; gender: string | null };
  userId: string | null;
  onClose: () => void;
  onSaved: (p: { full_name: string | null; phone: string | null; dob: string | null; gender: string | null }) => void;
}) {
  const [name, setName] = useState(initial.full_name ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [dob, setDob] = useState(initial.dob ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ProfileFormErrors>({});

  const save = async () => {
    setErrors({});
    const parsed = profileSchema.safeParse({ full_name: name, phone, dob, gender });
    if (!parsed.success) {
      const next: ProfileFormErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof ProfileFormErrors;
        if (k && !next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    if (!userId) {
      setErrors({ _form: "You're not signed in. Please sign in again." });
      return;
    }

    setSaving(true);
    const fields = {
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      dob: parsed.data.dob || null,
      gender: parsed.data.gender || null,
    };
    // Upsert so we always create a row if one is missing.
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, ...fields }, { onConflict: "id" });
    setSaving(false);
    if (error) {
      // Try to map Postgres errors to specific fields.
      const msg = error.message.toLowerCase();
      const fieldErr: ProfileFormErrors = {};
      if (msg.includes("phone")) fieldErr.phone = error.message;
      else if (msg.includes("name")) fieldErr.full_name = error.message;
      else fieldErr._form = error.message;
      setErrors(fieldErr);
      toast.error("Couldn't save changes", { description: error.message });
      return;
    }
    useApp.setState({ fullName: fields.full_name });
    toast.success("Profile updated");
    onSaved(fields);
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onClose}>
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <p className="text-[15px] font-semibold text-white px-1">Edit profile</p>
        <p className="text-[12px] text-white/55 px-1 mt-0.5 mb-4">Update your personal details</p>

        <label className="pp-field">
          <span>Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} autoComplete="name" />
          {errors.full_name && <p className="pp-field-err">{errors.full_name}</p>}
        </label>
        <label className="pp-field">
          <span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" inputMode="tel" autoComplete="tel" maxLength={18} />
          {errors.phone && <p className="pp-field-err">{errors.phone}</p>}
        </label>
        <label className="pp-field">
          <span>Date of birth</span>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
          {errors.dob && <p className="pp-field-err">{errors.dob}</p>}
        </label>
        <label className="pp-field">
          <span>Gender</span>
          <div className="flex gap-2 mt-1.5">
            {["male", "female", "other"].map((g) => (
              <button key={g} type="button" onClick={() => setGender(g)} className={`pp-chip ${gender === g ? "pp-chip-active" : ""}`}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          {errors.gender && <p className="pp-field-err">{errors.gender}</p>}
        </label>

        {errors._form && <p className="pp-field-err mt-3">{errors._form}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="pp-btn-primary flex-1 disabled:opacity-60">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
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
    QRCode.toDataURL(upiLink, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
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
      if (navigator.share) {
        await navigator.share({ title: "Pay me on TeenWallet", text: `Pay ${payeeName} via UPI`, url: upiLink });
        return;
      }
      await navigator.clipboard.writeText(upiLink);
      toast.success("Payment link copied");
    } catch { /* user cancelled */ }
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onClose}>
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <div className="flex items-center justify-between px-1 mb-3">
          <p className="text-[15px] font-semibold text-white">My UPI QR</p>
          <button onClick={onClose} aria-label="Close" className="qa-icon-btn"><X className="w-4 h-4 text-white/80" /></button>
        </div>

        <div className="flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-2xl">
            {dataUrl ? (
              <img src={dataUrl} alt="UPI QR code" width={240} height={240} className="block rounded-md" />
            ) : (
              <div className="w-[240px] h-[240px] rounded-md bg-neutral-200 animate-pulse" />
            )}
          </div>
          <p className="mt-4 text-[13px] text-white font-medium">{payeeName}</p>
          <p className="text-[12px] text-white/60 num-mono">{upiId}</p>
          {err && <p className="text-[12px] text-red-300 mt-2">{err}</p>}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={download} disabled={!dataUrl} className="pp-btn-ghost flex-1 disabled:opacity-50">
            <Download className="w-4 h-4 inline -mt-0.5 mr-1.5" /> Save
          </button>
          <button onClick={share} className="pp-btn-primary flex-1">
            <Share2 className="w-4 h-4 inline -mt-0.5 mr-1.5" /> Share
          </button>
        </div>
        <p className="text-[11px] text-white/45 text-center mt-3">Scan this QR in any UPI app to pay you instantly.</p>
      </div>
    </div>
  );
}

/* ───────── Delete account sheet (typed-confirmation) ───────── */
function DeleteAccountSheet({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = text.trim().toUpperCase() === "DELETE";
  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onCancel}>
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-9 h-9 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center">
            <AlertTriangle className="w-4.5 h-4.5 text-red-300" strokeWidth={2.2} />
          </div>
          <p className="text-[16px] font-semibold text-white">Delete your account?</p>
        </div>
        <p className="text-[12.5px] text-white/65 mt-2 px-1">
          This permanently removes your profile, transactions, notifications and KYC records.
          Your wallet balance will be lost. This action cannot be undone.
        </p>
        <label className="pp-field">
          <span>Type DELETE to confirm</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" autoCapitalize="characters" />
        </label>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="pp-btn-ghost flex-1">Cancel</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
            disabled={!ok || busy}
            className="pp-btn-danger flex-1 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmSheet({ title, desc, confirmLabel, danger, onCancel, onConfirm }: {
  title: string; desc: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onCancel}>
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <p className="text-[16px] font-semibold text-white">{title}</p>
        <p className="text-[12.5px] text-white/60 mt-1">{desc}</p>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="pp-btn-ghost flex-1">Cancel</button>
          <button onClick={onConfirm} className={`flex-1 ${danger ? "pp-btn-danger" : "pp-btn-primary"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── skeletons ───────── */
function HeroSkeleton() {
  return (
    <div className="pp-hero">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl pp-skel" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 rounded pp-skel" />
          <div className="h-3 w-1/3 rounded pp-skel" />
          <div className="h-5 w-24 rounded-full pp-skel mt-2" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="h-16 rounded-2xl pp-skel" />
        <div className="h-16 rounded-2xl pp-skel" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="h-10 rounded-2xl pp-skel" />
        <div className="h-10 rounded-2xl pp-skel" />
      </div>
    </div>
  );
}
