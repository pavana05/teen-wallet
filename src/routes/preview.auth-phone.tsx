import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { AuthPhone } from "@/screens/AuthPhone";

export const Route = createFileRoute("/preview/auth-phone")({
  component: () => (
    <PhoneShell>
      <AuthPhone onDone={() => {}} />
    </PhoneShell>
  ),
});
