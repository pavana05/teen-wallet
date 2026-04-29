import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/preview/")({
  head: () => ({ meta: [{ title: "Screen Preview — Teen Wallet" }] }),
  component: PreviewIndex,
});

const screens = [
  { path: "/preview/splash", label: "Splash", desc: "Boot animation" },
  { path: "/preview/onboarding", label: "Onboarding", desc: "5-slide intro carousel" },
  { path: "/preview/auth-phone", label: "AuthPhone", desc: "Phone + OTP entry" },
  { path: "/preview/phone-verified", label: "PhoneVerified", desc: "Premium success screen" },
  { path: "/preview/kyc-flow", label: "KycFlow", desc: "DOB → Aadhaar → selfie" },
  { path: "/preview/kyc-approved", label: "KYC Approved", desc: "Green tick celebration" },
  { path: "/preview/kyc-rejected", label: "KYC Rejected", desc: "Red error screen" },
  { path: "/preview/kyc-pending", label: "KYC Pending", desc: "Reviewing state" },
  { path: "/preview/home", label: "Home", desc: "Orange hero + tiles" },
  { path: "/preview/scan-pay", label: "ScanPay", desc: "Scan & Pay flow" },
] as const;

function PreviewIndex() {
  return (
    <div className="min-h-screen bg-[#050505] text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">Screen Preview</h1>
        <p className="text-sm text-white/60 mt-2">
          Open any screen in isolation. Useful for design iteration without walking through the full flow.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          {screens.map((s) => (
            <Link
              key={s.path}
              to={s.path}
              className="block p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.label}</span>
                <span className="text-white/40 text-xs">→</span>
              </div>
              <p className="text-xs text-white/55 mt-1">{s.desc}</p>
              <code className="text-[10px] text-primary mt-2 block">{s.path}</code>
            </Link>
          ))}
        </div>
        <Link to="/" className="inline-block mt-8 text-sm text-white/60 hover:text-white">← Back to app</Link>
      </div>
    </div>
  );
}
