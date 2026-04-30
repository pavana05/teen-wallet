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
  installNativeNavigationGuard();

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

  try {
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp();
      }
    });
  } catch {
    /* App plugin not available */
  }

  // Register for push when authenticated, and on auth changes
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) void registerPushNotifications();
    supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) void registerPushNotifications();
    });
  } catch {
    /* push registration failed silently */
  }
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
