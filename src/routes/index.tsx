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
import { Home } from "@/screens/Home";

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

  useEffect(() => {
    let mounted = true;
    // Hydrate from Cloud if we have a session
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const p = await fetchProfile();
          if (p && mounted) hydrateFromProfile({
            id: p.id,
            full_name: p.full_name,
            balance: Number(p.balance),
            onboarding_stage: p.onboarding_stage as Stage,
          });
        }
      } catch (err) {
        console.error("[boot] hydrate failed", err);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, _session) => {
      // signed out — keep stage as is unless explicit reset
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [hydrateFromProfile]);

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
