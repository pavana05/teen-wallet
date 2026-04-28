import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";

/**
 * Initialise Capacitor-only behaviour. Safe no-op in the web preview.
 * Call once during app startup.
 */
export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050505" });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* StatusBar not available */
  }

  try {
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch {
    /* Splash already hidden */
  }

  // Hardware back button: behave like a real app.
  // - If the WebView has history, go back one page.
  // - If we're on a nested route with no history (deep-link / fresh boot),
  //   navigate to a sensible parent route instead of exiting.
  // - Only exit the app when the user is on the home/root screen and
  //   double-taps back within 2 seconds.
  try {
    let lastBackPress = 0;
    App.addListener("backButton", ({ canGoBack }) => {
      const path = window.location.pathname || "/";
      const isRoot = path === "/" || path === "/home" || path === "/onboarding";

      if (canGoBack && !isRoot) {
        window.history.back();
        return;
      }

      if (!isRoot) {
        // Deep-linked into a nested route with no history — go to /home.
        const parent = path.split("/").slice(0, -1).join("/") || "/home";
        window.history.replaceState({}, "", parent);
        window.dispatchEvent(new PopStateEvent("popstate"));
        return;
      }

      // On a root screen — require double-tap back to exit.
      const now = Date.now();
      if (now - lastBackPress < 2000) {
        App.exitApp();
      } else {
        lastBackPress = now;
        try {
          // Lightweight toast hint via custom event; UI layer can show it.
          window.dispatchEvent(new CustomEvent("tw:back-exit-hint"));
        } catch { /* ignore */ }
      }
    });
  } catch {
    /* App plugin not available */
  }
}

export const isNative = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();
