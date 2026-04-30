import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { goBackInApp } from "@/lib/goBack";

export const Route = createFileRoute("/preview/privacy")({
  component: () => (
    <PhoneShell>
      <PrivacyPage />
    </PhoneShell>
  ),
});

function PrivacyPage() {
  const nav = useNavigate();
  return (
    <div className="flex-1 flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        <button
          onClick={() => goBackInApp(nav)}
          aria-label="Back"
          className="w-9 h-9 grid place-items-center rounded-full hover:bg-muted/40 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">Privacy Policy</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5 text-sm leading-relaxed space-y-4">
        <p className="text-muted-foreground text-xs">Last updated April 2026</p>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">1. What we collect</h2>
          <p>
            We collect your phone number, profile details you choose to add, KYC
            documents (when required for compliance), payment activity, and basic
            device information needed to keep your account secure.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">2. How we use your data</h2>
          <p>
            Your data is used to operate the wallet — process payments, prevent
            fraud, send transaction notifications, and meet regulatory
            requirements. We do not sell your personal data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">3. Sharing</h2>
          <p>
            We share data only with payment partners, identity verification
            providers, and regulators when required. All transfers are encrypted
            in transit.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">4. Your choices</h2>
          <p>
            You can edit your profile, manage notifications, and delete your
            account from Settings at any time. Deleting your account removes
            personal data except where retention is legally required.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">5. Contact</h2>
          <p>
            Questions about privacy? Reach us through Help &amp; Support inside
            the app.
          </p>
        </section>
      </div>
    </div>
  );
}
