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
import { reportError } from "@/lib/lastError";

// Hard ceiling for the async boot decision. If session/profile lookups
// stall (offline, slow Supabase, dead worker), we must NOT leave the
// shimmer up forever. After this, we fall back to /onboarding and
// surface a retry-able error toast.
const BOOT_TIMEOUT_MS = 6000;

const VALID_STAGES = new Set<Stage>([
  "STAGE_0", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5",
]);

function isValidStage(s: unknown): s is Stage {
  return typeof s === "string" && VALID_STAGES.has(s as Stage);
}

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
  beforeLoad: () => {
    if (typeof window === "undefined") return;

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
      return;
    }

    pendingSelfCheckFailure = null;
    const { stage, userId } = check.snapshot;

    // Defensive: invalid persisted stage → onboarding fallback, never crash.
    if (!isValidStage(stage)) {
      recordRedirect({
        from: "boot:/",
        to: "/onboarding",
        stage: "STAGE_0",
        session: !!userId,
        reason: "invalid_stage_fallback",
      });
      throw redirect({ to: "/onboarding", replace: true });
    }

    const permsSeen = check.snapshot.permsSeen;
    const referralPending = shouldShowReferralPrompt();
    // A user is "fully onboarded" once they have a session AND KYC is
    // approved (STAGE_5). Permissions / referral are nice-to-have local
    // prompts — we should NEVER bounce a logged-in, KYC-approved user
    // back into the onboarding flow because of them. Doing so was the
    // bug where returning users saw the splash/onboarding instead of
    // their home screen.
    const isFullyOnboarded =
      !!userId && stageRank[stage] >= stageRank["STAGE_5"];
    const target: "/home" | "/onboarding" = isFullyOnboarded ? "/home" : "/onboarding";
    recordRedirect({
      from: "boot:/",
      to: target,
      stage,
      session: !!userId,
      reason: `boot_decide_sync${isFullyOnboarded && (!permsSeen || referralPending) ? ":skipped_local_prompts" : ""}`,
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
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (failure) { setBooting(false); return; }

    let cancelled = false;
    let timedOut = false;

    // Hard timeout — ALWAYS turns booting off and shows a retry overlay
    // instead of leaving the user staring at a shimmer.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      timedOut = true;
      reportError({
        message: "We couldn't load your session in time. Check your connection and try again.",
        source: "boot",
        retry: () => { window.location.reload(); },
      });
      // Best fallback: send to onboarding so the user can act.
      void navigate({ to: "/onboarding", replace: true });
      setBooting(false);
    }, BOOT_TIMEOUT_MS);

    (async () => {
      let target: "/onboarding" | "/home" = "/onboarding";
      let hasSession = false;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const session = data.session;
        hasSession = !!session;

        if (session) {
          const rawStage = useApp.getState().stage;
          const safeStage: Stage = isValidStage(rawStage) ? rawStage : "STAGE_0";
          if (safeStage !== rawStage) useApp.getState().setStageLocal(safeStage);

          if (safeStage === "STAGE_0" || safeStage === "STAGE_1" || safeStage === "STAGE_2") {
            useApp.getState().setStageLocal("STAGE_3");
          }
          const finalStage = useApp.getState().stage;
          const permsSeen = (() => {
            try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
          })();
          const referralPending = shouldShowReferralPrompt();
          target = (finalStage === "STAGE_5" && permsSeen && !referralPending) ? "/home" : "/onboarding";
        } else {
          // No session at all — clear any stale stage > STAGE_2.
          const stage = useApp.getState().stage;
          if (isValidStage(stage) && stageRank[stage] >= stageRank["STAGE_3"]) {
            useApp.getState().setStageLocal("STAGE_0");
          }
        }
      } catch (e) {
        // Surface to the user with retry rather than silently routing.
        reportError({
          message: e instanceof Error ? e.message : "Couldn't reach the sign-in service.",
          source: "session",
          retry: () => { window.location.reload(); },
        });
        target = "/onboarding";
      } finally {
        if (cancelled || timedOut) return;
        window.clearTimeout(timer);
        recordRedirect({
          from: "boot:/",
          to: target,
          stage: useApp.getState().stage,
          session: hasSession,
          reason: "boot_decide_async",
        });
        void navigate({ to: target, replace: true });
        setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [navigate, failure]);

  if (failure) {
    return <StartupErrorScreen result={failure} />;
  }

  // Even if booting becomes false we render a phone shell briefly until navigate kicks in.
  return (
    <PhoneShell>
      <HomeSkeleton />
      {!booting && (
        <div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        />
      )}
    </PhoneShell>
  );
}

// Used by tests/devtools to clear cached failure between runs.
export function __resetBootSelfCheckForTests() {
  pendingSelfCheckFailure = null;
}

// Re-export for tests.
export { type Stage };

