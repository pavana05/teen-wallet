import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession, ROLE_LABELS, ROLE_BADGE } from "@/admin/lib/adminAuth";
import {
  LayoutDashboard, Users, ShieldAlert, FileCheck2, Wallet, Settings, LogOut,
  Bell, Activity, Search, ChevronLeft, ChevronRight, Command, MessageSquareWarning, ImageIcon,
} from "lucide-react";
import { PerfOverlay } from "@/admin/components/PerfOverlay";
import { CommandPalette } from "@/admin/components/CommandPalette";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const SIDEBAR_KEY = "tw_admin_sidebar_collapsed_v1";

function AdminLayout() {
  const nav = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { admin, loading, logout, expiresAt } = useAdminSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLoginRoute = pathname === "/admin/login";

  useEffect(() => {
    setMounted(true);
    try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1"); } catch { /* noop */ }
  }, []);
  useEffect(() => {
    if (mounted) try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch { /* noop */ }
  }, [collapsed, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (!loading && !admin && !isLoginRoute) {
      nav({ to: "/admin/login" });
    }
  }, [mounted, loading, admin, isLoginRoute, nav]);

  if (!mounted) return <div className="admin-shell" suppressHydrationWarning />;
  if (isLoginRoute) return <div className="admin-shell"><Outlet /></div>;
  if (loading) {
    return (
      <div className="admin-shell flex items-center justify-center" style={{ minHeight: "100vh" }}>
        <div className="a-mono text-sm" style={{ color: "var(--a-muted)" }}>Verifying session…</div>
      </div>
    );
  }
  if (!admin) return <div className="admin-shell" />;

  const items = [
    { to: "/admin", label: "Command Center", icon: LayoutDashboard, end: true, kbd: "g d" },
    { to: "/admin/users", label: "Users", icon: Users, kbd: "g u" },
    { to: "/admin/kyc", label: "KYC Queue", icon: FileCheck2, kbd: "g k" },
    { to: "/admin/transactions", label: "Transactions", icon: Wallet, kbd: "g t" },
    { to: "/admin/fraud", label: "Fraud", icon: ShieldAlert, kbd: "g f" },
    { to: "/admin/reports", label: "Issue Reports", icon: MessageSquareWarning, kbd: "g r" },
    { to: "/admin/campaigns", label: "Gender Campaigns", icon: Bell, kbd: "g c" },
    { to: "/admin/diagnostics", label: "Diagnostics", icon: Activity },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ];
  const sideW = collapsed ? 64 : 240;

  return (
    <div className="admin-shell flex">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        style={{
          width: sideW, transition: "width 180ms cubic-bezier(.2,.7,.3,1)",
          borderRight: "1px solid var(--a-border)",
          background: "linear-gradient(180deg, var(--a-surface) 0%, var(--a-bg) 100%)",
          minHeight: "100vh", display: "flex", flexDirection: "column",
          position: "sticky", top: 0,
        }}
      >
        <div style={{ padding: collapsed ? "16px 8px" : "20px 16px", borderBottom: "1px solid var(--a-border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: "var(--a-grad-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "#0a0a0b", fontSize: 13,
              boxShadow: "0 4px 12px -4px rgba(200,241,53,0.6)",
              flexShrink: 0,
            }}
          >TW</div>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div className="a-mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: "var(--a-text)" }}>TEEN WALLET</div>
              <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 1 }}>Admin Console</div>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: 8 }}>
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to as never}
              activeOptions={{ exact: !!it.end }}
              activeProps={{ style: { background: "var(--a-elevated)", color: "var(--a-accent)", borderLeft: "2px solid var(--a-accent)" } }}
              title={collapsed ? `${it.label}${it.kbd ? ` (${it.kbd})` : ""}` : undefined}
              style={{
                display: "flex", alignItems: "center",
                gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? "center" : "flex-start",
                padding: collapsed ? "10px 0" : "10px 14px",
                fontSize: 13, color: "var(--a-text)", borderRadius: 6,
                borderLeft: "2px solid transparent", marginBottom: 2,
                transition: "background 120ms",
              }}
            >
              <it.icon size={16} />
              {!collapsed && <span style={{ flex: 1 }}>{it.label}</span>}
              {!collapsed && it.kbd && (
                <span className="a-mono" style={{ fontSize: 9, color: "var(--a-muted)", letterSpacing: "0.05em" }}>{it.kbd}</span>
              )}
            </Link>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            margin: 8, padding: "6px", borderRadius: 6,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            color: "var(--a-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div style={{ padding: collapsed ? 8 : 12, borderTop: "1px solid var(--a-border)" }}>
          {collapsed ? (
            <button
              onClick={async () => { await logout(); nav({ to: "/admin/login" }); }}
              title={`Logout (${admin.email})`}
              style={{ width: "100%", padding: 8, borderRadius: 6, background: "var(--a-surface-2)", border: "1px solid var(--a-border)", color: "var(--a-text)", cursor: "pointer", display: "flex", justifyContent: "center" }}
            >
              <LogOut size={14} />
            </button>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{admin.name}</div>
              <div style={{ fontSize: 11, color: "var(--a-muted)", marginBottom: 8 }} className="a-mono">{admin.email}</div>
              <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${ROLE_BADGE[admin.role]}`}>{ROLE_LABELS[admin.role]}</span>
              <button
                onClick={async () => { await logout(); nav({ to: "/admin/login" }); }}
                className="a-btn a-btn-ghost mt-3"
                style={{ width: "100%", fontSize: 12 }}
              >
                <LogOut size={14} /> Logout
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar pathname={pathname} expiresAt={expiresAt} />
        <main style={{ flex: 1, padding: 24, width: "100%", maxWidth: 1440, margin: "0 auto" }}>
          <Outlet />
        </main>
      </div>
      <PerfOverlay />
      <CommandPalette />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Topbar with breadcrumbs + ⌘K trigger + env badge
// ─────────────────────────────────────────────────────────────────────────────
function Topbar({ pathname, expiresAt }: { pathname: string; expiresAt: string | null }) {
  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean); // ["admin", ...]
    return parts.map((p, i) => ({
      label: prettify(p),
      href: "/" + parts.slice(0, i + 1).join("/"),
    }));
  }, [pathname]);

  const env = (typeof window !== "undefined" && window.location.hostname.includes("lovable.app"))
    ? (window.location.hostname.includes("preview") ? "PREVIEW" : "PROD")
    : "DEV";

  // Open palette by dispatching ⌘K — keeps a single source of truth.
  const openPalette = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };

  return (
    <header
      style={{
        height: 56, borderBottom: "1px solid var(--a-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        background: "color-mix(in oklab, var(--a-surface) 86%, transparent)",
        backdropFilter: "blur(10px)",
        position: "sticky", top: 0, zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
        <span
          className="a-mono"
          style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 3,
            border: `1px solid ${env === "PROD" ? "var(--a-success)" : env === "PREVIEW" ? "var(--a-warn)" : "var(--a-border)"}`,
            color: env === "PROD" ? "var(--a-success)" : env === "PREVIEW" ? "var(--a-warn)" : "var(--a-muted)",
            letterSpacing: "0.08em",
          }}
        >{env}</span>
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--a-muted)", overflow: "hidden" }}>
          {crumbs.map((c, i) => (
            <span key={c.href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "var(--a-border-strong)" }}>/</span>}
              <Link
                to={c.href as never}
                style={{ color: i === crumbs.length - 1 ? "var(--a-text)" : "var(--a-muted)" }}
              >{c.label}</Link>
            </span>
          ))}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={openPalette}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px", minWidth: 220,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            borderRadius: 8, color: "var(--a-muted)", fontSize: 12, cursor: "pointer",
            transition: "border-color 120ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--a-border-strong)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--a-border)")}
        >
          <Search size={13} />
          <span style={{ flex: 1, textAlign: "left" }}>Search or jump…</span>
          <span className="a-mono" style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, color: "var(--a-muted)" }}>
            <Command size={10} /> K
          </span>
        </button>

        <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>
          Session {expiresAt ? new Date(expiresAt).toLocaleTimeString() : "—"}
        </span>

        <button
          className="a-btn a-btn-ghost"
          style={{ padding: "6px 10px", fontSize: 12 }}
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell size={14} />
        </button>
      </div>
    </header>
  );
}

function prettify(seg: string) {
  if (/^[0-9a-f]{8}-/.test(seg)) return seg.slice(0, 8) + "…";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
