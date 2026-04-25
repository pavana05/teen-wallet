import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/admin/fraud")({
  component: () => <div><h1 style={{ fontSize: 24, fontWeight: 700 }}>Fraud</h1><p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 8 }}>Coming next.</p></div>,
});
