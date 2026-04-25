import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: () => (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Command Center</h1>
      <p style={{ fontSize: 13, color: "var(--a-muted)" }}>
        Phase 1 complete: security foundation, admin auth, TOTP 2FA, audit logging, and shell are live.
        KPIs, charts, live activity feed, and User Management ship in the next turn.
      </p>
      <div className="a-surface" style={{ marginTop: 24, padding: 20 }}>
        <div className="a-label" style={{ marginBottom: 8 }}>Phase 1 — Done</div>
        <ul style={{ fontSize: 13, lineHeight: 1.8, color: "var(--a-text)" }}>
          <li>✓ admin_users / admin_sessions / admin_audit_log / admin_notifications tables (deny-all RLS)</li>
          <li>✓ Super-admin seeded: pavana25t@gmail.com</li>
          <li>✓ Edge function: password (PBKDF2) + TOTP (RFC 6238) + single-session + lockout</li>
          <li>✓ 4-hour idle timeout, audit log on every login attempt</li>
          <li>✓ Sidebar shell, role badges, 6-role permission matrix</li>
        </ul>
      </div>
    </div>
  ),
});
