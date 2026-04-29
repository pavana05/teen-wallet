import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { subscribe, flush } from "@/lib/offlineQueue";

/**
 * Floating pill that appears whenever the offline queue has pending actions.
 * Shows count + a manual retry button. Hidden when the queue is empty.
 *
 * Drop into any persistent layout (e.g., __root or PhoneShell). Premium
 * dark/white theme — no neon. Auto-positions above the bottom safe area.
 */
export function OfflineQueueStatus() {
  const [state, setState] = useState({ pending: 0, lastError: null as string | null, flushing: false });
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  );

  useEffect(() => subscribe(setState), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (state.pending === 0) return null;

  const label = state.flushing
    ? "Syncing…"
    : !online
      ? `${state.pending} action${state.pending === 1 ? "" : "s"} waiting for network`
      : `${state.pending} pending`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-queue-status"
      className="fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/85 px-4 py-2 text-xs text-white/85 shadow-lg backdrop-blur-md"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)" }}
    >
      {state.flushing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-white/70" strokeWidth={2.4} />
      ) : (
        <CloudOff className="h-3.5 w-3.5 text-white/70" strokeWidth={2.2} />
      )}
      <span className="font-medium">{label}</span>
      {online && !state.flushing && (
        <button
          type="button"
          onClick={() => { void flush(); }}
          className="ml-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/90 hover:bg-white/15 active:scale-95 transition"
        >
          Retry
        </button>
      )}
    </div>
  );
}
