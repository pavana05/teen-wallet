// Route registration / health page.
// Confirms TanStack Start routes are loaded (no 404s) and lists every
// /preview/* path with quick links so devs/QA can jump anywhere.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/diagnostics/routes")({
  head: () => ({
    meta: [
      { title: "Route Health · Teen Wallet" },
      { name: "description", content: "Verifies TanStack file routes are loaded and lists preview paths." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RouteHealthPage,
});

interface PingResult {
  path: string;
  ok: boolean | null; // null = pending
  status?: number;
  ms?: number;
  error?: string;
}

const KNOWN_ROUTES: { path: string; label: string; group: "core" | "preview" | "admin" | "diagnostics" }[] = [
  { path: "/", label: "App (single route)", group: "core" },
  { path: "/preview", label: "Preview index", group: "preview" },
  { path: "/preview/splash", label: "Splash", group: "preview" },
  { path: "/preview/auth-phone", label: "Phone auth", group: "preview" },
  { path: "/preview/phone-verified", label: "Phone verified", group: "preview" },
  { path: "/preview/permissions", label: "Permissions", group: "preview" },
  { path: "/preview/kyc-flow", label: "KYC flow", group: "preview" },
  { path: "/preview/kyc-pending", label: "KYC pending", group: "preview" },
  { path: "/preview/kyc-approved", label: "KYC approved", group: "preview" },
  { path: "/preview/kyc-rejected", label: "KYC rejected", group: "preview" },
  { path: "/preview/scan-pay", label: "Scan & pay", group: "preview" },
  { path: "/preview/profile-help", label: "Profile help", group: "preview" },
  { path: "/preview/referral-program", label: "Referral", group: "preview" },
  { path: "/admin/login", label: "Admin login", group: "admin" },
  { path: "/diagnostics/routes", label: "This page", group: "diagnostics" },
];

function RouteHealthPage() {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, PingResult>>({});
  const [running, setRunning] = useState(false);

  const registered = useMemo(() => {
    // Pull every route id the router knows about
    const ids = Object.keys(router.routesById ?? {});
    const set = new Set(ids);
    return KNOWN_ROUTES.map((r) => ({
      ...r,
      registered: set.has(r.path),
    }));
  }, [router]);

  const pingAll = async () => {
    if (running) return;
    setRunning(true);
    const init: Record<string, PingResult> = {};
    for (const r of KNOWN_ROUTES) init[r.path] = { path: r.path, ok: null };
    setResults(init);

    await Promise.all(
      KNOWN_ROUTES.map(async (r) => {
        const start = performance.now();
        try {
          const res = await fetch(r.path, { method: "GET", redirect: "manual" });
          const ms = Math.round(performance.now() - start);
          // 2xx, 3xx (boot redirects) and 4xx-on-protected pages are all "registered".
          // We only treat hard 404 as failure.
          const ok = res.status !== 404;
          setResults((prev) => ({
            ...prev,
            [r.path]: { path: r.path, ok, status: res.status, ms },
          }));
        } catch (e: unknown) {
          const ms = Math.round(performance.now() - start);
          setResults((prev) => ({
            ...prev,
            [r.path]: {
              path: r.path,
              ok: false,
              ms,
              error: e instanceof Error ? e.message : String(e),
            },
          }));
        }
      }),
    );
    setRunning(false);
  };

  useEffect(() => { void pingAll(); /* eslint-disable-next-line */ }, []);

  const totalRegistered = registered.filter((r) => r.registered).length;
  const totalRoutes = registered.length;
  const pinged = Object.values(results);
  const okCount = pinged.filter((r) => r.ok === true).length;
  const failCount = pinged.filter((r) => r.ok === false).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Route health</h1>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 24 }}>
          Verifies TanStack Start file routes are loaded and pings each preview path. Useful for
          spotting stale builds, missing routes, and 404s.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Stat label="Routes registered" value={`${totalRegistered}/${totalRoutes}`} ok={totalRegistered === totalRoutes} />
          <Stat label="Reachable (HTTP)" value={`${okCount}/${totalRoutes}`} ok={okCount === totalRoutes && pinged.length > 0} />
          <Stat label="404 / failures" value={String(failCount)} ok={failCount === 0} />
          <button
            onClick={pingAll}
            disabled={running}
            style={{
              padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
              border: "1px solid var(--border)",
              background: "var(--card)", color: "var(--foreground)",
              cursor: running ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {running ? "Pinging…" : "Re-run checks"}
          </button>
        </div>

        {(["core", "preview", "admin", "diagnostics"] as const).map((group) => {
          const items = registered.filter((r) => r.group === group);
          if (!items.length) return null;
          return (
            <section key={group} style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6, marginBottom: 8 }}>
                {group}
              </h2>
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "var(--card)",
                }}
              >
                {items.map((r, idx) => {
                  const ping = results[r.path];
                  return (
                    <div
                      key={r.path}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "24px 1fr auto auto auto",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        borderTop: idx === 0 ? undefined : "1px solid var(--border)",
                        fontSize: 13,
                      }}
                    >
                      <StatusDot registered={r.registered} ping={ping} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{r.label}</div>
                        <code style={{ fontSize: 11, opacity: 0.65 }}>{r.path}</code>
                      </div>
                      <span style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                        {ping?.status ? `HTTP ${ping.status}` : ping?.ok === null ? "…" : ping?.error ? "fail" : ""}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.55, fontVariantNumeric: "tabular-nums", minWidth: 42, textAlign: "right" }}>
                        {ping?.ms != null ? `${ping.ms}ms` : ""}
                      </span>
                      <Link
                        to={r.path as never}
                        style={{
                          fontSize: 12,
                          color: "var(--primary)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        Open <ExternalLink size={11} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--card)",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6 }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 22,
          fontWeight: 600,
          color: ok ? "var(--primary)" : "var(--destructive, #ef4444)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusDot({ registered, ping }: { registered: boolean; ping?: PingResult }) {
  if (!registered) {
    return <XCircle size={16} style={{ color: "var(--destructive, #ef4444)" }} />;
  }
  if (!ping || ping.ok === null) {
    return <Loader2 size={16} className="animate-spin" style={{ opacity: 0.6 }} />;
  }
  if (ping.ok) {
    return <CheckCircle2 size={16} style={{ color: "#22c55e" }} />;
  }
  return <XCircle size={16} style={{ color: "var(--destructive, #ef4444)" }} />;
}
