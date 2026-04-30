import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";

export const Route = createFileRoute("/preview/terms")({
  component: () => (
    <PhoneShell>
      <TermsPage />
    </PhoneShell>
  ),
});

function TermsPage() {
  const nav = useNavigate();
  return (
    <div className="flex-1 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        <button
          onClick={() => nav({ to: "/" })}
          aria-label="Back"
          className="w-9 h-9 grid place-items-center rounded-full hover:bg-muted/40 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">Terms of Service</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5 text-sm leading-relaxed space-y-4">
        <p className="text-muted-foreground text-xs">Last updated April 2026</p>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">1. Eligibility</h2>
          <p>
            TeenWallet is intended for users aged 13 and above with consent from
            a parent or guardian where required by law. Accounts that don't meet
            eligibility may be suspended.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">2. Your account</h2>
          <p>
            You are responsible for keeping your login, app lock, and device
            secure. Notify us immediately if you suspect unauthorized access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">3. Payments</h2>
          <p>
            Payments are final once confirmed by the network. Failed or pending
            payments will be refunded automatically per network rules. Daily and
            per-transaction limits apply for safety.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">4. Acceptable use</h2>
          <p>
            Don't use TeenWallet for fraud, illegal activity, or to circumvent
            spending limits set by a parent or guardian. Violations may result
            in account closure.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">5. Changes</h2>
          <p>
            We may update these terms occasionally. Material changes will be
            announced inside the app before they take effect.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">6. Contact</h2>
          <p>
            Questions about these terms? Reach us through Help &amp; Support
            inside the app.
          </p>
        </section>
      </div>
    </div>
  );
}
