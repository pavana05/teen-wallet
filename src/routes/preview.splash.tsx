import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { Splash } from "@/screens/Splash";

export const Route = createFileRoute("/preview/splash")({
  component: () => (
    <PhoneShell>
      <Splash onDone={() => {}} />
    </PhoneShell>
  ),
});
