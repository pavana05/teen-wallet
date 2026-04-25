import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { PhoneVerified } from "@/screens/PhoneVerified";

export const Route = createFileRoute("/preview/phone-verified")({
  component: () => (
    <PhoneShell>
      <PhoneVerified onContinue={() => {}} />
    </PhoneShell>
  ),
});
