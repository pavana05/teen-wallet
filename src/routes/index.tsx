import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { shouldShowReferralPrompt } from "@/lib/referral";
import { HomeSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";

const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Teen Wallet — Payments built for India's new gen" },
      { name: "description", content: "India's first teen-first UPI wallet. Aadhaar-only KYC. Scan, pay, and earn rewards in seconds." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let target: "/onboarding" | "/home" = "/onboarding";
      let hasSession = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        hasSession = !!session;
        if (!session) {
          const localStage = useApp.getState().stage;
          if (stageRank[localStage] >= stageRank["STAGE_3"]) {
            useApp.getState().setStageLocal("STAGE_0");
          }
          target = "/onboarding";
        } else {
          const localStage = useApp.getState().stage;
          if (localStage === "STAGE_0" || localStage === "STAGE_1" || localStage === "STAGE_2") {
            useApp.getState().setStageLocal("STAGE_3");
          }
          const finalStage = useApp.getState().stage;
          const permsSeen = (() => {
            try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
          })();
          const referralPending = shouldShowReferralPrompt();
          target = (finalStage === "STAGE_5" && permsSeen && !referralPending) ? "/home" : "/onboarding";
        }
      } catch {
        target = "/onboarding";
      }
      if (cancelled) return;
      recordRedirect({
        from: "boot:/",
        to: target,
        stage: useApp.getState().stage,
        session: hasSession,
        reason: "boot_decide",
      });
      void navigate({ to: target, replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <PhoneShell>
      <HomeSkeleton />
    </PhoneShell>
  );
}
