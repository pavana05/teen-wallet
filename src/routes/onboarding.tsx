import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";

import { useApp, type Stage } from "@/lib/store";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { shouldShowReferralPrompt } from "@/lib/referral";
import { OnboardingSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";

// Lazy chunks. We also expose the raw factories so we can warm them up
// (prefetch) ahead of the moment the user actually advances — this is the
// single biggest win for perceived speed between onboarding steps.
const loadOnboardingChunk = () => import("@/screens/Onboarding").then(m => ({ default: m.Onboarding }));
const loadAuthPhoneChunk = () => import("@/screens/AuthPhone").then(m => ({ default: m.AuthPhone }));
const loadKycFlowChunk = () => import("@/screens/KycFlow").then(m => ({ default: m.KycFlow }));
const loadKycPendingChunk = () => import("@/screens/KycPending").then(m => ({ default: m.KycPending }));
const loadPermissionsChunk = () => import("@/screens/Permissions").then(m => ({ default: m.Permissions }));
const loadReferralChunk = () => import("@/screens/OnboardingReferral").then(m => ({ default: m.OnboardingReferral }));
const loadHomeChunk = () => import("@/screens/Home").then(m => ({ default: m.Home }));

const Onboarding = lazyWithRetry(loadOnboardingChunk);
const AuthPhone = lazyWithRetry(loadAuthPhoneChunk);
const KycFlow = lazyWithRetry(loadKycFlowChunk);
const KycPending = lazyWithRetry(loadKycPendingChunk);
const Permissions = lazyWithRetry(loadPermissionsChunk);
const OnboardingReferral = lazyWithRetry(loadReferralChunk);

/** Fire a dynamic import without awaiting — warms the chunk so the next
 *  step renders instantly when the user advances.
 *
 *  We deliberately do NOT use requestIdleCallback for the immediate next
 *  step, because on slow networks (3G, weak Wi-Fi) the user can advance
 *  faster than idle fires, causing the dreaded "Getting things ready…"
 *  skeleton between steps. Critical chunks fire immediately; nice-to-haves
 *  can be deferred via `prefetchIdle`. */
function prefetch(loaders: Array<() => Promise<unknown>>) {
  if (typeof window === "undefined") return;
  for (const l of loaders) { try { void l(); } catch { /* noop */ } }
}
function prefetchIdle(loaders: Array<() => Promise<unknown>>) {
  if (typeof window === "undefined") return;
  const run = () => prefetch(loaders);
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(run); else window.setTimeout(run, 60);
}

/** Fire-and-forget warm of every onboarding chunk. Called once on mount so
 *  the entire flow is in the browser cache before the user reaches any
 *  individual step. KycFlow is ~1k lines and is the most painful step to
 *  lazy-load mid-flow — warming it during onboarding hides that cost. */
function warmAllOnboardingChunks() {
  prefetchIdle([
    loadAuthPhoneChunk,
    loadReferralChunk,
    loadPermissionsChunk,
    loadKycFlowChunk,
    loadKycPendingChunk,
  ]);
}

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

  // Warm ALL onboarding chunks once on mount. By the time the user
  // reaches the referral screen (a few seconds in), KycFlow + Permissions
  // are already cached so transitions feel instant instead of triggering
  // a fresh network fetch behind the "Getting things ready…" skeleton.
  useEffect(() => { warmAllOnboardingChunks(); }, []);

  // Prefetch the *immediate next* chunk based on current step — fires
  // SYNCHRONOUSLY (no idle gating) so a user who taps fast still hits a
  // warm cache.
  useEffect(() => {
    if (stage === "STAGE_0" || stage === "STAGE_1") {
      prefetch([loadAuthPhoneChunk, loadReferralChunk]);
    } else if (stage === "STAGE_2") {
      prefetch([loadReferralChunk, loadPermissionsChunk, loadKycFlowChunk]);
    } else if (stage === "STAGE_3") {
      prefetch([loadKycFlowChunk, loadPermissionsChunk]);
      prefetchIdle([loadKycPendingChunk, loadHomeChunk]);
    } else if (stage === "STAGE_4") {
      prefetch([loadKycPendingChunk, loadHomeChunk]);
    } else if (stage === "STAGE_5") {
      prefetch([loadHomeChunk]);
    }
  }, [stage]);

  // While the referral screen is mounted, KycFlow + Permissions are the
  // immediate next steps — warm them aggressively (not idle) so the
  // "after referral, app stops loading" gap disappears.
  useEffect(() => {
    if (referralPending) {
      prefetch([loadPermissionsChunk, loadKycFlowChunk]);
    } else {
      prefetch([loadPermissionsChunk, loadKycFlowChunk, loadKycPendingChunk, loadHomeChunk]);
    }
  }, [referralPending]);

  // If onboarding is fully complete, go to /home.
  useEffect(() => {
    if (stage === "STAGE_5" && permsSeen && !referralPending) {
      recordRedirect({
        from: "/onboarding", to: "/home",
        stage, session: !!useApp.getState().userId,
        reason: "onboarding_complete",
      });
      void navigate({ to: "/home", replace: true });
    }
  }, [stage, permsSeen, referralPending, navigate]);

  // Decide which step to render. IMPORTANT: the Permissions gate must
  // also catch STAGE_5 (post-KYC) — otherwise a user who finishes KYC
  // before granting permissions falls through to the dead skeleton
  // branch and sees an infinite "Getting things ready…" screen.
  const showReferral = referralPending && stageRank[stage] >= stageRank["STAGE_3"];
  const showPermissions = !permsSeen && stageRank[stage] >= stageRank["STAGE_3"];

  // Self-heal: if no branch matches (corrupt/unexpected stage),
  // recover instead of showing a forever-skeleton.
  useEffect(() => {
    const matches =
      stage === "STAGE_0" || stage === "STAGE_1" || stage === "STAGE_2" ||
      showReferral || showPermissions ||
      stage === "STAGE_3" || stage === "STAGE_4" ||
      (stage === "STAGE_5" && permsSeen && !referralPending);
    if (matches) return;
    // Reset to the most sensible step so the user is never stuck.
    if (stageRank[stage] >= stageRank["STAGE_3"]) {
      // Drop back to KYC start; fixes the "stage moved past STAGE_4 but
      // permsSeen=true & referralDone=false" type of orphan state.
      setStage("STAGE_3");
    } else {
      setStage("STAGE_2");
    }
  }, [stage, permsSeen, referralPending, showReferral, showPermissions, setStage]);

  return (
    <PhoneShell>
      <Suspense fallback={<OnboardingSkeleton />}>
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
        ) : showReferral ? (
          <OnboardingReferral onDone={markReferralDone} />
        ) : showPermissions ? (
          <Permissions onDone={markPermsSeen} />
        ) : stage === "STAGE_3" ? (
          <KycFlow onDone={() => setStage("STAGE_4")} />
        ) : stage === "STAGE_4" ? (
          <KycPending onApproved={() => setStage("STAGE_5")} />
        ) : (
          // Final fallback — only briefly visible while the self-heal
          // effect above corrects the stage and the redirect-to-/home
          // effect fires.
          <OnboardingSkeleton />
        )}
      </Suspense>
    </PhoneShell>
  );
}
