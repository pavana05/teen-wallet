import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { Splash } from "@/screens/Splash";

const Onboarding = lazy(() => import("@/screens/Onboarding").then(m => ({ default: m.Onboarding })));
const AuthPhone = lazy(() => import("@/screens/AuthPhone").then(m => ({ default: m.AuthPhone })));
const KycFlow = lazy(() => import("@/screens/KycFlow").then(m => ({ default: m.KycFlow })));
const KycPending = lazy(() => import("@/screens/KycPending").then(m => ({ default: m.KycPending })));
const Permissions = lazy(() => import("@/screens/Permissions").then(m => ({ default: m.Permissions })));
const Home = lazy(() => import("@/screens/Home").then(m => ({ default: m.Home })));

const PERMISSIONS_DONE_KEY = "tw_permissions_seen_v1";

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
    <div className="flex-1 flex items-center justify-center">
      <div className="w-10 h-10 rounded-full tw-shimmer" />
    </div>
  );
}

function Index() {
  const { stage, splashSeen, setStage, hydrateFromProfile } = useApp();
  const [permsSeen, setPermsSeen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try { return localStorage.getItem(PERMISSIONS_DONE_KEY) === "1"; } catch { return true; }
  });
  const markPermsSeen = () => {
    try { localStorage.setItem(PERMISSIONS_DONE_KEY, "1"); } catch { /* ignore */ }
    setPermsSeen(true);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const p = await fetchProfile();
        if (!p || !mounted) return;
        const profileStage = (p.onboarding_stage as Stage) ?? "STAGE_0";
        const kyc = (p as { kyc_status?: string | null }).kyc_status ?? null;

        const localStage = useApp.getState().stage;
        const stageRank: Record<Stage, number> = {
          STAGE_0: 0, STAGE_1: 1, STAGE_2: 2, STAGE_3: 3, STAGE_4: 4, STAGE_5: 5,
        };
        const moreAdvanced: Stage =
          stageRank[localStage] >= stageRank[profileStage] ? localStage : profileStage;

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
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") useApp.getState().reset();
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!splashSeen) return <PhoneShell><Splash onDone={() => useApp.getState().setSplashSeen(true)} /></PhoneShell>;

  return (
    <PhoneShell>
      <Suspense fallback={<ScreenFallback />}>
        {stage === "STAGE_0" || stage === "STAGE_1" ? (
          <Onboarding onDone={() => setStage("STAGE_2")} />
        ) : stage === "STAGE_2" ? (
          <AuthPhone onDone={() => {
            const s = useApp.getState().stage;
            if (s === "STAGE_0" || s === "STAGE_1" || s === "STAGE_2") {
              setStage("STAGE_3");
            }
          }} />
        ) : !permsSeen && (stage === "STAGE_3" || stage === "STAGE_4") ? (
          <Permissions onDone={() => { markPermsSeen(); }} />
        ) : stage === "STAGE_3" ? (
          <KycFlow onDone={() => setStage("STAGE_4")} />
        ) : stage === "STAGE_4" ? (
          <KycPending onApproved={() => setStage("STAGE_5")} />
        ) : (
          <Home />
        )}
      </Suspense>
    </PhoneShell>
  );
}
