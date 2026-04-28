import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { shouldShowReferralPrompt } from "@/lib/referral";

const Home = lazyWithRetry(() => import("@/screens/Home").then(m => ({ default: m.Home })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";

const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home — Teen Wallet" },
      { name: "description", content: "Your Teen Wallet — balance, quick actions, and recent activity at a glance." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const { stage, hydrateFromProfile, setStage } = useApp();

  // Background reconcile with backend profile (non-blocking).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (!session) {
          void navigate({ to: "/onboarding", replace: true });
          return;
        }
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
        });
        if (resolvedStage !== profileStage) setStage(resolvedStage);

        const permsSeen = (() => {
          try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
        })();
        const referralPending = shouldShowReferralPrompt();
        if (resolvedStage !== "STAGE_5" || !permsSeen || referralPending) {
          void navigate({ to: "/onboarding", replace: true });
        }
      } catch (err) {
        console.error("[home] hydrate failed", err);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !session) {
        useApp.getState().reset();
        void navigate({ to: "/onboarding", replace: true });
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If somehow stage is not 5, kick to onboarding.
  if (stage !== "STAGE_5") {
    return <PhoneShell><div className="flex-1" /></PhoneShell>;
  }

  return (
    <PhoneShell>
      <Suspense fallback={<div className="flex-1" />}>
        <Home />
      </Suspense>
    </PhoneShell>
  );
}
