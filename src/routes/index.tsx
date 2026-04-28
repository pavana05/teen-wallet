import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { shouldShowReferralPrompt } from "@/lib/referral";
import { HomeSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";
const PERSIST_KEY = "teenwallet-app";

const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

/** Synchronously read persisted store snapshot from localStorage. */
function readPersisted(): { stage: Stage; userId: string | null } {
  if (typeof window === "undefined") return { stage: "STAGE_0", userId: null };
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return { stage: "STAGE_0", userId: null };
    const parsed = JSON.parse(raw) as { state?: { stage?: Stage; userId?: string | null } };
    return {
      stage: parsed?.state?.stage ?? "STAGE_0",
      userId: parsed?.state?.userId ?? null,
    };
  } catch {
    return { stage: "STAGE_0", userId: null };
  }
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Teen Wallet — Payments built for India's new gen" },
      { name: "description", content: "India's first teen-first UPI wallet. Aadhaar-only KYC. Scan, pay, and earn rewards in seconds." },
    ],
  }),
  // Synchronous redirect on the client based on persisted state. This runs
  // BEFORE the component mounts, so logged-in returning users go straight to
  // /home with zero flash of onboarding. The /home guard re-validates the
  // live session and bounces them to /onboarding if it has expired.
  beforeLoad: () => {
    if (typeof window === "undefined") return; // SSR: render Index() which mounts client effect
    const { stage, userId } = readPersisted();
    const permsSeen = (() => {
      try { return window.localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; }
      catch { return false; }
    })();
    const referralPending = shouldShowReferralPrompt();
    const target: "/home" | "/onboarding" =
      (userId && stageRank[stage] >= stageRank["STAGE_5"] && permsSeen && !referralPending)
        ? "/home"
        : "/onboarding";
    recordRedirect({
      from: "boot:/",
      to: target,
      stage,
      session: !!userId,
      reason: "boot_decide_sync",
    });
    throw redirect({ to: target, replace: true });
  },
  component: Index,
});

// Fallback component — only ever rendered during SSR (where beforeLoad bails
// out because there's no window). On the client, beforeLoad always redirects.
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
        if (session) {
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
        reason: "boot_decide_async",
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
