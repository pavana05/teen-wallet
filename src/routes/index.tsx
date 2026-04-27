import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";


const Onboarding = lazy(() => import("@/screens/Onboarding").then(m => ({ default: m.Onboarding })));
const AuthPhone = lazy(() => import("@/screens/AuthPhone").then(m => ({ default: m.AuthPhone })));
const KycFlow = lazy(() => import("@/screens/KycFlow").then(m => ({ default: m.KycFlow })));
const KycPending = lazy(() => import("@/screens/KycPending").then(m => ({ default: m.KycPending })));
const Permissions = lazy(() => import("@/screens/Permissions").then(m => ({ default: m.Permissions })));
const Home = lazy(() => import("@/screens/Home").then(m => ({ default: m.Home })));
const OnboardingReferral = lazy(() => import("@/screens/OnboardingReferral").then(m => ({ default: m.OnboardingReferral })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";

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
  const { stage, setStage, hydrateFromProfile } = useApp();
  const [booting, setBooting] = useState(true);
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (!session) {
          // No session: ensure we don't show post-auth screens from stale persisted state.
          setBooting(false);
          return;
        }
        // Session exists — make sure we don't flash Onboarding/AuthPhone while we
        // fetch the profile. Bump local stage out of pre-auth screens immediately.
        const localStage = useApp.getState().stage;
        if (localStage === "STAGE_0" || localStage === "STAGE_1" || localStage === "STAGE_2") {
          useApp.getState().setStageLocal("STAGE_3");
        }
        const p = await fetchProfile();
        if (!p || !mounted) { setBooting(false); return; }
        const profileStage = (p.onboarding_stage as Stage) ?? "STAGE_0";
        const kyc = (p as { kyc_status?: string | null }).kyc_status ?? null;

        const curLocal = useApp.getState().stage;
        const stageRank: Record<Stage, number> = {
          STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
        };
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
      useApp.getState().reset();
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ) : referralPending && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <OnboardingReferral onDone={markReferralDone} />
        ) : !permsSeen && (stage === "STAGE_3" || stage === "STAGE_4") ? (
          <Permissions onDone={() => { markPermsSeen(); }} />
        ) : stage === "STAGE_3" ? (
          <KycFlow onDone={() => setStage("STAGE_4")} />
        ) : stage === "STAGE_4" ? (
          <KycPending onApproved={() => setStage("STAGE_5")} />
        ) : (
          <Home />
        )}
      </Suspense>
    </PhoneShell>
  );
}
