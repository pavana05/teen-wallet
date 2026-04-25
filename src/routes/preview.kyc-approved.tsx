import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { KycPending } from "@/screens/KycPending";

export const Route = createFileRoute("/preview/kyc-approved")({
  component: () => (
    <PhoneShell>
      <KycPending onApproved={() => {}} forceState="approved" />
    </PhoneShell>
  ),
});
