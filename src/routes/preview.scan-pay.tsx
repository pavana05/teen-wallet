import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { ScanPay } from "@/screens/ScanPay";

export const Route = createFileRoute("/preview/scan-pay")({
  component: () => (
    <PhoneShell>
      <ScanPay onBack={() => {}} />
    </PhoneShell>
  ),
});
