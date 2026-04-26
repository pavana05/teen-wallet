import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, Zap, ShieldCheck, Gift, Wallet, Sparkles } from "lucide-react";
import walletImg from "@/assets/onboarding-wallet.jpg";
import paymentImg from "@/assets/onboarding-payment.jpg";
import shieldImg from "@/assets/onboarding-shield.jpg";
import giftImg from "@/assets/onboarding-gift.jpg";
import { TWLogo } from "@/components/TWLogo";

const ONBOARDING_STATE_KEY = "tw-onboarding-state-v1";
interface PersistedOnboarding { slide: number; completed: boolean; updatedAt: string; }
function readOnboardingState(): PersistedOnboarding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ONBOARDING_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedOnboarding;
  } catch { return null; }
}
function writeOnboardingState(s: PersistedOnboarding) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Swipe tuning — distance OR velocity must exceed thresholds for a slide change.
const SWIPE_MIN_DISTANCE = 48;       // px
const SWIPE_MIN_VELOCITY = 0.35;     // px/ms — fast flicks shorter than 48px still count
const SWIPE_MAX_DURATION = 600;      // ms — anything slower is treated as a drag, not a swipe

interface Slide {
  hero: string;
  iconBadge?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: React.ReactNode;
  /** Plain-text title used for screen-reader announcements (no JSX). */
  srTitle: string;
  sub: string;
  // Offline-safe placeholder used when the hero image fails to load
  fallbackIcon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  fallbackGradient: string;
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
    fallbackIcon: Wallet,
    fallbackGradient: "linear-gradient(135deg, #ff5d8f 0%, #c026d3 60%, #4f46e5 100%)",
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
    fallbackIcon: Sparkles,
    fallbackGradient: "linear-gradient(135deg, #38bdf8 0%, #6366f1 60%, #1e1b4b 100%)",
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
    fallbackIcon: ShieldCheck,
    fallbackGradient: "linear-gradient(135deg, #a855f7 0%, #6366f1 60%, #1e1b4b 100%)",
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
    fallbackIcon: Gift,
    fallbackGradient: "linear-gradient(135deg, #fb923c 0%, #f43f5e 60%, #7c2d12 100%)",
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  // Resume on the last slide the user was viewing — but only if they hadn't completed.
  // We initialize from a sync read so the first paint is already on the right slide.
  const initialSlide = (() => {
    const s = readOnboardingState();
    if (!s || s.completed) return 0;
    return Math.min(Math.max(0, s.slide), SLIDES.length - 1);
  })();
  const [i, setI] = useState(initialSlide);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [animKey, setAnimKey] = useState(0);
  // Track failed image loads so we can swap in an offline-safe gradient + icon.
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  // Touch state — record both x position and timestamp for velocity calculation
  const touchStart = useRef<{ x: number; t: number } | null>(null);

  const isLast = i === SLIDES.length - 1;
  const isFirst = i === 0;
  const slide = SLIDES[i];

  // Persist slide changes (debounced via state lifecycle, not interval).
  useEffect(() => {
    writeOnboardingState({ slide: i, completed: false, updatedAt: new Date().toISOString() });
  }, [i]);

  const finishOnboarding = () => {
    writeOnboardingState({ slide: SLIDES.length - 1, completed: true, updatedAt: new Date().toISOString() });
    onDone();
  };

  const goNext = () => {
    if (isLast) { finishOnboarding(); return; }
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

  // Tuned swipe — accept if either distance OR velocity threshold passes,
  // and the gesture wasn't a slow drag (>600ms reads as scroll/hover intent).
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dt = Math.max(1, Date.now() - start.t);
    if (dt > SWIPE_MAX_DURATION) return;
    const velocity = Math.abs(dx) / dt; // px/ms
    const passes = Math.abs(dx) >= SWIPE_MIN_DISTANCE || velocity >= SWIPE_MIN_VELOCITY;
    if (!passes) return;
    if (dx < 0) goNext();
    else goBack();
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
          onClick={finishOnboarding}
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

        {/* Hero image — with offline-safe fallback if asset fails to load */}
        <div className={`ob-hero-wrap ${i === 0 ? "mt-6" : "mt-8"}`}>
          <div className="ob-hero-glow" aria-hidden="true" />
          {failedImages[i] ? (
            <div
              className="ob-hero-img ob-hero-fallback"
              style={{ background: slide.fallbackGradient }}
              aria-hidden="true"
            >
              <slide.fallbackIcon className="ob-hero-fallback-icon" strokeWidth={1.6} />
            </div>
          ) : (
            <img
              src={slide.hero}
              alt=""
              width={520}
              height={520}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="ob-hero-img"
              draggable={false}
              onError={() => setFailedImages((prev) => ({ ...prev, [i]: true }))}
            />
          )}
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
