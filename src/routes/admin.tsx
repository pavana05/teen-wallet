import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAdminSession, ROLE_LABELS, ROLE_BADGE } from "@/admin/lib/adminAuth";
import { LayoutDashboard, Users, ShieldAlert, FileCheck2, Wallet, Settings, LogOut } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const nav = useNavigate();
  const { admin, loading, logout, expiresAt } = useAdminSession();

  useEffect(() => {
    if (!loading && !admin && typeof window !== "undefined" && window.location.pathname !== "/admin/login") {
      nav({ to: "/admin/login" });
    }
  }, [loading, admin, nav]);

  // Login page renders without the chrome
  if (typeof window !== "undefined" && window.location.pathname === "/admin/login") {
    return <div className="admin-shell"><Outlet /></div>;
  }

  if (loading) {
    return <div className="admin-shell flex items-center justify-center"><div className="a-mono text-sm" style={{ color: "var(--a-muted)" }}>Verifying session…</div></div>;
  }
  if (!admin) return <div className="admin-shell" />;

  const items = [
    { to: "/admin", label: "Command Center", icon: LayoutDashboard, end: true },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/kyc", label: "KYC Queue", icon: FileCheck2 },
    { to: "/admin/transactions", label: "Transactions", icon: Wallet },
    { to: "/admin/fraud", label: "Fraud", icon: ShieldAlert },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="admin-shell flex">
      {/* Sidebar */}
      <aside style={{ width: 240, borderRight: "1px solid var(--a-border)", background: "var(--a-surface)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid var(--a-border)" }}>
          <div className="a-mono" style={{ fontSize: 13, letterSpacing: "0.1em", color: "var(--a-accent)" }}>TEEN WALLET</div>
          <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2 }}>Admin Console</div>
        </div>
        <nav style={{ flex: 1, padding: 8 }}>
          {items.map((it) => (
            <Link key={it.to} to={it.to as any}
              activeOptions={{ exact: !!it.end }}
              activeProps={{ style: { background: "var(--a-elevated)", color: "var(--a-accent)", borderLeft: "2px solid var(--a-accent)" } }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", fontSize: 13, color: "var(--a-text)", borderRadius: 6, borderLeft: "2px solid transparent", marginBottom: 2 }}>
              <it.icon size={16} /> {it.label}
            </Link>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid var(--a-border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{admin.name}</div>
          <div style={{ fontSize: 11, color: "var(--a-muted)", marginBottom: 8 }} className="a-mono">{admin.email}</div>
          <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${ROLE_BADGE[admin.role]}`}>{ROLE_LABELS[admin.role]}</span>
          <button onClick={async () => { await logout(); nav({ to: "/admin/login" }); }}
            className="a-btn a-btn-ghost mt-3" style={{ width: "100%", fontSize: 12 }}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ height: 56, borderBottom: "1px solid var(--a-border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: "var(--a-surface)" }}>
          <div className="a-mono" style={{ fontSize: 12, color: "var(--a-muted)" }}>
            Session expires {expiresAt ? new Date(expiresAt).toLocaleTimeString() : "—"}
          </div>
        </header>
        <main style={{ flex: 1, padding: 24, maxWidth: 1440, width: "100%" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
