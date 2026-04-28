import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { shouldShowReferralPrompt } from "@/lib/referral";
import { HomeSkeleton } from "@/components/BootSkeletons";
import { recordRedirect } from "@/lib/redirectLog";

const Home = lazyWithRetry(() => import("@/screens/Home").then(m => ({ default: m.Home })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";
const PERSIST_KEY = "teenwallet-app";

const stageRank: Record<Stage, number> = {
  STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
};

/**
 * Read the persisted snapshot directly from localStorage so the route guard
 * can run synchronously inside `beforeLoad` (the zustand store is hydrated
 * lazily on the client, and `beforeLoad` may run before the React tree
 * mounts the store hook).
 */
function readPersisted(): { stage: Stage; userId: string | null } {
  if (typeof window === "undefined") return { stage: "STAGE_0", userId: null };
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return { stage: "STAGE_0", userId: null };
    const parsed = JSON.parse(raw) as { state?: { stage?: Stage; userId?: string | null } };
    const s = parsed?.state?.stage ?? "STAGE_0";
    const uid = parsed?.state?.userId ?? null;
    return { stage: s, userId: uid };
  } catch {
    return { stage: "STAGE_0", userId: null };
  }
}

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home — Teen Wallet" },
      { name: "description", content: "Your Teen Wallet — balance, quick actions, and recent activity at a glance." },
    ],
  }),
  // Synchronous guard. Blocks /home unless:
  //   • persisted stage is STAGE_5 (KYC approved)
  //   • a persisted userId exists (proxy for an authenticated session)
  //   • the permissions gate has been completed (tw_permissions_seen_v1)
  // The runtime useEffect below still re-validates the live session and
  // reconciles with the backend profile.
  beforeLoad: ({ location }) => {
    if (typeof window === "undefined") return;
    const { stage, userId } = readPersisted();
    const meetsStage = stageRank[stage] >= stageRank["STAGE_5"];
    const meetsSession = !!userId;
    const permsSeen = (() => {
      try { return window.localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; }
      catch { return false; }
    })();
    if (!meetsStage || !meetsSession || !permsSeen) {
      recordRedirect({
        from: location.pathname,
        to: "/onboarding",
        stage,
        session: meetsSession,
        reason: !permsSeen ? "guard_block:/home:permissions" : "guard_block:/home",
      });
      throw redirect({ to: "/onboarding", replace: true });
    }
  },
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
          recordRedirect({
            from: "/home", to: "/onboarding",
            stage: useApp.getState().stage, session: false,
            reason: "no_live_session",
          });
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
          recordRedirect({
            from: "/home", to: "/onboarding",
            stage: resolvedStage, session: true,
            reason: "incomplete_after_reconcile",
          });
          void navigate({ to: "/onboarding", replace: true });
        }
      } catch (err) {
        console.error("[home] hydrate failed", err);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" && !session) {
        useApp.getState().reset();
        recordRedirect({
          from: "/home", to: "/onboarding",
          stage: "STAGE_0", session: false,
          reason: "signed_out",
        });
        void navigate({ to: "/onboarding", replace: true });
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If somehow stage is not 5, show the Home skeleton (right silhouette,
  // no flash of onboarding) while the effect above redirects.
  if (stage !== "STAGE_5") {
    return <PhoneShell><HomeSkeleton /></PhoneShell>;
  }

  return (
    <PhoneShell>
      <Suspense fallback={<HomeSkeleton />}>
        <Home />
      </Suspense>
    </PhoneShell>
  );
}
