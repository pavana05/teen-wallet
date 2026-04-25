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
    <div className="qa-root absolute inset-0 z-[60] flex flex-col bg-background overflow-hidden">
      <div className="qa-bg" />
      <div className="qa-grid" />
      <div className="pp-aurora" />

      {/* header */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
        <button onClick={onClose} aria-label="Back" className="qa-icon-btn">
          <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
        </button>
        <p className="text-[15px] font-semibold text-white tracking-tight">Profile</p>
        <button onClick={onClose} aria-label="Close" className="qa-icon-btn">
          <X className="w-5 h-5 text-white/80" strokeWidth={2} />
        </button>
      </div>

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
                <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${kycMeta.border} ${kycMeta.bg}`}>
                  <kycMeta.icon className={`w-3.5 h-3.5 ${kycMeta.color}`} strokeWidth={2.2} />
                  <span className={`text-[10.5px] font-medium ${kycMeta.color} tracking-wide`}>{kycMeta.label}</span>
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
        <div className="px-5 mt-4 grid grid-cols-3 gap-2.5">
          {statsLoading ? (
            <>
              <div className="pp-statchip pp-skel" />
              <div className="pp-statchip pp-skel" />
              <div className="pp-statchip pp-skel" />
            </>
          ) : (
            <>
              <StatChip icon={IndianRupee} label="This month" value={`₹${stats.monthSpent.toLocaleString("en-IN")}`} tint="from-orange-500/30 to-amber-500/10" />
              <StatChip icon={Activity} label="Transactions" value={String(stats.txnCount)} tint="from-violet-500/30 to-fuchsia-500/10" />
              <StatChip icon={TrendingUp} label="Success" value={`${stats.successRate}%`} tint="from-emerald-500/30 to-teal-500/10" />
            </>
          )}
        </div>

        {/* ── TABS ── */}
        <div className="px-5 mt-5">
          <div className="pp-tabs">
            {(["overview", "account", "security", "preferences", "support"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`pp-tab ${tab === t ? "pp-tab-active" : ""}`}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB CONTENT ── */}
        <div className="px-5 mt-4 space-y-3">
          {tab === "overview" && (
            <>
              <Section title="Quick links">
                <Row icon={Wallet} label="Wallet & balance" hint={`₹${Number(balance).toLocaleString("en-IN")}`} />
                <Row icon={CreditCard} label="Cards & accounts" hint="Manage" />
                <Row icon={Building2} label="Bank accounts" hint="Linked" />
                <Row icon={Gift} label="Rewards & cashback" hint={<span className="text-emerald-300">New</span>} />
                <Row icon={Users} label="Refer & earn" hint="₹100" />
              </Section>
              <Section title="Member since">
                <div className="px-3.5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="pp-row-icon"><Star className="w-4 h-4 text-amber-300" strokeWidth={2} /></div>
                    <div>
                      <p className="text-[13px] text-white">TeenWallet member</p>
                      <p className="text-[11px] text-white/50">Since {memberSince}</p>
                    </div>
                  </div>
                  <span className="text-[10.5px] text-amber-300 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/25">Gold</span>
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
    </div>
  );
}

/* ───────── building blocks ───────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-white/45 px-1 mb-2">{title}</p>
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

function Row({ icon: Icon, label, hint }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; hint?: React.ReactNode }) {
  return (
    <button className="w-full px-3.5 py-3.5 flex items-center gap-3 hover:bg-white/[.02] transition-colors">
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

/* ───────── edit sheet ───────── */
function EditProfileSheet({
  initial,
  onClose,
  onSaved,
}: {
  initial: { full_name: string | null; dob: string | null; gender: string | null };
  onClose: () => void;
  onSaved: (p: { full_name: string | null; dob: string | null; gender: string | null }) => void;
}) {
  const [name, setName] = useState(initial.full_name ?? "");
  const [dob, setDob] = useState(initial.dob ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await updateProfileFields({ full_name: name.trim() || null, dob: dob || null, gender: gender || null });
      // also reflect in zustand display
      useApp.setState({ fullName: name.trim() || null });
      onSaved({ full_name: name.trim() || null, dob: dob || null, gender: gender || null });
    } catch (e) {
      setErr((e as Error).message ?? "Could not save.");
    } finally { setSaving(false); }
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-end pp-sheet-backdrop" onClick={onClose}>
      <div className="pp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-grab" />
        <p className="text-[15px] font-semibold text-white px-1">Edit profile</p>
        <p className="text-[12px] text-white/55 px-1 mt-0.5 mb-4">Update your personal details</p>

        <label className="pp-field">
          <span>Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <label className="pp-field">
          <span>Date of birth</span>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
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
        </label>

        {err && <p className="text-[12px] text-red-300 mt-2">{err}</p>}

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
