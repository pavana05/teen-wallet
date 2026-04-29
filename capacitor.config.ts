import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.teenwallet.app",
  appName: "Teen Wallet",
  // This app uses TanStack Start (SSR + server functions), so it cannot be
  // bundled fully offline. Instead we ship a branded splash shell in
  // `capacitor-shell/` that handles offline state and smoothly hands off to
  // the live web app — no redirect flash, no browser chrome, feels native.
  webDir: "capacitor-shell",
  server: {
    // Allow navigating to the published app from inside the WebView.
    allowNavigation: ["teen-wallet.lovable.app", "*.lovable.app", "*.supabase.co"],
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // Keep the OS splash visible until our HTML splash takes over, so
      // there's no white flash between native launch and web view paint.
      launchShowDuration: 1500,
      launchAutoHide: false,
      backgroundColor: "#050505",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      fadeOutDuration: 300,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#050505",
      overlaysWebView: false,
    },
  },
};

export default config;
