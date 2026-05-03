import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage, type AccountType } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";


const Onboarding = lazyWithRetry(() => import("@/screens/Onboarding").then(m => ({ default: m.Onboarding })));
const AuthPhone = lazyWithRetry(() => import("@/screens/AuthPhone").then(m => ({ default: m.AuthPhone })));
const LinkGoogle = lazyWithRetry(() => import("@/screens/LinkGoogle").then(m => ({ default: m.LinkGoogle })));
const KycFlow = lazyWithRetry(() => import("@/screens/KycFlow").then(m => ({ default: m.KycFlow })));
const KycPending = lazyWithRetry(() => import("@/screens/KycPending").then(m => ({ default: m.KycPending })));
const Permissions = lazyWithRetry(() => import("@/screens/Permissions").then(m => ({ default: m.Permissions })));
const Home = lazyWithRetry(() => import("@/screens/Home").then(m => ({ default: m.Home })));
const OnboardingReferral = lazyWithRetry(() => import("@/screens/OnboardingReferral").then(m => ({ default: m.OnboardingReferral })));
const AccountTypeSelection = lazyWithRetry(() => import("@/screens/AccountTypeSelection").then(m => ({ default: m.AccountTypeSelection })));
const TeenDashboard = lazyWithRetry(() => import("@/screens/TeenDashboard").then(m => ({ default: m.TeenDashboard })));
const ParentDashboard = lazyWithRetry(() => import("@/screens/ParentDashboard").then(m => ({ default: m.ParentDashboard })));
const KycVerified = lazyWithRetry(() => import("@/screens/KycVerified").then(m => ({ default: m.KycVerified })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";
const SIGNUP_NEEDS_GOOGLE_KEY = "tw.signup.needsGoogleLink";

import { shouldShowReferralPrompt } from "@/lib/referral";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Teen Wallet — Payments built for India's new gen" },
      { name: "description", content: "India's first teen-first UPI wallet. Aadhaar-only KYC. Scan, pay, and earn rewards in seconds." },
    ],
  }),
  component: Index,
});

function ScreenFallback() {
  // Premium dark boot skeleton — graphite surfaces with a soft champagne
  // shimmer sweep. Mirrors the Home layout so the boot gate feels seamless.
  return (
    <div className="flex-1 flex flex-col gap-4 px-5 pt-8 pb-6 boot-slide-in">
      {/* Top bar: avatar + bell */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="boot-skel" style={{ width: 40, height: 40, borderRadius: 999 }} />
          <div className="flex flex-col gap-2">
            <div className="boot-skel" style={{ width: 96, height: 10, borderRadius: 6 }} />
            <div className="boot-skel" style={{ width: 64, height: 8, borderRadius: 6 }} />
          </div>
        </div>
        <div className="boot-skel" style={{ width: 38, height: 38, borderRadius: 14 }} />
      </div>

      {/* Balance card */}
      <div className="boot-skel boot-skel-card" style={{ height: 148, borderRadius: 22, marginTop: 6 }} />

      {/* Quick action tiles */}
      <div className="grid grid-cols-4 gap-3 mt-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="boot-skel" style={{ width: 60, height: 60, borderRadius: 16 }} />
            <div className="boot-skel" style={{ width: 44, height: 8, borderRadius: 6 }} />
          </div>
        ))}
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mt-2">
        <div className="boot-skel" style={{ width: 120, height: 12, borderRadius: 6 }} />
        <div className="boot-skel" style={{ width: 48, height: 10, borderRadius: 6 }} />
      </div>

      {/* Offer / activity rows */}
      <div className="flex flex-col gap-3">
        <div className="boot-skel boot-skel-row" />
        <div className="boot-skel boot-skel-row" />
        <div className="boot-skel boot-skel-row" />
      </div>

      <span className="sr-only" role="status" aria-live="polite">Loading your wallet…</span>
    </div>
  );
}

function Index() {
  const { stage, setStage, hydrateFromProfile, userId, accountType, setAccountType } = useApp();

  const stageRank: Record<Stage, number> = {
    STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
  };

  // Fast-boot: if we already have persisted state past pre-auth (or a known
  // userId), render the correct screen immediately and reconcile with the
  // backend in the background. Skeleton only shows on a true cold start.
  const hasPersistedSession =
    typeof window !== "undefined" &&
    (!!userId || stageRank[stage] >= stageRank["STAGE_3"]);
  const [booting, setBooting] = useState(!hasPersistedSession);

  // Safety net: if the auth session check hangs (common in native WebViews
  // on slow networks), force-unblock after a timeout so the user isn't stuck
  // on skeleton forever. They'll land on onboarding/STAGE_0 and can retry.
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => {
      console.warn("[boot] session check timed out — unblocking UI");
      setBooting(false);
    }, 6000);
    return () => clearTimeout(t);
  }, [booting]);

  const [permsSeen, setPermsSeen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
  });
  const markPermsSeen = () => {
    try { localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); } catch { /* ignore */ }
    setPermsSeen(true);
  };

  // Optional referral step shown once between Auth and Permissions/KYC.
  // The user can apply a code or skip; either way we mark it done so the
  // screen never reappears on subsequent launches.
  const [referralPending, setReferralPending] = useState<boolean>(() => shouldShowReferralPrompt());
  const markReferralDone = () => setReferralPending(false);

  // KYC celebration screen shown once when teen transitions STAGE_4 → STAGE_5
  const [showKycCelebration, setShowKycCelebration] = useState(false);

  // Mandatory Google-link step for fresh signups. Set by lib/auth.ts on
  // signUp() success; cleared once the user completes linking.
  const [needsGoogleLink, setNeedsGoogleLink] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(SIGNUP_NEEDS_GOOGLE_KEY) === "1"; } catch { return false; }
  });
  const markGoogleLinked = () => {
    try { localStorage.removeItem(SIGNUP_NEEDS_GOOGLE_KEY); } catch { /* ignore */ }
    setNeedsGoogleLink(false);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (!session) {
          // No session: ensure we don't show post-auth screens from stale persisted state.
          const localStage = useApp.getState().stage;
          if (stageRank[localStage] >= stageRank["STAGE_3"]) {
            useApp.getState().setStageLocal("STAGE_0");
          }
          setBooting(false);
          return;
        }
        // Session exists — make sure we don't flash Onboarding/AuthPhone while we
        // fetch the profile. Bump local stage out of pre-auth screens immediately.
        const localStage = useApp.getState().stage;
        if (localStage === "STAGE_0" || localStage === "STAGE_1" || localStage === "STAGE_2") {
          useApp.getState().setStageLocal("STAGE_3");
        }
        // Unblock UI immediately — fetch profile in the background and reconcile silently.
        if (mounted) setBooting(false);

        const p = await fetchProfile();
        if (!p || !mounted) return;
        const profileStage = (p.onboarding_stage as Stage) ?? "STAGE_0";
        const kyc = (p as { kyc_status?: string | null }).kyc_status ?? null;

        const curLocal = useApp.getState().stage;
        const moreAdvanced: Stage =
          stageRank[curLocal] >= stageRank[profileStage] ? curLocal : profileStage;

        let resolvedStage: Stage = moreAdvanced;
        if (kyc === "approved") resolvedStage = "STAGE_5";
        else if (kyc === "pending") {
          resolvedStage = stageRank[moreAdvanced] >= stageRank["STAGE_5"] ? "STAGE_5" : "STAGE_4";
        } else if (kyc === "rejected" && moreAdvanced === "STAGE_4") {
          resolvedStage = "STAGE_3";
        }

        hydrateFromProfile({
          id: p.id,
          full_name: p.full_name,
          balance: Number(p.balance),
          onboarding_stage: resolvedStage,
          account_type: (p as Record<string, unknown>).account_type as string | null,
        });

        if (resolvedStage !== profileStage) setStage(resolvedStage);
      } catch (err) {
        console.error("[boot] hydrate failed", err);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_OUT") return;
      if (session) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) return;
      } catch {
        return;
      }
      // Best-effort local cleanup so any component that signed out (Profile,
      // AppLockGate, VerifyGoogleOnNewDevice, etc.) reliably bounces back to
      // onboarding even if its own reset path failed mid-flight. Idempotent.
      try {
        const keysToClear: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("tw-") || k === "teenwallet-app")) keysToClear.push(k);
        }
        keysToClear.forEach((k) => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch { /* ignore */ }
      useApp.getState().reset();
      // Force the Index gate to re-evaluate immediately even if the Suspense
      // boundary above us is still resolving the previous screen.
      if (mounted) setBooting(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle-time prefetch — warm the most likely next screens so navigation
  // feels instant. Runs after first paint, never blocks rendering.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const idle = (cb: () => void) => {
      const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
      if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb);
      else setTimeout(cb, 600);
    };
    idle(() => {
      void import("@/screens/Home");
      void import("@/screens/Onboarding");
      void import("@/screens/AuthPhone");
    });
  }, []);

  return (
    <PhoneShell>
      <Suspense fallback={<ScreenFallback />}>
        {booting ? (
          <ScreenFallback />
        ) : stage === "STAGE_0" || stage === "STAGE_1" ? (
          <Onboarding onDone={() => {
            // Never downgrade — if persisted/profile-derived stage is already
            // past auth, resume there instead of forcing the user back to STAGE_2.
            const s = useApp.getState().stage;
            const rank: Record<Stage, number> = { STAGE_0:0, STAGE_1:1, STAGE_2:2, STAGE_3:3, STAGE_4:4, STAGE_5:5 };
            setStage(rank[s] >= rank["STAGE_2"] ? s : "STAGE_2");
          }} />
        ) : stage === "STAGE_2" ? (
          <AuthPhone onDone={() => {
            const s = useApp.getState().stage;
            const rank: Record<Stage, number> = { STAGE_0:0, STAGE_1:1, STAGE_2:2, STAGE_3:3, STAGE_4:4, STAGE_5:5 };
            // Resume to whichever is more advanced (persisted/profile vs STAGE_3).
            setStage(rank[s] > rank["STAGE_3"] ? s : "STAGE_3");
          }} />
        ) : needsGoogleLink && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <LinkGoogle onLinked={markGoogleLinked} />
        ) : referralPending && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <OnboardingReferral onDone={markReferralDone} />
        ) : !accountType && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <AccountTypeSelection onDone={(type) => setAccountType(type)} />
        ) : accountType === "parent" && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <ParentDashboard />
        ) : !permsSeen && (stage === "STAGE_3" || stage === "STAGE_4") ? (
          <Permissions onDone={() => { markPermsSeen(); }} />
        ) : stage === "STAGE_3" ? (
          <KycFlow onDone={() => setStage("STAGE_4")} />
        ) : stage === "STAGE_4" ? (
          <KycPending onApproved={() => {
            setStage("STAGE_5");
            if (accountType === "teen") setShowKycCelebration(true);
          }} />
        ) : showKycCelebration && accountType === "teen" ? (
          <KycVerified onContinue={() => setShowKycCelebration(false)} />
        ) : accountType === "teen" ? (
          <TeenDashboard />
        ) : (
          <Home />
        )}
      </Suspense>
    </PhoneShell>
  );
}
