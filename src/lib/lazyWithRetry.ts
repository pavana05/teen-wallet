import { lazy, type ComponentType } from "react";

/**
 * lazy() wrapper that retries failed dynamic imports.
 *
 * Vite/HMR can leave stale chunk URLs in memory after a rebuild — a tab that
 * was open across the redeploy then throws "Failed to fetch dynamically
 * imported module" when it tries to load a code-split route. We retry a few
 * times with backoff, and on the final attempt force a hard reload so the
 * client picks up the new asset manifest.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  opts: { retries?: number; delayMs?: number } = {},
): ReturnType<typeof lazy<T>> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 350;

  return lazy(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isChunkError =
          /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
        if (!isChunkError) throw err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }
        // Final attempt: hard-reload once so the new manifest is fetched.
        if (typeof window !== "undefined") {
          const KEY = "tw_lazy_reload_v1";
          try {
            const last = Number(sessionStorage.getItem(KEY) || "0");
            if (Date.now() - last > 10_000) {
              sessionStorage.setItem(KEY, String(Date.now()));
              window.location.reload();
              // Return a never-resolving promise to avoid surfacing the error
              // before the reload kicks in.
              return await new Promise<{ default: T }>(() => {});
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
    throw lastErr;
  });
}
