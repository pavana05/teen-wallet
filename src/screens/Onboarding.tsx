import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, Zap, ShieldCheck, Gift } from "lucide-react";
import walletImg from "@/assets/onboarding-wallet.jpg";
import paymentImg from "@/assets/onboarding-payment.jpg";
import shieldImg from "@/assets/onboarding-shield.jpg";
import giftImg from "@/assets/onboarding-gift.jpg";
import { TWLogo } from "@/components/TWLogo";

interface Slide {
  hero: string;
  iconBadge?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: React.ReactNode;
  sub: string;
}

const SLIDES: Slide[] = [
  {
    hero: walletImg,
    title: (
      <>
        Payments for the<br />
        <span className="ob-accent ob-accent-pink">new gen champions.</span>
      </>
    ),
    sub: "Fast. Secure. Rewarding.",
  },
  {
    hero: paymentImg,
    iconBadge: Zap,
    title: (
      <>
        Lightning fast<br />
        <span className="ob-accent ob-accent-blue">payments</span>
      </>
    ),
    sub: "Send or receive money in seconds using UPI. No delays, just instant vibes.",
  },
  {
    hero: shieldImg,
    iconBadge: ShieldCheck,
    title: (
      <>
        Secure beyond<br />
        <span className="ob-accent ob-accent-purple">limits</span>
      </>
    ),
    sub: "Bank-grade security keeps your money and data always protected.",
  },
  {
    hero: giftImg,
    iconBadge: Gift,
    title: (
      <>
        Earn <span className="ob-accent ob-accent-orange">rewards</span><br />
        <span className="ob-accent ob-accent-orange">every time</span>
      </>
    ),
    sub: "Get TW Coins on every payment and unlock exciting rewards just for you.",
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [animKey, setAnimKey] = useState(0);
  const touchStart = useRef<number | null>(null);

  const isLast = i === SLIDES.length - 1;
  const isFirst = i === 0;
  const slide = SLIDES[i];

  const goNext = () => {
    if (isLast) { onDone(); return; }
    setDirection("forward");
    setI((v) => v + 1);
    setAnimKey((k) => k + 1);
  };
  const goBack = () => {
    if (isFirst) return;
    setDirection("back");
    setI((v) => v - 1);
    setAnimKey((k) => k + 1);
  };

  // Keyboard arrows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStart.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (dx < -40) goNext();
    else if (dx > 40) goBack();
  };

  const Badge = slide.iconBadge;

  return (
    <div
      className="ob-root flex-1 flex flex-col relative overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Ambient background glow that shifts per slide */}
      <div className={`ob-ambient ob-ambient-${i}`} aria-hidden="true" />
      <div className="ob-grain" aria-hidden="true" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-4">
        {/* dot pagination top-left */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {SLIDES.map((_, idx) => (
            <span
              key={idx}
              className="ob-top-dot"
              data-active={idx === i ? "true" : undefined}
              style={{ width: idx === i ? 18 : 6 }}
            />
          ))}
        </div>
        <button
          onClick={onDone}
          className="text-[13px] font-medium text-white/70 hover:text-white transition-colors px-2 py-1"
        >
          Skip
        </button>
      </div>

      {/* Slide stage */}
      <div
        key={animKey}
        className={`ob-stage flex-1 flex flex-col items-center justify-start px-6 pt-2 ${
          direction === "forward" ? "ob-enter-fwd" : "ob-enter-back"
        }`}
      >
        {/* Logo for slide 0 only */}
        {i === 0 && (
          <div className="ob-logo-wrap mt-4 flex flex-col items-center">
            <TWLogo size={56} />
            <p className="ob-brand-word mt-1.5">TEEN WALLET</p>
          </div>
        )}

        {/* Hero image */}
        <div className={`ob-hero-wrap ${i === 0 ? "mt-6" : "mt-8"}`}>
          <div className="ob-hero-glow" aria-hidden="true" />
          <img
            src={slide.hero}
            alt=""
            width={520}
            height={520}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            className="ob-hero-img"
            draggable={false}
          />
        </div>

        {/* Optional small icon badge above title (slides 2-4) */}
        {Badge && (
          <div className="ob-icon-badge mt-2">
            <Badge className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
        )}

        {/* Title */}
        <h2 className={`ob-title ${i === 0 ? "mt-5" : "mt-3"}`}>{slide.title}</h2>

        {/* Subtitle */}
        <p className="ob-sub mt-3">{slide.sub}</p>
      </div>

      {/* Footer controls */}
      <div className="relative z-10 px-6 pb-8 pt-2">
        {i === 0 ? (
          <>
            <button onClick={goNext} className="ob-cta-pill">
              <span>Get Started</span>
              <span className="ob-cta-arrow">
                <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
              </span>
            </button>
            <p className="text-center text-[11.5px] text-white/45 mt-3">
              Safe. Simple. Built for teens.
            </p>
          </>
        ) : isLast ? (
          <button onClick={goNext} className="ob-cta-pill">
            <span>Let's Go!</span>
            <span className="ob-cta-arrow">
              <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
            </span>
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <button onClick={goBack} className="ob-nav-circle" aria-label="Previous slide">
              <ArrowLeft className="w-4 h-4 text-white" strokeWidth={2.2} />
            </button>
            <button onClick={goNext} className="ob-nav-circle ob-nav-circle-light" aria-label="Next slide">
              <ArrowRight className="w-4 h-4 text-zinc-900" strokeWidth={2.4} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
