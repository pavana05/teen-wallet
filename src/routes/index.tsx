import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, type Stage } from "@/lib/store";
import { fetchProfile } from "@/lib/auth";
import { PhoneShell } from "@/components/PhoneShell";
import { Splash } from "@/screens/Splash";
import { Onboarding } from "@/screens/Onboarding";
import { AuthPhone } from "@/screens/AuthPhone";
import { KycFlow } from "@/screens/KycFlow";
import { KycPending } from "@/screens/KycPending";
import { Permissions } from "@/screens/Permissions";
import { Home } from "@/screens/Home";

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

function Index() {
  const { stage, splashSeen, setStage, hydrateFromProfile } = useApp();
  const [booting, setBooting] = useState(true);
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
    // Hydrate from Cloud if we have a session — this is the cross-device resume path.
    // The local persisted stage already gave us an instant render; we now reconcile
    // against the server's authoritative onboarding_stage + kyc_status.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const p = await fetchProfile();
          if (p && mounted) {
            const profileStage = (p.onboarding_stage as Stage) ?? "STAGE_0";
            const kyc = (p as { kyc_status?: string | null }).kyc_status ?? null;

            // Reconciliation:
            //   1. Take the MORE ADVANCED of (local persisted stage, remote profile stage).
            //      A higher stage means the user has already verified that step on either
            //      device — never demote them just because one side is behind.
            //   2. Then layer KYC ground truth on top (it always wins):
            //      - approved -> STAGE_5 (Home)
            //      - pending  -> at least STAGE_4 (KycPending)
            //      - rejected -> back to STAGE_3 so user can retry
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

            // If we corrected the stage in either direction, push the canonical value
            // back to the server so future boots on any device see the same value.
            if (resolvedStage !== profileStage) {
              setStage(resolvedStage);
            }
          }
        }
      } catch (err) {
        console.error("[boot] hydrate failed", err);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // On explicit sign-out, reset to splash so a different user can start fresh.
      if (event === "SIGNED_OUT") {
        useApp.getState().reset();
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // setStage/hydrateFromProfile are stable Zustand actions; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (booting) {
    return (
      <PhoneShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full tw-shimmer" />
        </div>
      </PhoneShell>
    );
  }

  // Splash always shown first if not seen this device
  if (!splashSeen) return <PhoneShell><Splash onDone={() => useApp.getState().setSplashSeen(true)} /></PhoneShell>;

  return (
    <PhoneShell>
      {stage === "STAGE_0" || stage === "STAGE_1" ? (
        <Onboarding onDone={() => setStage("STAGE_2")} />
      ) : stage === "STAGE_2" ? (
        <AuthPhone onDone={() => {
          // After OTP, AuthPhone hydrated the store from the profile (incl. KYC reconciliation).
          // Honor whatever stage is now in the store; only fall back to KYC for new users.
          const s = useApp.getState().stage;
          if (s === "STAGE_0" || s === "STAGE_1" || s === "STAGE_2") {
            setStage("STAGE_3");
          }
        }} />
      ) : !permsSeen && (stage === "STAGE_3" || stage === "STAGE_4") ? (
        <Permissions onDone={() => {
          markPermsSeen();
          // After permissions, if we were waiting on KYC, stay on STAGE_4 (pending will resume).
          // If we were on STAGE_3, the next render shows KycFlow.
        }} />
      ) : stage === "STAGE_3" ? (
        <KycFlow onDone={() => setStage("STAGE_4")} />
      ) : stage === "STAGE_4" ? (
        <KycPending onApproved={() => setStage("STAGE_5")} />
      ) : (
        <Home />
      )}
    </PhoneShell>
  );
}
