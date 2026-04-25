import { useState } from "react";
import { ArrowRight, CreditCard, ScanLine, ShieldCheck, Users, Timer } from "lucide-react";

const SLIDES = [
  {
    title: "Your Money. Your Rules.",
    sub: "India's first teen payment app that works with just your Aadhaar card. No PAN card needed.",
    icon: CreditCard,
  },
  {
    title: "Pay Anyone, Anywhere.",
    sub: "Scan any UPI QR code and pay in seconds. Works at every shop, app, and platform across India.",
    icon: ScanLine,
  },
  {
    title: "We've Got Your Back.",
    sub: "Our AI-powered fraud detection monitors every transaction in real time — so your money stays safe 24/7.",
    icon: ShieldCheck,
  },
  {
    title: "Your Choice, Your Privacy.",
    sub: "Want your parents to co-manage your wallet? Enable parental controls anytime. Or keep it fully independent.",
    icon: Users,
  },
  {
    title: "No PAN. No Branch. No Wait.",
    sub: "Create your account using only your Aadhaar card. Instant eKYC. Start spending in under 2 minutes.",
    icon: Timer,
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const Icon = slide.icon;
  const isLast = i === SLIDES.length - 1;

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex justify-end">
        <button onClick={onDone} className="text-sm text-muted-foreground px-3 py-1">Skip</button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="relative mb-12">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-50" style={{ background: "radial-gradient(circle, oklch(0.92 0.21 122 / 0.5), transparent 70%)" }} />
          <div className="relative w-48 h-48 rounded-3xl glass flex items-center justify-center lime-glow">
            <Icon className="w-20 h-20 text-primary" strokeWidth={1.4} />
          </div>
        </div>
        <h2 className="text-[28px] font-bold text-white leading-tight max-w-[300px]">{slide.title}</h2>
        <p className="text-[14px] text-[#999] mt-4 max-w-[300px]" style={{ lineHeight: 1.6 }}>{slide.sub}</p>
      </div>

      <div className="flex items-center justify-center gap-1.5 mb-6">
        {SLIDES.map((_, idx) => (
          <div key={idx}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: idx === i ? 24 : 6,
              background: idx === i ? "var(--color-primary)" : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>

      {isLast ? (
        <button onClick={onDone} className="btn-primary w-full">
          Create My Wallet <ArrowRight className="w-5 h-5" />
        </button>
      ) : (
        <div className="flex items-center justify-between">
          <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}
            className="btn-ghost disabled:opacity-30">Back</button>
          <button onClick={() => setI((v) => v + 1)} className="btn-primary">
            Next <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
