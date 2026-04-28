import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { shouldShowReferralPrompt } from "@/lib/referral";

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

function ScreenFallback() {
  return (
    <div className="flex-1 flex flex-col gap-4 px-5 pt-8 pb-6 boot-slide-in">
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
      <div className="boot-skel boot-skel-card" style={{ height: 148, borderRadius: 22, marginTop: 6 }} />
      <div className="grid grid-cols-4 gap-3 mt-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="boot-skel" style={{ width: 60, height: 60, borderRadius: 16 }} />
            <div className="boot-skel" style={{ width: 44, height: 8, borderRadius: 6 }} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="boot-skel" style={{ width: 120, height: 12, borderRadius: 6 }} />
        <div className="boot-skel" style={{ width: 48, height: 10, borderRadius: 6 }} />
      </div>
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
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let target: "/onboarding" | "/home" = "/onboarding";
      try {
        const { data: { session } } = await supabase.auth.getSession();
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
      void navigate({ to: target, replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <PhoneShell>
      <ScreenFallback />
    </PhoneShell>
  );
}
