import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { TrendingUp, TrendingDown, IndianRupee, Receipt, Activity, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";

export const Route = createFileRoute("/admin/revenue")({
  component: RevenuePage,
});

interface SeriesPoint {
  date: string; volume: number; count: number; fees: number; success: number; failed: number;
}
interface Resp {
  days: number;
  feeRate: number;
  series: SeriesPoint[];
  kpis: {
    lifetimeVolume: number; lifetimeFees: number; lifetimeCount: number;
    successCount: number; failedCount: number; successRate: number;
    avgTicket: number; recentVolume: number; priorVolume: number;
    growthPct: number | null;
  };
  topMerchants: Array<{ name: string; volume: number; count: number }>;
  topUsers: Array<{ id: string; name: string; phone: string | null; volume: number }>;
  serverTs: string;
}

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
];

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}
function fmtINRFull(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function RevenuePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async (d: number) => {
    setLoading(true); setErr(null);
    try {
      const r = await callAdminFn<Resp>({ action: "revenue_analytics", days: d });
      setData(r);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(days); }, [days]);

  const growthLabel = useMemo(() => {
    if (!data?.kpis.growthPct && data?.kpis.growthPct !== 0) return "—";
    const v = data.kpis.growthPct;
    return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Revenue Analytics</h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Volume, estimated fees ({data ? `${(data.feeRate * 100).toFixed(2)}%` : "—"}) and growth
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden" }}>
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className="a-mono"
                style={{
                  padding: "6px 12px", fontSize: 11, letterSpacing: "0.05em",
                  background: days === r.days ? "var(--a-surface-2)" : "transparent",
                  color: days === r.days ? "var(--a-text)" : "var(--a-muted)",
                  border: "none", cursor: "pointer", borderRight: "1px solid var(--a-border)",
                }}
              >{r.label}</button>
            ))}
          </div>
          <button onClick={() => load(days)} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }} disabled={loading}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
          </button>
        </div>
      </header>

      {err && (
        <div style={{ padding: 12, border: "1px solid var(--a-danger-border, var(--a-border))", borderRadius: 8, color: "var(--a-danger, #ef4444)", fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Kpi
          icon={<IndianRupee size={14} />}
          label={`Volume · last ${days}d`}
          value={data ? fmtINRFull(data.kpis.lifetimeVolume) : "—"}
          sub={data ? `${data.kpis.lifetimeCount.toLocaleString()} txns` : undefined}
        />
        <Kpi
          icon={<Receipt size={14} />}
          label="Estimated fees"
          value={data ? fmtINRFull(data.kpis.lifetimeFees) : "—"}
          sub={data ? `Avg ticket ${fmtINR(data.kpis.avgTicket)}` : undefined}
        />
        <Kpi
          icon={<Activity size={14} />}
          label="Success rate"
          value={data ? `${data.kpis.successRate.toFixed(2)}%` : "—"}
          sub={data ? `${data.kpis.failedCount.toLocaleString()} failed` : undefined}
        />
        <Kpi
          icon={(data?.kpis.growthPct ?? 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          label={`vs prior ${Math.round(days / 2)}d`}
          value={growthLabel}
          sub={data ? `${fmtINR(data.kpis.recentVolume)} vs ${fmtINR(data.kpis.priorVolume)}` : undefined}
          tone={(data?.kpis.growthPct ?? 0) >= 0 ? "up" : "down"}
        />
      </div>

      {/* Volume chart */}
      <Panel title="Daily volume & fees">
        <div style={{ height: 280 }}>
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--a-accent)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--a-accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--a-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <YAxis tickFormatter={(v) => fmtINR(Number(v))} tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <Tooltip
                  contentStyle={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "var(--a-muted)" }}
                  formatter={(v: any, name) => [
                    name === "volume" ? fmtINRFull(Number(v)) : name === "fees" ? fmtINRFull(Number(v)) : v,
                    name,
                  ]}
                />
                <Area type="monotone" dataKey="volume" stroke="var(--a-accent)" fill="url(#volGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Success vs failed */}
      <Panel title="Daily transaction outcomes">
        <div style={{ height: 220 }}>
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--a-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <YAxis tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <Tooltip
                  contentStyle={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "var(--a-muted)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="success" stackId="a" fill="var(--a-success, #10b981)" />
                <Bar dataKey="failed" stackId="a" fill="var(--a-danger, #ef4444)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Top tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Panel title="Top merchants by volume">
          <SimpleTable
            cols={["Merchant", "Volume", "Txns"]}
            rows={(data?.topMerchants ?? []).map((m) => [m.name, fmtINRFull(m.volume), m.count.toLocaleString()])}
          />
        </Panel>
        <Panel title="Top users by volume">
          <SimpleTable
            cols={["User", "Phone", "Volume"]}
            rows={(data?.topUsers ?? []).map((u) => [u.name, u.phone ?? "—", fmtINRFull(u.volume)])}
          />
        </Panel>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div style={{
      padding: 14, border: "1px solid var(--a-border)", borderRadius: 10,
      background: "var(--a-surface)", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--a-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {icon}{label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 600,
        color: tone === "down" ? "var(--a-danger, #ef4444)" : tone === "up" ? "var(--a-success, #10b981)" : "var(--a-text)",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--a-muted)" }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--a-border)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--a-muted)" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  );
}

function SimpleTable({ cols, rows }: { cols: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (!rows.length) return <div style={{ fontSize: 12, color: "var(--a-muted)", padding: 8 }}>No data yet</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr>{cols.map((c) => (
          <th key={c} style={{ textAlign: "left", padding: "6px 8px", color: "var(--a-muted)", borderBottom: "1px solid var(--a-border)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 10 }}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => (
            <td key={j} style={{ padding: "8px", borderBottom: "1px solid var(--a-border)" }}>{cell}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
