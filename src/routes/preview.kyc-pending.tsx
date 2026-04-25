import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { KycPending } from "@/screens/KycPending";

export const Route = createFileRoute("/preview/kyc-pending")({
  component: () => (
    <PhoneShell>
      <KycPending onApproved={() => {}} forceState="pending" />
    </PhoneShell>
  ),
});
