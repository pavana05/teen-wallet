// Reusable floating bottom dock — pinned to the phone shell on Home & Profile.
// Contains: Home tab, Profile tab, and a Scan FAB that launches the QR scanner
// as a fullscreen lightbox overlay (absolute inset-0 within the phone shell).
//
// Scroll behavior (premium, iOS-native feel):
//   • When the user scrolls DOWN on the nearest scrollable ancestor, the pill
//     collapses smoothly to show only the ACTIVE tab (icon + label), other
//     tabs fade & shrink out. Width animates from full → compact.
//   • When the user scrolls UP (or stops near top), the pill re-expands.
//   • Spring-like cubic-bezier curves; respects prefers-reduced-motion.
import { useCallback, useEffect, useRef, useState } from "react";
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

export function FloatingDock({ active, onHome, onProfile, hidden }: DockProps) {
  const [scanLaunching, setScanLaunching] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  const launchScan = useCallback(() => {
    if (scanLaunching || scanOpen) return;
    void haptics.select();
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

  // Track the nearest scrollable ancestor and collapse on scroll-down,
  // expand on scroll-up. Threshold avoids flicker on tiny gestures.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    // Find nearest scrollable ancestor
    let scroller: HTMLElement | Window = window;
    let p: HTMLElement | null = el.parentElement;
    while (p) {
      const oy = window.getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) {
        scroller = p;
        break;
      }
      p = p.parentElement;
    }

    let lastY = scroller === window
      ? window.scrollY
      : (scroller as HTMLElement).scrollTop;
    let ticking = false;
    const THRESHOLD = 6;
    const TOP_EXPAND = 24;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = scroller === window
          ? window.scrollY
          : (scroller as HTMLElement).scrollTop;
        const dy = y - lastY;

        if (y < TOP_EXPAND) {
          setCollapsed(false);
        } else if (dy > THRESHOLD) {
          setCollapsed(true);
        } else if (dy < -THRESHOLD) {
          setCollapsed(false);
        }
        lastY = y;
        ticking = false;
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll as EventListener);
  }, []);

  return (
    <>
      <nav
        ref={navRef}
        aria-label="Primary"
        aria-hidden={hidden ? "true" : "false"}
        data-collapsed={collapsed ? "true" : "false"}
        className={`fd-shell absolute bottom-5 left-1/2 -translate-x-1/2 z-[55] transition-all duration-[420ms] ease-out ${hidden ? "opacity-0 pointer-events-none translate-y-3" : "opacity-100"}`}
      >
        <div className="flex items-center gap-3">
          <div className="fd-pill flex items-center" role="tablist" aria-label="Sections">
            <DockTab
              icon={HomeIcon}
              label="Home"
              active={active === "home"}
              collapsed={collapsed && active !== "home"}
              onClick={() => { void haptics.select(); onHome?.(); }}
            />
            <DockTab
              icon={User}
              label="Profile"
              active={active === "profile"}
              collapsed={collapsed && active !== "profile"}
              onClick={() => { void haptics.select(); onProfile?.(); }}
            />
          </div>
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
        </div>
      </nav>

      {scanLaunching && (
        <div className="fd-launch" aria-hidden="true">
          <span className="fd-launch-bubble" />
        </div>
      )}

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

function DockTab({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-collapsed={collapsed ? "true" : "false"}
      className={`fd-tab flex-1 flex flex-col items-center py-2 px-5 rounded-full focus:outline-none ${active ? "fd-tab-active text-white" : "text-white/55 hover:text-white/80"}`}
    >
      <Icon className="w-5 h-5 fd-tab-icon" strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
      <span className={`text-[11px] mt-0.5 fd-tab-label ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}
