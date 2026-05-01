/**
 * Standalone "Referral Program" screen.
 *
 * Reachable from the profile menu and the /preview/referral-program route.
 * Shows the user's own code, share/copy actions, lifetime stats, and a list
 * of friends who joined through them. If the user hasn't redeemed a friend's
 * code yet, an inline form lets them do so (same RPC as onboarding).
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft, Gift, Copy, Share2, Sparkles, Users, IndianRupee, Loader2, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import {
  fetchMyReferralStats, redeemReferralCode, type MyReferralStats,
} from "@/lib/referral";
import { haptics } from "@/lib/haptics";

interface Props { onBack: () => void }

export function ReferralProgram({ onBack }: Props) {
  const { userId } = useApp();
  const [stats, setStats] = useState<MyReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      const s = await fetchMyReferralStats(userId);
      if (!cancelled) { setStats(s); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const code = stats?.code ?? "";
  const shareUrl = code ? `https://teenwallet.app/?ref=${code}` : "";
  const shareText = code
    ? `Join me on TeenWallet — use my code ${code} and we both get a bonus 🎉 ${shareUrl}`
    : "";

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      void haptics.tap();
      toast.success("Code copied", { description: code });
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const share = async () => {
    if (!code) return;
    void haptics.tap();
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Join TeenWallet", text: shareText, url: shareUrl });
        return;
      } catch { /* user cancelled or share unsupported */ }
    }
    // Fallback: copy the rich share text
    try {
      await navigator.clipboard.writeText(shareText);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't share");
    }
  };

  const apply = async () => {
    const trimmed = redeemCode.trim().toUpperCase();
    if (trimmed.length < 4) { setRedeemError("Enter at least 4 characters"); return; }
    setRedeemBusy(true);
    setRedeemError(null);
    try {
      const res = await redeemReferralCode(trimmed);
      if (!res.ok) { setRedeemError(res.message); void haptics.tap(); return; }
      void haptics.swipe();
      toast.success(`₹${res.reward.toFixed(0)} bonus credited 🎉`);
      // Refresh stats so the redeemed code disappears from the form
      if (userId) setStats(await fetchMyReferralStats(userId));
      setRedeemCode("");
    } catch (e) {
      setRedeemError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRedeemBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0B0B] text-white overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0B0B0B]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            type="button"
            onClick={() => { void haptics.tap(); onBack(); }}
            aria-label="Back"
            className="w-9 h-9 rounded-full hover:bg-white/5 grid place-items-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[15px] font-semibold">Referral Program</h1>
        </div>
      </div>

      {/* Hero */}
      <div className="px-5 pt-6">
        <div className="rounded-3xl p-5 bg-gradient-to-br from-fuchsia-500/15 via-amber-300/10 to-emerald-400/10 border border-white/10 relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-amber-300/20 blur-3xl" aria-hidden />
          <div className="flex items-center gap-2 text-amber-300 text-[12px] font-medium mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            Invite & Earn
          </div>
          <h2 className="text-[22px] leading-tight font-bold mb-1">
            Get ₹25 for every friend
          </h2>
          <p className="text-[13px] text-white/65">
            Your friend gets ₹50 when they join with your code. Bonuses are credited instantly to both wallets.
          </p>
        </div>
      </div>

      {/* My code card */}
      <div className="px-5 mt-5">
        <p className="text-[11px] uppercase tracking-wider text-white/45 font-medium mb-2">
          Your code
        </p>
        <div className="rounded-2xl bg-white/[.04] border border-white/10 p-4">
          {loading ? (
            <div className="h-[68px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
            </div>
          ) : code ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[26px] tracking-[0.22em] text-white">
                  {code}
                </span>
                <button
                  type="button"
                  onClick={copy}
                  aria-label="Copy code"
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 grid place-items-center hover:bg-white/[.08] transition"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={share}
                className="mt-4 w-full h-11 rounded-2xl bg-gradient-to-r from-amber-300 to-fuchsia-400 text-black font-semibold flex items-center justify-center gap-2 active:scale-[.98] transition"
              >
                <Share2 className="w-4 h-4" /> Share invite
              </button>
            </>
          ) : (
            <p className="text-[13px] text-white/55">
              We couldn't generate your code. Please try again later.
            </p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 mt-5 grid grid-cols-2 gap-3">
        <StatTile
          icon={Users}
          label="Friends joined"
          value={loading ? "—" : String(stats?.totalReferred ?? 0)}
          tint="text-fuchsia-300"
        />
        <StatTile
          icon={IndianRupee}
          label="Total earned"
          value={loading ? "—" : `₹${(stats?.totalEarned ?? 0).toLocaleString("en-IN")}`}
          tint="text-amber-300"
        />
      </div>

      {!loading && stats?.redeemedCode && (
        <div className="px-5 mt-5">
          <div className="flex items-center gap-2 text-[12px] text-emerald-300 bg-emerald-300/10 border border-emerald-300/20 rounded-xl px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4" />
            You joined using code <span className="font-mono">{stats.redeemedCode}</span>
          </div>
        </div>
      )}

      {/* Invitees list */}
      <div className="px-5 mt-6 pb-10">
        <p className="text-[11px] uppercase tracking-wider text-white/45 font-medium mb-2">
          Friends you invited
        </p>
        <div className="rounded-2xl bg-white/[.04] border border-white/10 divide-y divide-white/5">
          {loading ? (
            <div className="h-[80px] flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
            </div>
          ) : (stats?.invitees.length ?? 0) === 0 ? (
            <div className="px-4 py-6 text-center">
              <Gift className="w-7 h-7 text-white/30 mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-[13px] text-white/60">No invites yet</p>
              <p className="text-[11px] text-white/40 mt-0.5">Share your code to start earning</p>
            </div>
          ) : (
            stats!.invitees.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-fuchsia-500/15 grid place-items-center">
                  <Users className="w-4 h-4 text-fuchsia-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-white truncate">
                    Friend · {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                  <p className="text-[11px] text-white/50 capitalize">{r.status}</p>
                </div>
                <span className="text-[13px] text-amber-300 font-semibold num-mono">
                  +₹{Number(r.referrer_reward).toLocaleString("en-IN")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon, label, value, tint,
}: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; value: string; tint: string }) {
  return (
    <div className="rounded-2xl bg-white/[.04] border border-white/10 p-4">
      <Icon className={`w-4 h-4 ${tint}`} strokeWidth={1.8} />
      <p className="text-[20px] font-semibold mt-2 num-mono">{value}</p>
      <p className="text-[11px] text-white/50 mt-0.5">{label}</p>
    </div>
  );
}
