import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.teenwallet.app",
  appName: "Teen Wallet",
  // This app uses TanStack Start (SSR + server functions), so it cannot be
  // bundled as static assets. Capacitor wraps the canonical published domain.
  // Use the final domain directly so native launch does not follow a web
  // redirect from the old lovable.app host into the external browser.
  // `webDir` still has to point at SOMETHING that exists, so we use a tiny
  // bootstrap folder for Capacitor's sanity check.
  webDir: "capacitor-shell",
  server: {
    url: "https://teenwallet.app",
    appStartPath: "/",
    cleartext: false,
    androidScheme: "https",
    allowNavigation: [
      "teenwallet.app",
      "www.teenwallet.app",
      "teen-wallet.lovable.app",
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
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
