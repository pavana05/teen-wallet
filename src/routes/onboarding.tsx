import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { shouldShowReferralPrompt } from "@/lib/referral";

const Onboarding = lazyWithRetry(() => import("@/screens/Onboarding").then(m => ({ default: m.Onboarding })));
const AuthPhone = lazyWithRetry(() => import("@/screens/AuthPhone").then(m => ({ default: m.AuthPhone })));
const KycFlow = lazyWithRetry(() => import("@/screens/KycFlow").then(m => ({ default: m.KycFlow })));
const KycPending = lazyWithRetry(() => import("@/screens/KycPending").then(m => ({ default: m.KycPending })));
const Permissions = lazyWithRetry(() => import("@/screens/Permissions").then(m => ({ default: m.Permissions })));
const OnboardingReferral = lazyWithRetry(() => import("@/screens/OnboardingReferral").then(m => ({ default: m.OnboardingReferral })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";

const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — Teen Wallet" },
      { name: "description", content: "Set up your Teen Wallet account: verify your phone, complete KYC, and start paying." },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const { stage, setStage } = useApp();

  const [permsSeen, setPermsSeen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
  });
  const markPermsSeen = () => {
    try { localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); } catch { /* ignore */ }
    setPermsSeen(true);
  };

  const [referralPending, setReferralPending] = useState<boolean>(() => shouldShowReferralPrompt());
  const markReferralDone = () => setReferralPending(false);

  // If onboarding is fully complete, go to /home.
  useEffect(() => {
    if (stage === "STAGE_5" && permsSeen && !referralPending) {
      void navigate({ to: "/home", replace: true });
    }
  }, [stage, permsSeen, referralPending, navigate]);

  return (
    <PhoneShell>
      <Suspense fallback={<div className="flex-1" />}>
        {stage === "STAGE_0" || stage === "STAGE_1" ? (
          <Onboarding onDone={() => {
            const s = useApp.getState().stage;
            setStage(stageRank[s] >= stageRank["STAGE_2"] ? s : "STAGE_2");
          }} />
        ) : stage === "STAGE_2" ? (
          <AuthPhone onDone={() => {
            const s = useApp.getState().stage;
            setStage(stageRank[s] > stageRank["STAGE_3"] ? s : "STAGE_3");
          }} />
        ) : referralPending && (stage === "STAGE_3" || stage === "STAGE_4" || stage === "STAGE_5") ? (
          <OnboardingReferral onDone={markReferralDone} />
        ) : !permsSeen && (stage === "STAGE_3" || stage === "STAGE_4") ? (
          <Permissions onDone={markPermsSeen} />
        ) : stage === "STAGE_3" ? (
          <KycFlow onDone={() => setStage("STAGE_4")} />
        ) : stage === "STAGE_4" ? (
          <KycPending onApproved={() => setStage("STAGE_5")} />
        ) : (
          <div className="flex-1" />
        )}
      </Suspense>
    </PhoneShell>
  );
}

