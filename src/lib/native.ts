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

const APP_HOSTS = new Set(["teenwallet.app", "www.teenwallet.app", "teen-wallet.lovable.app"]);

function installNativeNavigationGuard() {
  const w = window as typeof window & { __teenWalletNativeNavGuard?: boolean; __teenWalletOpen?: typeof window.open };
  if (w.__teenWalletNativeNavGuard) return;
  w.__teenWalletNativeNavGuard = true;

  const toUrl = (raw: string | URL) => {
    try { return new URL(String(raw), window.location.href); }
    catch { return null; }
  };

  window.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
    const rawHref = anchor?.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;

    const url = toUrl(rawHref);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return;

    event.preventDefault();
    if (APP_HOSTS.has(url.hostname)) {
      window.location.assign(`${url.pathname}${url.search}${url.hash}`);
    }
  }, true);

  w.__teenWalletOpen = window.open;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (!url) return null;
    const parsed = toUrl(url);
    if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      if (APP_HOSTS.has(parsed.hostname)) {
        window.location.assign(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        return window;
      }
      return null;
    }
    return w.__teenWalletOpen?.call(window, String(url), target, features) ?? null;
  }) as typeof window.open;
}
