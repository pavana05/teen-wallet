import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

/**
 * Premium offline overlay.
 * - Auto-shows when navigator goes offline (and on a failed connectivity ping).
 * - Auto-dismisses the moment connectivity is restored.
 * - Themed with the app's design tokens; works in both dark + light premium themes.
 */
export function OfflineOverlay() {
  const [offline, setOffline] = useState(false);
  const [closing, setClosing] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const setOnline = () => {
      // Play a brief exit animation before unmounting.
      setClosing(true);
      window.setTimeout(() => {
        setOffline(false);
        setClosing(false);
      }, 320);
    };
    const setOff = () => {
      setClosing(false);
      setOffline(true);
    };

    // Initial state
    if (!navigator.onLine) setOff();

    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOff);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOff);
    };
  }, []);

  // Background poll while offline — some devices keep `navigator.onLine === true`
  // even when there's no real connectivity. Ping a tiny endpoint every 4s.
  useEffect(() => {
    if (!offline) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("https://www.gstatic.com/generate_204", {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
        });
        if (!cancelled && (res.ok || res.type === "opaque")) {
          // Connectivity is back even if the OS event didn't fire.
          window.dispatchEvent(new Event("online"));
        }
      } catch {
        /* still offline */
      }
    };
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [offline]);

  const handleRetry = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await fetch("https://www.gstatic.com/generate_204", {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
      });
      // If the fetch resolved at all, treat as online.
      window.dispatchEvent(new Event("online"));
    } catch {
      /* still offline — keep overlay */
    } finally {
      window.setTimeout(() => setChecking(false), 600);
    }
  };

  if (!offline) return null;

  return (
    <div
      className={`offline-overlay ${closing ? "is-closing" : "is-open"}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      aria-describedby="offline-desc"
    >
      <div className="offline-backdrop" aria-hidden="true" />
      <div className="offline-card">
        <div className="offline-glow" aria-hidden="true" />

        <div className="offline-icon-wrap" aria-hidden="true">
          <span className="offline-icon-ring" />
          <span className="offline-icon-ring offline-icon-ring-2" />
          <span className="offline-icon-tile">
            <WifiOff strokeWidth={2.2} className="offline-icon-svg" />
          </span>
        </div>

        <h2 id="offline-title" className="offline-title">
          You're offline
        </h2>
        <p id="offline-desc" className="offline-sub">
          Check your Wi-Fi or mobile data. We'll reconnect automatically the moment you're back online.
        </p>

        <div className="offline-status">
          <span className="offline-pulse" />
          <span>Waiting for connection…</span>
        </div>

        <button
          type="button"
          onClick={handleRetry}
          className="offline-btn"
          disabled={checking}
        >
          <RefreshCw
            className={`h-4 w-4 ${checking ? "animate-spin" : ""}`}
            strokeWidth={2.4}
          />
          <span>{checking ? "Checking…" : "Try again"}</span>
        </button>
      </div>
    </div>
  );
}

export default OfflineOverlay;
