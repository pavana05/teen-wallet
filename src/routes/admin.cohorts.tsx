import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/cohorts")({
  component: CohortsPage,
});

interface Cohort { label: string; size: number; retention: number[] }
interface Resp { weeks: number; cohorts: Cohort[]; totalUsers: number }

const RANGES = [4, 6, 8, 12];

function CohortsPage() {
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (w: number) => {
    setLoading(true);
    try {
      const r = await callAdminFn<Resp>({ action: "cohort_analysis", weeks: w });
      setData(r);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(weeks); }, [weeks]);

  const heatColor = (pct: number) => {
    if (pct === 0) return "var(--a-surface-2)";
    // green scale: pct 0..100 → opacity 0.1..0.9
    const op = 0.12 + (pct / 100) * 0.7;
    return `color-mix(in oklab, var(--a-success, #10b981) ${(op * 100).toFixed(0)}%, var(--a-surface))`;
  };
  const heatText = (pct: number) => (pct >= 40 ? "var(--a-bg)" : "var(--a-text)");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={20} /> Cohort Analysis
          </h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Weekly signup cohorts × week-N retention (% of cohort that transacted that week).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden" }}>
            {RANGES.map((w, i) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className="a-mono"
                style={{
                  padding: "6px 12px", fontSize: 11, letterSpacing: "0.05em",
                  background: weeks === w ? "var(--a-surface-2)" : "transparent",
                  color: weeks === w ? "var(--a-text)" : "var(--a-muted)",
                  border: "none", cursor: "pointer",
                  borderRight: i < RANGES.length - 1 ? "1px solid var(--a-border)" : undefined,
                }}
              >{w}w</button>
            ))}
          </div>
          <button onClick={() => load(weeks)} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
          </button>
        </div>
      </header>

      <section style={{ border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", overflow: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 11, minWidth: 720, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...thBase, position: "sticky", left: 0, background: "var(--a-surface)", zIndex: 1 }}>Cohort (week of)</th>
              <th style={thBase}>Users</th>
              {Array.from({ length: weeks }).map((_, i) => (
                <th key={i} style={thBase}>W{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr><td colSpan={weeks + 2} style={{ padding: 24, textAlign: "center", color: "var(--a-muted)" }}>Loading…</td></tr>
            )}
            {data && data.cohorts.map((c, ci) => (
              <tr key={ci}>
                <td style={{ ...tdBase, position: "sticky", left: 0, background: "var(--a-surface)", fontWeight: 500 }}>{c.label}</td>
                <td style={{ ...tdBase, color: "var(--a-muted)" }}>{c.size.toLocaleString()}</td>
                {Array.from({ length: weeks }).map((_, wi) => {
                  const pct = c.retention[wi];
                  if (pct === undefined) return <td key={wi} style={{ ...tdBase, background: "transparent", color: "var(--a-muted)" }}>—</td>;
                  return (
                    <td key={wi} style={{ ...tdBase, background: heatColor(pct), color: heatText(pct), fontWeight: pct >= 30 ? 600 : 400, textAlign: "center" }}>
                      {pct > 0 ? `${pct.toFixed(0)}%` : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{ fontSize: 11, color: "var(--a-muted)", display: "flex", alignItems: "center", gap: 8 }}>
        Legend:
        {[0, 10, 30, 50, 70].map((p) => (
          <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 14, background: heatColor(p), borderRadius: 3, border: "1px solid var(--a-border)" }} />
            {p}%
          </span>
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const thBase: React.CSSProperties = {
  padding: "8px 10px", textAlign: "center", color: "var(--a-muted)",
  fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
  borderBottom: "1px solid var(--a-border)",
};
const tdBase: React.CSSProperties = {
  padding: "8px 10px", textAlign: "center",
  borderBottom: "1px solid var(--a-border)", fontSize: 11,
};
