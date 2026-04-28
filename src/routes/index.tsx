import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { shouldShowReferralPrompt } from "@/lib/referral";
import { HomeSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";
import { runSelfCheck, stageRank, PERMISSIONS_DONE_KEY, type SelfCheckResult } from "@/lib/bootSelfCheck";
import { StartupErrorScreen } from "@/components/StartupErrorScreen";

// Module-level flag set by beforeLoad when the self-check fails. The
// component reads it on first render to decide whether to show the
// startup error screen instead of attempting a redirect.
let pendingSelfCheckFailure: SelfCheckResult | null = null;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Teen Wallet — Payments built for India's new gen" },
      { name: "description", content: "India's first teen-first UPI wallet. Aadhaar-only KYC. Scan, pay, and earn rewards in seconds." },
    ],
  }),
  // Synchronous boot decision: validate consistency, then redirect.
  // If the self-check finds issues, do NOT redirect — render Index() which
  // will show the one-tap recovery screen.
  beforeLoad: () => {
    if (typeof window === "undefined") return; // SSR: render Index() which mounts client effect

    const check = runSelfCheck();
    if (!check.ok) {
      pendingSelfCheckFailure = check;
      recordRedirect({
        from: "boot:/",
        to: "/(error)",
        stage: check.snapshot.stage,
        session: check.snapshot.hasSession,
        reason: `selfcheck_fail:${check.issues[0]?.code ?? "unknown"}`,
      });
      return; // fall through to component, which renders StartupErrorScreen
    }

    pendingSelfCheckFailure = null;
    const { stage, userId } = check.snapshot;
    const permsSeen = check.snapshot.permsSeen;
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

// Fallback component — rendered during SSR (where beforeLoad bails out)
// or when the startup self-check fails on the client.
function Index() {
  const navigate = useNavigate();
  const [failure] = useState<SelfCheckResult | null>(() => pendingSelfCheckFailure);

  useEffect(() => {
    if (failure) return; // self-check failed — show error screen, don't redirect.
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
  }, [navigate, failure]);

  if (failure) {
    return <StartupErrorScreen result={failure} />;
  }

  return (
    <PhoneShell>
      <HomeSkeleton />
    </PhoneShell>
  );
}

// Used by tests/devtools to clear cached failure between runs.
export function __resetBootSelfCheckForTests() {
  pendingSelfCheckFailure = null;
}

// Re-export for tests.
export { type Stage };
