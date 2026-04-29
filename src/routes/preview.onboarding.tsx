import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { Onboarding } from "@/screens/Onboarding";

export const Route = createFileRoute("/preview/onboarding")({
  component: () => (
    <PhoneShell>
      <Onboarding onDone={() => {}} />
    </PhoneShell>
  ),
});
