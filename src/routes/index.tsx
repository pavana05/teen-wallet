import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { shouldShowReferralPrompt, markReferralPromptDone } from "@/lib/referral";
import { OnboardingSkeleton, HomeSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";
import { runSelfCheck, stageRank, PERMISSIONS_DONE_KEY, type SelfCheckResult } from "@/lib/bootSelfCheck";
import { reconcileAppState } from "@/lib/stateReconciler";
import { StartupErrorScreen } from "@/components/StartupErrorScreen";

// All app screens live behind a single route now ("/"). The component
// below renders the right step based on the persisted Stage + session,
// removing the previous /home and /onboarding split.

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
const Home = lazyWithRetry(loadHomeChunk);

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
function warmAllChunks() {
  // Warm immediately (not idle) so stage transitions never hit a Suspense
  // fallback after the first paint. Each chunk is small and these loads
  // happen in parallel — the browser will dedupe and the perceived nav
  // becomes instant.
  prefetch([
    loadAuthPhoneChunk,
    loadReferralChunk,
    loadPermissionsChunk,
    loadKycFlowChunk,
    loadKycPendingChunk,
    loadHomeChunk,
  ]);
}

const VALID_STAGES = new Set<Stage>([
  "STAGE_0", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5",
]);
function isValidStage(s: unknown): s is Stage {
  return typeof s === "string" && VALID_STAGES.has(s as Stage);
}

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

    // Repair inconsistent persisted state before reading it.
    const repair = reconcileAppState();
    if (repair.changed) {
      for (const r of repair.repairs) {
        recordRedirect({
          from: "boot:/", to: "boot:/",
          stage: repair.finalStage, session: false,
          reason: `reconcile:${r.code}`,
        });
      }
    }

    const check = runSelfCheck();
    if (!check.ok) {
      pendingSelfCheckFailure = check;
      recordRedirect({
        from: "boot:/", to: "/(error)",
        stage: check.snapshot.stage,
        session: check.snapshot.hasSession,
        reason: `selfcheck_fail:${check.issues[0]?.code ?? "unknown"}`,
      });
      return;
    }
    pendingSelfCheckFailure = null;

    // Suppress optional referral prompt for any returning auth'd user,
    // and ensure the perms gate doesn't bounce them on a fresh device.
    const { stage, userId, hasSession, sessionUserId } = check.snapshot;
    const hasLiveSession = hasSession || !!sessionUserId;
    if (hasLiveSession) {
      try { markReferralPromptDone(); } catch { /* ignore */ }
      if (isValidStage(stage) && stageRank[stage] >= stageRank["STAGE_5"]) {
        try { window.localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); } catch { /* ignore */ }
      }
    }

    recordRedirect({
      from: "boot:/", to: "/",
      stage, session: !!userId,
      reason: "boot_render_inplace",
    });
  },
  component: AppRoot,
});

function AppRoot() {
  const [failure] = useState<SelfCheckResult | null>(() => pendingSelfCheckFailure);
  const { stage, setStage, hydrateFromProfile } = useApp();

  const [permsSeen, setPermsSeen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const seen = localStorage.getItem(PERMISSIONS_DONE_KEY) === "1";
      if (!seen) return false;
      // If notifications were previously granted but later revoked at the
      // OS/browser level, surface the Permissions screen one more time so
      // the user can flip them back on. shouldForceReprompt() is true at
      // most once per revocation event.
      try {
        // Lazy require avoids pulling notification state on SSR.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("@/lib/notificationState") as typeof import("@/lib/notificationState");
        const liveStatus: "granted" | "denied" | "default" | "unknown" =
          typeof window !== "undefined" && "Notification" in window
            ? (Notification.permission as "granted" | "denied" | "default")
            : "unknown";
        mod.reconcileNotificationState(liveStatus);
        if (mod.shouldForceReprompt()) return false;
      } catch { /* ignore */ }
      return true;
    } catch { return true; }
  });
  const markPermsSeen = () => {
    try { localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); } catch { /* ignore */ }
    setPermsSeen(true);
  };

  const [referralPending, setReferralPending] = useState<boolean>(() => shouldShowReferralPrompt());
  const markReferralDone = () => setReferralPending(false);

  // Warm all chunks so transitions between steps feel instant.
  useEffect(() => { warmAllChunks(); }, []);

  // Boot watchdog: if a lazy chunk silently hangs (network stall, slow CDN,
  // sleeping service worker), the Suspense fallback skeleton would stay
  // forever. After 12s with no successful render, force a one-time hard
  // reload so lazyWithRetry can re-fetch with a fresh manifest. Only fires
  // if the user hasn't interacted yet (clear sign they're stuck).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "tw_boot_reload_v1";
    const t = window.setTimeout(() => {
      try {
        const last = Number(sessionStorage.getItem(KEY) || "0");
        if (Date.now() - last < 60_000) return; // avoid reload loops
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      } catch { /* ignore */ }
    }, 12_000);
    const cancel = () => window.clearTimeout(t);
    window.addEventListener("pointerdown", cancel, { once: true });
    window.addEventListener("keydown", cancel, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, []);

  // Prefetch the next-likely chunk based on current stage.
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

  // Background reconcile with backend profile (only relevant once a
  // session exists). Runs once on mount and on auth state changes.
  useEffect(() => {
    if (failure) return;
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted || !session) return;
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
      } catch (err) {
        console.error("[boot] hydrate failed", err);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !session) {
        useApp.getState().reset();
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure]);

  if (failure) {
    return <StartupErrorScreen result={failure} />;
  }

  // Decide which screen to render. Permissions/referral gates apply once
  // the user has authenticated (>= STAGE_3).
  const showReferral = referralPending && stageRank[stage] >= stageRank["STAGE_3"];
  const showPermissions = !permsSeen && stageRank[stage] >= stageRank["STAGE_3"];
  const isHome = stage === "STAGE_5" && permsSeen && !referralPending;

  // Self-heal: if no branch matches, recover instead of forever-skeleton.
  useEffect(() => {
    const matches =
      stage === "STAGE_0" || stage === "STAGE_1" || stage === "STAGE_2" ||
      showReferral || showPermissions ||
      stage === "STAGE_3" || stage === "STAGE_4" || isHome;
    if (matches) return;
    if (stageRank[stage] >= stageRank["STAGE_3"]) {
      setStage("STAGE_3");
    } else {
      setStage("STAGE_2");
    }
  }, [stage, permsSeen, referralPending, showReferral, showPermissions, isHome, setStage]);

  return (
    <PhoneShell>
      <Suspense fallback={isHome ? <HomeSkeleton /> : <OnboardingSkeleton />}>
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
        ) : isHome ? (
          <Home />
        ) : (
          <OnboardingSkeleton />
        )}
      </Suspense>
    </PhoneShell>
  );
}

// Used by tests/devtools to clear cached failure between runs.
export function __resetBootSelfCheckForTests() {
  pendingSelfCheckFailure = null;
}

export { type Stage };
