/**
 * In-app back navigation helper.
 *
 * Always keeps the user inside the WebView shell:
 * - If browser history has a previous entry that belongs to this app,
 *   step back through it (preserves scroll, no full reload).
 * - Otherwise navigate to the provided fallback route inside the SPA
 *   (default `/`) using TanStack Router so we never trigger a browser
 *   redirect or document reload.
 *
 * `navigate` is the function returned by `useNavigate()` from
 * `@tanstack/react-router`. We accept it as a parameter so this helper
 * stays framework-agnostic and can be unit tested.
 */
export type RouterNavigate = (opts: { to: string; replace?: boolean }) => void | Promise<unknown>;

export function goBackInApp(
  navigate: RouterNavigate,
  fallback: string = "/",
): void {
  if (typeof window === "undefined") return;

  // history.length > 1 means there's at least one prior entry in this tab.
  // It can include the initial blank entry on cold-start though, so we also
  // require a non-empty document.referrer that points at our own origin OR
  // a navigation type of "back_forward" / "navigate" within the SPA.
  const hasInternalHistory =
    window.history.length > 1 &&
    (() => {
      try {
        if (!document.referrer) return true; // SPA-internal nav has no referrer change
        const ref = new URL(document.referrer);
        return ref.origin === window.location.origin;
      } catch {
        return true;
      }
    })();

  if (hasInternalHistory) {
    window.history.back();
    return;
  }

  // No safe history entry — push to the fallback route inside the SPA.
  void navigate({ to: fallback, replace: true });
}
