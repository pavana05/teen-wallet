import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { KycFlow } from "@/screens/KycFlow";

export const Route = createFileRoute("/preview/kyc-flow")({
  component: () => (
    <PhoneShell>
      <KycFlow onDone={() => {}} />
    </PhoneShell>
  ),
});
