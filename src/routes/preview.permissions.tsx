import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { Permissions } from "@/screens/Permissions";

export const Route = createFileRoute("/preview/permissions")({
  component: () => (
    <PhoneShell>
      <Permissions onDone={() => { /* preview only */ }} />
    </PhoneShell>
  ),
});
