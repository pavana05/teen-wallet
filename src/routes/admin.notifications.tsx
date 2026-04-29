import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { Bell, Check, CheckCheck, RefreshCw, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/notifications")({
  component: NotificationsCenter,
});

interface Notif {
  id: string;
  type: string;
  priority: string; // low|medium|high|critical
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

const PRIORITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function priorityStyle(p: string) {
  switch (p) {
    case "critical": return { bg: "color-mix(in oklab, var(--a-danger, #ef4444) 18%, transparent)", border: "var(--a-danger, #ef4444)", color: "var(--a-danger, #ef4444)", icon: ShieldAlert };
    case "high": return { bg: "color-mix(in oklab, var(--a-warning, #f59e0b) 16%, transparent)", border: "var(--a-warning, #f59e0b)", color: "var(--a-warning, #f59e0b)", icon: AlertTriangle };
    case "medium": return { bg: "var(--a-surface-2)", border: "var(--a-border)", color: "var(--a-text)", icon: Bell };
    default: return { bg: "transparent", border: "var(--a-border)", color: "var(--a-muted)", icon: Info };
  }
}

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function NotificationsCenter() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread" | "critical" | "high">("all");

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<{ items: Notif[]; unread: number }>({
        action: "admin_notifications_list", limit: 100,
      });
      setItems(r.items);
      setUnread(r.unread);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const markRead = async (ids?: string[]) => {
    try {
      await callAdminFn({ action: "admin_notifications_mark_read", ids });
      toast.success(ids?.length ? "Marked as read" : "All marked as read");
      void load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const filtered = items
    .filter((n) => {
      if (filter === "unread") return !n.read;
      if (filter === "critical") return n.priority === "critical";
      if (filter === "high") return n.priority === "high" || n.priority === "critical";
      return true;
    })
    .sort((a, b) => {
      // Unread first, then priority, then recency
      if (a.read !== b.read) return a.read ? 1 : -1;
      const pa = PRIORITY_ORDER[a.priority] ?? 0;
      const pb = PRIORITY_ORDER[b.priority] ?? 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={20} />
            Notifications
            {unread > 0 && (
              <span className="a-mono" style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 999,
                background: "var(--a-accent)", color: "var(--a-accent-fg)", letterSpacing: "0.05em",
              }}>{unread} unread</span>
            )}
          </h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            System alerts, fraud spikes, KYC backlog & admin actions for your role.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
          </button>
          <button onClick={() => markRead()} disabled={unread === 0} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11, opacity: unread === 0 ? 0.5 : 1 }}>
            <CheckCheck size={12} /> Mark all read
          </button>
        </div>
      </header>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["all", "unread", "high", "critical"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="a-mono"
            style={{
              padding: "5px 10px", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
              borderRadius: 999, cursor: "pointer",
              background: filter === f ? "var(--a-surface-2)" : "transparent",
              color: filter === f ? "var(--a-text)" : "var(--a-muted)",
              border: "1px solid var(--a-border)",
            }}
          >{f}</button>
        ))}
      </div>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", border: "1px dashed var(--a-border)", borderRadius: 10, color: "var(--a-muted)", fontSize: 13 }}>
            {loading ? "Loading…" : "No notifications match this filter."}
          </div>
        )}
        {filtered.map((n) => {
          const s = priorityStyle(n.priority);
          const Icon = s.icon;
          return (
            <div
              key={n.id}
              style={{
                display: "flex", gap: 12, padding: 12, borderRadius: 10,
                border: `1px solid ${s.border}`, background: n.read ? "var(--a-surface)" : s.bg,
                opacity: n.read ? 0.7 : 1,
              }}
            >
              <div style={{ color: s.color, paddingTop: 2 }}><Icon size={16} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                  <span className="a-mono" style={{
                    fontSize: 9, padding: "1px 6px", borderRadius: 4,
                    border: `1px solid ${s.border}`, color: s.color,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                  }}>{n.priority}</span>
                  <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>· {n.type}</span>
                  <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", marginLeft: "auto" }}>{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4, lineHeight: 1.5 }}>{n.body}</div>}
                <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center" }}>
                  {n.link && (
                    <Link to={n.link as never} style={{ fontSize: 11, color: "var(--a-accent)", textDecoration: "none" }}>
                      Open →
                    </Link>
                  )}
                  {!n.read && (
                    <button onClick={() => markRead([n.id])} className="a-btn-ghost" style={{ padding: "3px 8px", fontSize: 10 }}>
                      <Check size={10} /> Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
