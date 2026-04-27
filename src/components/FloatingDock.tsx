// Reusable floating bottom dock — pinned to the phone shell on Home & Profile.
// Contains: Home tab, Profile tab, and a Scan FAB that launches the QR scanner
// as a fullscreen lightbox overlay (absolute inset-0 within the phone shell).
//
// Animations are subtle & premium: 220ms ease-out scale on tap, soft glow halo
// behind the FAB, smooth icon morph on launch (ScanLine → liquid bubble fill).
import { useCallback, useEffect, useState } from "react";
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

  const launchScan = useCallback(() => {
    if (scanLaunching || scanOpen) return;
    void haptics.select();
    setScanLaunching(true);
    // Mount the scanner under the liquid bubble, then fade the bubble out.
    window.setTimeout(() => setScanOpen(true), 240);
    window.setTimeout(() => setScanLaunching(false), 520);
  }, [scanLaunching, scanOpen]);

  const closeScan = useCallback(() => setScanOpen(false), []);

  // Close scanner on Escape for accessibility.
  useEffect(() => {
    if (!scanOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeScan(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scanOpen, closeScan]);

  return (
    <>
      <nav
        aria-label="Primary"
        aria-hidden={hidden ? "true" : "false"}
        className={`fd-shell absolute bottom-5 left-1/2 -translate-x-1/2 z-[55] transition-all duration-300 ease-out ${hidden ? "opacity-0 pointer-events-none translate-y-3" : "opacity-100"}`}
      >
        <div className="flex items-center gap-3">
          <div className="fd-pill flex items-center" role="tablist" aria-label="Sections">
            <DockTab
              icon={HomeIcon}
              label="Home"
              active={active === "home"}
              onClick={() => { void haptics.select(); onHome?.(); }}
            />
            <DockTab
              icon={User}
              label="Profile"
              active={active === "profile"}
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

      {/* Liquid bubble that grows from the FAB into the lightbox */}
      {scanLaunching && (
        <div className="fd-launch" aria-hidden="true">
          <span className="fd-launch-bubble" />
        </div>
      )}

      {/* Fullscreen scanner lightbox — confined to the phone shell. */}
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
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`fd-tab flex-1 flex flex-col items-center py-2 px-5 rounded-full transition-colors focus:outline-none ${active ? "fd-tab-active text-white" : "text-white/55 hover:text-white/80"}`}
    >
      <Icon className="w-5 h-5 fd-tab-icon" strokeWidth={active ? 2 : 1.6} aria-hidden="true" />
      <span className={`text-[11px] mt-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}
