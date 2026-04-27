import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { ReferralProgram } from "@/screens/ReferralProgram";

export const Route = createFileRoute("/preview/referral-program")({
  head: () => ({ meta: [{ title: "Preview · Referral Program" }] }),
  component: () => (
    <PhoneShell>
      <ReferralProgram onBack={() => window.history.back()} />
    </PhoneShell>
  ),
});
