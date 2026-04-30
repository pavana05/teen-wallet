// Reusable floating bottom dock — pinned to the phone shell on Home & Profile.
// Contains: Home & Profile tabs and a Scan FAB that launches the QR scanner
// as a fullscreen lightbox overlay (absolute inset-0 within the phone shell).
//
// Premium behavior:
//   • Scroll-aware collapse: scrolling DOWN on the nearest scrollable ancestor
//     contracts the pill to just the active tab; scrolling UP (or near top)
//     re-expands. Cross-screen consistent — auto-discovers the scroller.
//   • Animated active-tab indicator: a pill-shaped backdrop slides between
//     tabs with a spring-curve, using FLIP measurements so there are no
//     layout jumps when collapsed/expanded.
//   • Persistence: collapsed/expanded preference saved to localStorage and
//     restored on next mount so the UI resumes where the user left off.
//   • Reduced-motion: all transitions/animations disabled when the user
//     prefers reduced motion (matchMedia + CSS @media fallback).
//   • Tap feedback: haptics (already platform-aware) + on-press scale dip,
//     icon pulse, and a soft ripple bloom on every nav tap.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Home as HomeIcon, ScanLine, User } from "lucide-react";
import { ScanPay } from "@/screens/ScanPay";
import { haptics } from "@/lib/haptics";

interface DockProps {
  active: "home" | "profile";
  onHome?: () => void;
  onProfile?: () => void;
  /** Hide the dock (e.g. while a different overlay covers the shell). */
  hidden?: boolean;
}

const COLLAPSE_KEY = "tw_dock_collapsed_v1";

function readPersistedCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; }
  catch { return false; }
}
function persistCollapsed(v: boolean) {
  try { window.localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); }
  catch { /* ignore */ }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

export function FloatingDock({ active, onHome, onProfile, hidden }: DockProps) {
  const [scanLaunching, setScanLaunching] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Lazy initializer reads persisted preference so the dock resumes its
  // last state immediately without a frame of "wrong" layout.
  const [collapsed, setCollapsed] = useState<boolean>(readPersistedCollapsed);
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  const navRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const homeTabRef = useRef<HTMLButtonElement | null>(null);
  const profileTabRef = useRef<HTMLButtonElement | null>(null);
  // Position of the sliding active-tab indicator (left + width in px,
  // relative to the .fd-pill container).
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0, width: 0, ready: false,
  });

  // Persist collapsed preference whenever it changes.
  useEffect(() => { persistCollapsed(collapsed); }, [collapsed]);

  // Watch reduced-motion preference live.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    try { mq.addEventListener("change", onChange); }
    catch { mq.addListener(onChange); }
    return () => {
      try { mq.removeEventListener("change", onChange); }
      catch { mq.removeListener(onChange); }
    };
  }, []);

  // Scan launch handlers ----------------------------------------------------
  const launchScan = useCallback(() => {
    if (scanLaunching || scanOpen) return;
    void haptics.bloom();
    setScanLaunching(true);
    window.setTimeout(() => setScanOpen(true), 240);
    window.setTimeout(() => setScanLaunching(false), 520);
  }, [scanLaunching, scanOpen]);

  const closeScan = useCallback(() => setScanOpen(false), []);

  useEffect(() => {
    if (!scanOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeScan(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scanOpen, closeScan]);

  // Scroll-aware collapse — works on every screen by auto-discovering the
  // nearest scrollable ancestor (or window). Cross-screen consistent.
  useEffect(() => {
    if (reduced) return; // honor reduced-motion: no auto-collapse hijack
    const el = navRef.current;
    if (!el) return;

    let scroller: HTMLElement | Window = window;
    let p: HTMLElement | null = el.parentElement;
    while (p) {
      const oy = window.getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) {
        scroller = p; break;
      }
      p = p.parentElement;
    }

    const getY = () =>
      scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;

    let lastY = getY();
    let ticking = false;
    const THRESHOLD = 6;
    const TOP_EXPAND = 24;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = getY();
        const dy = y - lastY;
        if (y < TOP_EXPAND) setCollapsed(false);
        else if (dy > THRESHOLD) setCollapsed(true);
        else if (dy < -THRESHOLD) setCollapsed(false);
        lastY = y;
        ticking = false;
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll as EventListener);
  }, [reduced]);

  // Measure & position the sliding active-tab indicator.
  // Re-measure on: active change, collapse change, mount, viewport resize.
  useLayoutEffect(() => {
    const measure = () => {
      const pill = pillRef.current;
      const target = active === "home" ? homeTabRef.current : profileTabRef.current;
      if (!pill || !target) return;
      const pillRect = pill.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      // Hide indicator if target is collapsed to ~zero width
      if (tRect.width < 8) {
        setIndicator((prev) => ({ ...prev, ready: false }));
        return;
      }
      setIndicator({
        left: tRect.left - pillRect.left,
        width: tRect.width,
        ready: true,
      });
    };
    // Measure now and again after the collapse transition settles
    measure();
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 540);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
    };
  }, [active, collapsed, hidden]);

  const dockUi = (
    <>
      <nav
        ref={navRef}
        aria-label="Primary"
        aria-hidden={hidden ? "true" : "false"}
        data-collapsed={collapsed ? "true" : "false"}
        data-reduced={reduced ? "true" : "false"}
        className={`fd-shell fd-shell-fixed z-[60] ${hidden ? "opacity-0 pointer-events-none translate-y-3" : "opacity-100"}`}
      >
        <div className="flex items-center gap-3">
          <div ref={pillRef} className="fd-pill flex items-center relative mx-[116px] px-[8px]" role="tablist" aria-label="Sections">
            {/* Sliding active-tab indicator — absolutely positioned, animates left/width */}
            <span
              className="fd-tab-indicator"
              aria-hidden="true"
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: `${indicator.width}px`,
                opacity: indicator.ready ? 1 : 0,
              }}
            />
            {active !== "profile" && (
              <DockTab
                ref={homeTabRef}
                icon={HomeIcon}
                label="Home"
                active={active === "home"}
                collapsed={collapsed && active !== "home"}
                onClick={() => { void haptics.select(); onHome?.(); }}
              />
            )}
            <DockTab
              ref={profileTabRef}
              icon={User}
              label="Profile"
              active={active === "profile"}
              collapsed={collapsed && active !== "profile"}
              onClick={() => { void haptics.select(); onProfile?.(); }}
            />
          </div>
          {active !== "profile" && (
            <button
              type="button"
              onClick={launchScan}
              className="fd-fab"
              aria-label="Scan to pay"
              data-launching={scanLaunching ? "true" : "false"}
            >
              <span className="fd-fab-halo" aria-hidden="true" />
              <ScanLine className="w-6 h-6 text-black relative z-10" strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>
      </nav>

      {scanLaunching && (
        <div className="fd-launch" aria-hidden="true">
          <span className="fd-launch-bubble" />
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Portal the dock + launch overlay to <body> so position: fixed is
          never trapped by a transformed/scrolling ancestor (e.g. the
          ProfilePanel's absolute container or pull-to-refresh wrapper).
          This makes the dock truly viewport-pinned on every screen. */}
      {typeof document !== "undefined"
        ? createPortal(dockUi, document.body)
        : dockUi}

      {scanOpen && (
        <div
          className="absolute inset-0 z-[120] fd-scan-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="QR scanner"
        >
          <ScanPay onBack={closeScan} />
        </div>
      )}
    </>
  );
}

interface DockTabProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}

const DockTab = forwardRef<HTMLButtonElement, DockTabProps>(function DockTab(
  { icon: Icon, label, active, collapsed, onClick },
  ref,
) {
  // Per-tap pulse key — increments on each click so the icon-pulse
  // animation re-triggers even when pressing the same tab twice.
  const [pulseKey, setPulseKey] = useState(0);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Spawn a soft ripple at the press location for tactile feedback
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "fd-tab-ripple";
    ripple.style.left = `${e.clientX - rect.left}px`;
    ripple.style.top = `${e.clientY - rect.top}px`;
    btn.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 620);

    setPulseKey((k) => k + 1);
    onClick?.();
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-collapsed={collapsed ? "true" : "false"}
      className={`fd-tab flex flex-col items-center py-2 px-5 rounded-full focus:outline-none ${active ? "fd-tab-active text-white" : "text-white/55 hover:text-white/80"}`}
    >
      <Icon
        key={pulseKey}
        className="w-5 h-5 fd-tab-icon"
        strokeWidth={active ? 2 : 1.6}
        aria-hidden="true"
      />
      <span className={`text-[11px] mt-0.5 fd-tab-label ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
});

