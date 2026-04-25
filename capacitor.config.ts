import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.teenwallet.app",
  appName: "Teen Wallet",
  // Bundled web build (Play Store ready). For dev hot-reload, temporarily
  // uncomment the `server` block below and point it at your Lovable preview URL.
  webDir: "dist",
  // server: {
  //   url: "https://teen-wallet.lovable.app",
  //   cleartext: false,
  // },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
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
