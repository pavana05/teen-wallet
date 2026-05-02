import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { registerPushNotifications } from "./pushTokens";
import { supabase } from "@/integrations/supabase/client";

/**
 * Initialise Capacitor-only behaviour. Safe no-op in the web preview.
 * Call once during app startup.
 */
export async function initNative() {
  // Always install the navigation guard (web + native) so internal links
  // never escape the app shell.
  try {
    installNativeNavigationGuard();
  } catch (e) {
    console.warn("[native] nav guard install failed", e);
  }

  if (!Capacitor.isNativePlatform()) return;

  // Wrap every native init step in its own try/catch so one failure
  // doesn't block the rest or crash the WebView.
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#050505" });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (e) {
    console.warn("[native] StatusBar init failed", e);
  }

  try {
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch (e) {
    console.warn("[native] SplashScreen hide failed", e);
  }

  // Robust hardware/gesture back-button handling on Android.
  try {
    App.addListener("backButton", () => {
      try {
        const onHome = window.location.pathname === "/" || window.location.pathname === "";
        const hasHistory = window.history.length > 1;

        if (hasHistory && !onHome) {
          window.history.back();
          return;
        }
        if (!onHome) {
          window.history.replaceState(null, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
          return;
        }
        App.exitApp();
      } catch {
        try { App.exitApp(); } catch { /* ignore */ }
      }
    });
  } catch (e) {
    console.warn("[native] backButton listener failed", e);
  }

  // Register for push when authenticated, and on auth changes
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) void registerPushNotifications().catch(() => {});
    supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void registerPushNotifications().catch(() => {});
    });
  } catch (e) {
    console.warn("[native] push registration init failed", e);
  }
}

// Global unhandled error/rejection safety net for native WebView.
// Prevents the WebView from showing a white screen on uncaught errors.
export function installNativeCrashGuard() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (e) => {
    console.error("[crash-guard] Uncaught error:", e.error?.message || e.message);
    // Don't let the error propagate to the WebView's default handler
    // which could trigger a crash dialog or white screen.
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("[crash-guard] Unhandled rejection:", e.reason?.message || e.reason);
  });
}

export const isNative = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();

const APP_HOSTS = new Set([
  "teenwallet.app",
  "www.teenwallet.app",
  "teen-wallet.lovable.app",
]);

// Schemes we intentionally hand off to the OS (mail, sms, tel, share intents).
const EXTERNAL_SCHEMES = new Set([
  "mailto:",
  "tel:",
  "sms:",
  "whatsapp:",
  "intent:",
  "market:",
  "geo:",
]);

function isInternalUrl(url: URL): boolean {
  // Same origin as the running app.
  if (url.origin === window.location.origin) return true;
  // Known production hosts for this app.
  if ((url.protocol === "http:" || url.protocol === "https:") && APP_HOSTS.has(url.hostname)) {
    return true;
  }
  return false;
}

function installNativeNavigationGuard() {
  const w = window as typeof window & {
    __teenWalletNativeNavGuard?: boolean;
    __teenWalletOpen?: typeof window.open;
  };
  if (w.__teenWalletNativeNavGuard) return;
  w.__teenWalletNativeNavGuard = true;

  const toUrl = (raw: string | URL) => {
    try { return new URL(String(raw), window.location.href); }
    catch { return null; }
  };

  // Capture-phase click interception so it runs before React handlers.
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return; // only left click
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;

    const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return;

    // In-page hash anchors: leave alone.
    if (rawHref.startsWith("#")) return;

    const url = toUrl(rawHref);
    if (!url) return;

    // OS hand-offs (mailto:, tel:, sms:, etc.) — allow.
    if (EXTERNAL_SCHEMES.has(url.protocol)) return;

    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    if (isInternalUrl(url)) {
      // Force in-app navigation, ignoring target="_blank".
      event.preventDefault();
      window.location.assign(`${url.pathname}${url.search}${url.hash}`);
      return;
    }

    // External URL: on native, block entirely; on web, also block to keep
    // users inside the app shell as requested.
    event.preventDefault();
  }, true);

  // Patch window.open so programmatic external pop-ups can't escape.
  w.__teenWalletOpen = window.open;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (!url) return null;
    const parsed = toUrl(url);

    if (parsed && EXTERNAL_SCHEMES.has(parsed.protocol)) {
      return w.__teenWalletOpen?.call(window, String(url), target, features) ?? null;
    }

    if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      if (isInternalUrl(parsed)) {
        window.location.assign(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        return window;
      }
      // External http(s) — block.
      return null;
    }

    return null;
  }) as typeof window.open;
}
