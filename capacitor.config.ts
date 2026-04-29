import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.teenwallet.app",
  appName: "Teen Wallet",
  // This app uses TanStack Start (SSR + server functions), so it cannot be
  // bundled as static assets. Capacitor wraps the published Lovable URL.
  // `webDir` still has to point at SOMETHING that exists, so we use a tiny
  // bootstrap folder that just redirects — the real app loads from `server.url`.
  webDir: "capacitor-shell",
  server: {
    url: "https://teen-wallet.lovable.app",
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
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#050505",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#050505",
      overlaysWebView: false,
    },
  },
};

export default config;
