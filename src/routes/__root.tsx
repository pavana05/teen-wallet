import { useEffect } from "react";
import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { isNative } from "@/lib/native";
import { Toaster } from "@/components/ui/sonner";
import { ShakeToReport } from "@/components/ShakeToReport";
import { AppLockGate } from "@/components/app-lock/AppLockGate";
import { AppLockSetupPrompt } from "@/components/app-lock/AppLockSetupPrompt";
import { initNative } from "@/lib/native";
import { breadcrumb, captureError } from "@/lib/breadcrumbs";
import { installConsoleCapture } from "@/lib/consoleCapture";
import { installAppLockListeners } from "@/lib/appLock";
import { installOfflineQueue } from "@/lib/offlineQueue";

import { OfflineOverlay } from "@/components/OfflineOverlay";
import { GlobalErrorOverlay } from "@/components/GlobalErrorOverlay";
import { OfflineQueueStatus } from "@/components/OfflineQueueStatus";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="nf-root">
      <div className="nf-bg" aria-hidden="true">
        <div className="nf-orb nf-orb-1" />
        <div className="nf-orb nf-orb-2" />
        <div className="nf-orb nf-orb-3" />
        <div className="nf-grid" />
        <div className="nf-noise" />
      </div>

      <div className="nf-content">
        <div className="nf-eyebrow">
          <span className="nf-dot" />
          Lost in space
        </div>

        <h1 className="nf-title" aria-label="404">
          <span className="nf-digit nf-digit-1">4</span>
          <span className="nf-zero" aria-hidden="true">
            <span className="nf-zero-ring" />
            <span className="nf-zero-core" />
          </span>
          <span className="nf-digit nf-digit-2">4</span>
        </h1>

        <h2 className="nf-heading">This page drifted away</h2>
        <p className="nf-sub">
          The page you're looking for doesn't exist, was moved, or is taking a quiet moment off.
        </p>

        <div className="nf-actions">
          <Link to="/" className="nf-btn nf-btn-primary">
            <span>Go home</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
          <button
            type="button"
            onClick={() => { if (typeof window !== "undefined") window.history.back(); }}
            className="nf-btn nf-btn-ghost"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Teen wallet" },
      { name: "description", content: "Teen Wallet Connect is a fully functional payment app for Indian teens, offering secure transactions and KYC." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Teen wallet" },
      { property: "og:description", content: "Teen Wallet Connect is a fully functional payment app for Indian teens, offering secure transactions and KYC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Teen wallet" },
      { name: "twitter:description", content: "Teen Wallet Connect is a fully functional payment app for Indian teens, offering secure transactions and KYC." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/509dc2fd-646c-4f6e-adee-8388de206e82/id-preview-04982996--6a1f940a-fc84-41fb-9c88-54e80717a61e.lovable.app-1777113569371.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/509dc2fd-646c-4f6e-adee-8388de206e82/id-preview-04982996--6a1f940a-fc84-41fb-9c88-54e80717a61e.lovable.app-1777113569371.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(() => {
    installConsoleCapture();
    initNative();
    // Only the native app needs App Lock visibility/idle listeners.
    if (isNative()) installAppLockListeners();
    // Drain queued offline actions and install reconnect listeners.
    installOfflineQueue();
    breadcrumb("system.boot", { platform: typeof navigator !== "undefined" ? navigator.userAgent : undefined });

    const onError = (e: ErrorEvent) => captureError(e.error ?? e.message, { where: "window.onerror" });
    const onRejection = (e: PromiseRejectionEvent) => captureError(e.reason, { where: "window.unhandledrejection" });
    const onBackHint = async () => {
      try {
        const { toast } = await import("sonner");
        toast("Press back again to exit", { duration: 1800 });
      } catch { /* ignore */ }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("tw:back-exit-hint", onBackHint as EventListener);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("tw:back-exit-hint", onBackHint as EventListener);
    };
  }, []);

  // App Lock is for the user-facing app on native devices only.
  // Hide it on /admin/* and on web (where the OS-level lock isn't part of UX).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdminRoute = pathname.startsWith("/admin");
  const showAppLock = !isAdminRoute && isNative();

  return (
    <>
      <Outlet />
      <Toaster />
      <ShakeToReport />
      {showAppLock && <AppLockSetupPrompt />}
      {showAppLock && <AppLockGate />}
      
      <OfflineOverlay />
      <OfflineQueueStatus />
      <GlobalErrorOverlay />
    </>
  );
}
