import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { Home } from "@/screens/Home";

export const Route = createFileRoute("/preview/home")({
  component: () => (
    <PhoneShell>
      <Home />
    </PhoneShell>
  ),
});
