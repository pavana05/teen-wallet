import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/admin/users")({
  component: () => <div><h1 style={{ fontSize: 24, fontWeight: 700 }}>Users</h1><p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 8 }}>Coming in next turn.</p></div>,
});
