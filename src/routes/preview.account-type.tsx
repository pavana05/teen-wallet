import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { AccountTypeSelection } from "@/screens/AccountTypeSelection";

export const Route = createFileRoute("/preview/account-type")({
  component: () => (
    <PhoneShell>
      <AccountTypeSelection onDone={(type) => alert(`Selected: ${type}`)} />
    </PhoneShell>
  ),
});
