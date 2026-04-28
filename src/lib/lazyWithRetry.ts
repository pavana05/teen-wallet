import { lazy, type ComponentType } from "react";
import { toast } from "sonner";

/**
 * lazy() wrapper that retries failed dynamic imports.
 *
 * Vite/HMR can leave stale chunk URLs in memory after a rebuild — a tab that
 * was open across the redeploy then throws "Failed to fetch dynamically
 * imported module" when it tries to load a code-split route. We retry a few
 * times with backoff, surface a user-visible toast with a "Retry now" action
 * during the retry window, and on the final attempt force a hard reload so the
 * client picks up the new asset manifest.
 *
 * On successful boot after a self-heal reload, we clear any stale
 * "Failed to fetch dynamically imported module" entries from the runtime
 * errors panel (see clearStaleChunkErrorsAfterReload below).
 */

const RELOAD_KEY = "tw_lazy_reload_v1";
const SUCCESS_KEY = "tw_lazy_last_success_v1";

const isChunkError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
};

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  opts: { retries?: number; delayMs?: number } = {},
) {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 350;

  return lazy<T>(async () => {
    let lastErr: unknown;
    let toastId: string | number | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory();
        if (toastId !== null) toast.dismiss(toastId);
        try { sessionStorage.setItem(SUCCESS_KEY, String(Date.now())); } catch { /* ignore */ }
        return mod;
      } catch (err) {
        lastErr = err;
        if (!isChunkError(err)) throw err;

        // First failure: show a toast explaining the retry, with a manual
        // "Retry now" button that triggers the hard reload immediately.
        if (attempt === 0 && typeof window !== "undefined") {
          toastId = toast.loading("Reconnecting to the latest app version…", {
            description: "A background update was detected. Retrying automatically.",
            duration: Infinity,
            action: {
              label: "Retry now",
              onClick: () => {
                try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
                window.location.reload();
              },
            },
          });
        }

        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }

        // Final attempt: hard-reload once so the new manifest is fetched.
        if (typeof window !== "undefined") {
          try {
            const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
            if (Date.now() - last > 10_000) {
              sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
              if (toastId !== null) toast.dismiss(toastId);
              window.location.reload();
              return await new Promise<{ default: T }>(() => {});
            }
          } catch { /* ignore */ }
        }
        if (toastId !== null) {
          toast.dismiss(toastId);
          toast.error("Couldn't reload the app", {
            description: "Please refresh the page to continue.",
          });
        }
      }
    }
    throw lastErr;
  });
}

/**
 * Call once on app boot. If the previous session triggered a self-heal reload
 * (RELOAD_KEY set within the last 60s) and the app is now booting cleanly,
 * fire a custom event so the runtime-error overlay can clear its stale
 * "Failed to fetch dynamically imported module" entries — they refer to chunk
 * URLs that no longer exist after the new manifest loaded.
 */
export function clearStaleChunkErrorsAfterReload() {
  if (typeof window === "undefined") return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
    if (!last || Date.now() - last > 60_000) return;
    // Mark the reload as consumed so we don't re-fire on subsequent navs.
    sessionStorage.removeItem(RELOAD_KEY);
    // Notify any listeners (the dev runtime-errors panel listens to this in
    // newer builds; harmless no-op otherwise).
    window.dispatchEvent(new CustomEvent("lovable:clear-runtime-errors", {
      detail: { reason: "chunk-reload", pattern: "Failed to fetch dynamically imported module" },
    }));
    // Also try the postMessage channel used by the editor preview overlay.
    try {
      window.parent?.postMessage(
        { type: "lovable:clear-runtime-errors", pattern: "Failed to fetch dynamically imported module" },
        "*",
      );
    } catch { /* ignore */ }
    toast.success("App updated", {
      description: "Reloaded to the latest version.",
      duration: 2500,
    });
  } catch { /* ignore */ }
}
