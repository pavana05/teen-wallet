import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminSession, ROLE_LABELS, ROLE_BADGE, callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import {
  LayoutDashboard, Users, ShieldAlert, FileCheck2, Wallet, Settings, LogOut,
  Bell, Activity, Search, ChevronLeft, ChevronRight, Command, MessageSquareWarning, ImageIcon,
  Sun, Moon, Rows3, Rows2, Sparkles,
} from "lucide-react";
import { PerfOverlay } from "@/admin/components/PerfOverlay";
import { CommandPalette } from "@/admin/components/CommandPalette";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const SIDEBAR_KEY = "tw_admin_sidebar_collapsed_v1";
const THEME_KEY = "tw_admin_theme_v1";        // 'dark' | 'light'
const DENSITY_KEY = "tw_admin_density_v1";    // 'comfortable' | 'compact'

type AdminTheme = "dark" | "light";
type AdminDensity = "comfortable" | "compact";

function AdminLayout() {
  const nav = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<AdminTheme>("dark");
  const [density, setDensity] = useState<AdminDensity>("comfortable");
  const { admin, loading, logout, expiresAt } = useAdminSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLoginRoute = pathname === "/admin/login";

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
      const t = localStorage.getItem(THEME_KEY) as AdminTheme | null;
      if (t === "light" || t === "dark") setTheme(t);
      const d = localStorage.getItem(DENSITY_KEY) as AdminDensity | null;
      if (d === "compact" || d === "comfortable") setDensity(d);
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    if (mounted) try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch { /* noop */ }
  }, [collapsed, mounted]);
  useEffect(() => {
    if (mounted) try { localStorage.setItem(THEME_KEY, theme); } catch { /* noop */ }
  }, [theme, mounted]);
  useEffect(() => {
    if (mounted) try { localStorage.setItem(DENSITY_KEY, density); } catch { /* noop */ }
  }, [density, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (!loading && !admin && !isLoginRoute) {
      nav({ to: "/admin/login" });
    }
  }, [mounted, loading, admin, isLoginRoute, nav]);

  if (!mounted) return <div className="admin-shell" suppressHydrationWarning />;
  const shellAttrs = { "data-admin-theme": theme, "data-admin-density": density } as Record<string, string>;
  if (isLoginRoute) return <div className="admin-shell" {...shellAttrs}><Outlet /></div>;
  if (loading) {
    return (
      <div className="admin-shell flex items-center justify-center" {...shellAttrs} style={{ minHeight: "100vh" }}>
        <div className="a-mono text-sm" style={{ color: "var(--a-muted)" }}>Verifying session…</div>
      </div>
    );
  }
  if (!admin) return <div className="admin-shell" {...shellAttrs} />;

  const navSections: Array<{ label?: string; items: Array<{ to: string; label: string; icon: any; end?: boolean; kbd?: string }> }> = [
    {
      items: [
        { to: "/admin", label: "Command Center", icon: LayoutDashboard, end: true, kbd: "g d" },
      ],
    },
    {
      label: "Operations",
      items: [
        { to: "/admin/users", label: "Users", icon: Users, kbd: "g u" },
        { to: "/admin/kyc", label: "KYC Queue", icon: FileCheck2, kbd: "g k" },
        { to: "/admin/transactions", label: "Transactions", icon: Wallet, kbd: "g t" },
        { to: "/admin/fraud", label: "Fraud", icon: ShieldAlert, kbd: "g f" },
        { to: "/admin/reports", label: "Issue Reports", icon: MessageSquareWarning, kbd: "g r" },
      ],
    },
    {
      label: "Growth",
      items: [
        { to: "/admin/campaigns", label: "Gender Campaigns", icon: Sparkles, kbd: "g c" },
        { to: "/admin/app-images", label: "App Images", icon: ImageIcon, kbd: "g i" },
      ],
    },
    {
      label: "System",
      items: [
        { to: "/admin/diagnostics", label: "Diagnostics", icon: Activity },
        { to: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ];
  const sideW = collapsed ? 68 : 248;

  return (
    <div className="admin-shell flex" {...shellAttrs}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        style={{
          width: sideW, transition: "width 200ms cubic-bezier(.2,.8,.25,1)",
          borderRight: "1px solid var(--a-border)",
          background: "linear-gradient(180deg, var(--a-surface) 0%, var(--a-bg) 100%)",
          minHeight: "100vh", display: "flex", flexDirection: "column",
          position: "sticky", top: 0,
        }}
      >
        <div style={{ padding: collapsed ? "18px 8px" : "20px 16px", borderBottom: "1px solid var(--a-border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32, height: 32, borderRadius: 9,
              background: "var(--a-grad-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, color: "var(--a-accent-fg)", fontSize: 13,
              boxShadow: "0 6px 18px -6px var(--a-accent-ring)",
              flexShrink: 0, letterSpacing: "0.02em",
            }}
          >TW</div>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div className="a-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "var(--a-text)", fontWeight: 600 }}>TEEN WALLET</div>
              <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 2, letterSpacing: "0.06em" }}>ADMIN CONSOLE</div>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: 8, overflowY: "auto" }}>
          {navSections.map((sec, si) => (
            <div key={si}>
              {!collapsed && sec.label && <div className="a-side-section">{sec.label}</div>}
              {collapsed && sec.label && <div style={{ height: 10 }} />}
              {sec.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to as never}
                  activeOptions={{ exact: !!it.end }}
                  activeProps={{ "data-active": "true" } as any}
                  title={collapsed ? `${it.label}${it.kbd ? ` (${it.kbd})` : ""}` : undefined}
                  className="a-side-item"
                  style={{
                    justifyContent: collapsed ? "center" : "flex-start",
                    padding: collapsed ? "10px 0" : undefined,
                    gap: collapsed ? 0 : 10,
                  }}
                >
                  <it.icon size={16} />
                  {!collapsed && <span style={{ flex: 1 }}>{it.label}</span>}
                  {!collapsed && it.kbd && (
                    <span className="a-mono" style={{ fontSize: 9, color: "var(--a-muted)", letterSpacing: "0.05em" }}>{it.kbd}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            margin: 8, padding: "6px", borderRadius: 8,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            color: "var(--a-muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "color 140ms ease, border-color 140ms ease",
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div style={{ padding: collapsed ? 8 : 12, borderTop: "1px solid var(--a-border)" }}>
          {collapsed ? (
            <button
              onClick={async () => { await logout(); nav({ to: "/admin/login" }); }}
              title={`Logout (${admin.email})`}
              style={{ width: "100%", padding: 8, borderRadius: 8, background: "var(--a-surface-2)", border: "1px solid var(--a-border)", color: "var(--a-text)", cursor: "pointer", display: "flex", justifyContent: "center" }}
            >
              <LogOut size={14} />
            </button>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 34, height: 34, borderRadius: 999,
                    background: "var(--a-grad-accent)",
                    display: "grid", placeItems: "center",
                    color: "var(--a-accent-fg)", fontWeight: 700, fontSize: 13,
                    boxShadow: "0 6px 18px -8px var(--a-accent-ring)",
                  }}
                >{(admin.name || admin.email).slice(0, 1).toUpperCase()}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{admin.name}</div>
                  <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{admin.email}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${ROLE_BADGE[admin.role]}`}>{ROLE_LABELS[admin.role]}</span>
                <button
                  onClick={async () => { await logout(); nav({ to: "/admin/login" }); }}
                  className="a-btn-ghost"
                  style={{ padding: "5px 10px", fontSize: 11 }}
                  title="Sign out"
                >
                  <LogOut size={12} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar
          pathname={pathname}
          expiresAt={expiresAt}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          density={density}
          onToggleDensity={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
        />
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
// Topbar — breadcrumbs · ⌘K · live notifications · theme/density toggles
// ─────────────────────────────────────────────────────────────────────────────
function Topbar({
  pathname, expiresAt, theme, onToggleTheme, density, onToggleDensity,
}: {
  pathname: string; expiresAt: string | null;
  theme: AdminTheme; onToggleTheme: () => void;
  density: AdminDensity; onToggleDensity: () => void;
}) {
  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return parts.map((p, i) => ({
      label: prettify(p),
      href: "/" + parts.slice(0, i + 1).join("/"),
    }));
  }, [pathname]);

  const env = (typeof window !== "undefined" && window.location.hostname.includes("lovable.app"))
    ? (window.location.hostname.includes("preview") ? "PREVIEW" : "PROD")
    : "DEV";

  const openPalette = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };

  return (
    <header
      style={{
        height: 60, borderBottom: "1px solid var(--a-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        background: "color-mix(in oklab, var(--a-surface) 80%, transparent)",
        backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        <span
          className="a-mono"
          style={{
            fontSize: 9, padding: "3px 7px", borderRadius: 4,
            border: `1px solid ${env === "PROD" ? "var(--a-success)" : env === "PREVIEW" ? "var(--a-warn)" : "var(--a-border)"}`,
            color: env === "PROD" ? "var(--a-success)" : env === "PREVIEW" ? "var(--a-warn)" : "var(--a-muted)",
            letterSpacing: "0.1em", fontWeight: 600,
          }}
        >{env}</span>
        <span className="a-pulse" aria-hidden="true" title="Realtime stream live" />
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--a-muted)", overflow: "hidden" }}>
          {crumbs.map((c, i) => (
            <span key={c.href} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "var(--a-border-strong)" }}>/</span>}
              <Link
                to={c.href as never}
                style={{ color: i === crumbs.length - 1 ? "var(--a-text)" : "var(--a-muted)", fontWeight: i === crumbs.length - 1 ? 500 : 400 }}
              >{c.label}</Link>
            </span>
          ))}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={openPalette}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 12px", minWidth: 240,
            background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
            borderRadius: 10, color: "var(--a-muted)", fontSize: 12, cursor: "pointer",
            transition: "border-color 120ms, color 120ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--a-border-strong)"; e.currentTarget.style.color = "var(--a-text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--a-border)"; e.currentTarget.style.color = "var(--a-muted)"; }}
        >
          <Search size={13} />
          <span style={{ flex: 1, textAlign: "left" }}>Search or jump…</span>
          <span className="a-mono" style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, color: "var(--a-muted)" }}>
            <Command size={10} /> K
          </span>
        </button>

        <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)", padding: "0 6px" }}>
          Session {expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
        </span>

        <NotificationsBell />

        <button
          className="a-icon-btn"
          aria-label={`Switch to ${density === "comfortable" ? "compact" : "comfortable"} density`}
          title={`${density === "comfortable" ? "Compact" : "Comfortable"} rows`}
          onClick={onToggleDensity}
        >
          {density === "comfortable" ? <Rows3 size={14} /> : <Rows2 size={14} />}
        </button>

        <button
          className="a-icon-btn"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`${theme === "dark" ? "Light" : "Dark"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications bell — wired to admin_notifications via admin-auth function
// ─────────────────────────────────────────────────────────────────────────────
interface AdminNotif {
  id: string; type: string; priority: string;
  title: string; body: string | null; link: string | null;
  read: boolean; created_at: string;
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AdminNotif[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  async function load() {
    const s = readAdminSession();
    if (!s) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await callAdminFn<{ items: AdminNotif[]; unread: number }>({
        action: "admin_notifications_list", sessionToken: s.sessionToken, limit: 30,
      });
      setItems(r.items || []);
      setUnread(r.unread || 0);
    } catch (e: any) {
      // 'unknown_action' is expected on first deploy before fn ships; fail soft.
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // Initial unread fetch + soft polling.
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Refresh on open.
  useEffect(() => {
    if (open) void load();
  }, [open]);

  // Click-outside / Escape close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    const s = readAdminSession();
    if (!s) return;
    const ids = items.filter((i) => !i.read).map((i) => i.id);
    if (!ids.length) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
    try {
      await callAdminFn({ action: "admin_notifications_mark_read", sessionToken: s.sessionToken, ids });
    } catch { /* swallow — UI already optimistic */ }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        className="a-icon-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        data-on={open ? "true" : undefined}
      >
        <Bell size={14} />
        {unread > 0 && <span className="a-badge-dot">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div
          ref={popRef}
          className="a-pop"
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 360, maxHeight: 480, display: "flex", flexDirection: "column", zIndex: 30,
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--a-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Notifications</div>
              <div className="a-label" style={{ marginTop: 2 }}>{unread > 0 ? `${unread} unread` : "All caught up"}</div>
            </div>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="a-btn-ghost"
                style={{ padding: "5px 10px", fontSize: 11 }}
              >Mark all read</button>
            )}
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && items.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: "var(--a-muted)" }}>Loading…</div>
            )}
            {err && items.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: "var(--a-muted)" }}>
                Notifications stream not available yet.
              </div>
            )}
            {!loading && !err && items.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--a-muted)" }}>
                <Bell size={18} style={{ opacity: 0.5, marginBottom: 8 }} />
                <div>No notifications yet</div>
              </div>
            )}
            {items.map((n) => (
              <NotifRow key={n.id} n={n} onClick={() => setOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifRow({ n, onClick }: { n: AdminNotif; onClick: () => void }) {
  const tone =
    n.priority === "high" ? "var(--a-danger)" :
    n.priority === "medium" ? "var(--a-warn)" :
    "var(--a-info)";
  const body = (
    <>
      <span style={{
        width: 6, height: 6, borderRadius: 999, background: tone, marginTop: 7, flexShrink: 0,
        boxShadow: n.read ? "none" : `0 0 8px ${tone}`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: n.read ? 400 : 600, color: n.read ? "var(--a-muted)" : "var(--a-text)" }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{ fontSize: 11.5, color: "var(--a-muted)", marginTop: 2, lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {n.body}
          </div>
        )}
        <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 3 }}>
          {relTime(n.created_at)}
        </div>
      </div>
    </>
  );
  const sharedStyle: React.CSSProperties = {
    display: "flex", gap: 10, padding: "10px 14px",
    borderBottom: "1px solid var(--a-border)",
    background: n.read ? "transparent" : "var(--a-accent-soft)",
    textDecoration: "none", color: "inherit", cursor: n.link ? "pointer" : "default",
  };
  if (n.link) {
    return (
      <Link to={n.link as never} onClick={onClick} style={sharedStyle}>
        {body}
      </Link>
    );
  }
  return <div style={sharedStyle}>{body}</div>;
}

function prettify(seg: string) {
  if (/^[0-9a-f]{8}-/.test(seg)) return seg.slice(0, 8) + "…";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function relTime(ts: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
