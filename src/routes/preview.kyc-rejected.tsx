import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { KycPending } from "@/screens/KycPending";

export const Route = createFileRoute("/preview/kyc-rejected")({
  component: () => (
    <PhoneShell>
      <KycPending onApproved={() => {}} forceState="rejected" forceReason="Selfie did not match the Aadhaar photo. Please retake in better lighting." />
    </PhoneShell>
  ),
});
