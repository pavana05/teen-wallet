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
