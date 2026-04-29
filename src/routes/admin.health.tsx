import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { Activity, RefreshCw, Zap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from "recharts";

export const Route = createFileRoute("/admin/health")({
  component: HealthPage,
});

interface Bucket { ts: string; total: number; success: number; failed: number; p50: number; p95: number }
interface Resp {
  windowHours: number;
  stats: { total: number; success: number; failed: number; successRate: number; p50: number; p95: number; p99: number };
  buckets: Bucket[];
  topErrors: Array<{ reason: string; count: number }>;
  serverTs: string;
}

function HealthPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<Resp>({ action: "api_health" });
      setData(r);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };
  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const healthy = (data?.stats.successRate ?? 100) >= 98;
  const degraded = (data?.stats.successRate ?? 100) >= 90 && !healthy;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Activity size={20} /> API Health Monitor
            <StatusBadge healthy={healthy} degraded={degraded} />
          </h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Payment-attempt success rate, latency percentiles & top error reasons · last 24h · auto-refreshes every 30s
          </div>
        </div>
        <button onClick={load} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Kpi label="Success rate" value={data ? `${data.stats.successRate.toFixed(2)}%` : "—"}
          tone={healthy ? "good" : degraded ? "warn" : "bad"}
          sub={data ? `${data.stats.success.toLocaleString()} / ${data.stats.total.toLocaleString()}` : undefined} />
        <Kpi label="Failed" value={data ? data.stats.failed.toLocaleString() : "—"} tone={data && data.stats.failed > 0 ? "bad" : "neutral"} />
        <Kpi label="P50 latency" value={data ? `${data.stats.p50}ms` : "—"} icon={<Zap size={13} />} />
        <Kpi label="P95 latency" value={data ? `${data.stats.p95}ms` : "—"} icon={<Zap size={13} />} />
        <Kpi label="P99 latency" value={data ? `${data.stats.p99}ms` : "—"} icon={<Zap size={13} />} />
      </div>

      <Panel title="Hourly throughput (success vs failed)">
        <div style={{ height: 240 }}>
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.buckets} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--a-border)" vertical={false} />
                <XAxis dataKey="ts" tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <YAxis tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <Tooltip contentStyle={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--a-muted)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="success" stackId="a" fill="var(--a-success, #10b981)" />
                <Bar dataKey="failed" stackId="a" fill="var(--a-danger, #ef4444)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <Panel title="Latency percentiles per hour (ms)">
        <div style={{ height: 220 }}>
          {data && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.buckets} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="p95g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--a-accent)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--a-accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--a-border)" vertical={false} />
                <XAxis dataKey="ts" tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" />
                <YAxis tick={{ fill: "var(--a-muted)", fontSize: 10 }} stroke="var(--a-border)" tickFormatter={(v) => `${v}`} />
                <Tooltip contentStyle={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "var(--a-muted)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="p95" stroke="var(--a-accent)" fill="url(#p95g)" strokeWidth={2} />
                <Area type="monotone" dataKey="p50" stroke="var(--a-muted)" fill="transparent" strokeWidth={1.5} strokeDasharray="3 3" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <Panel title="Top failure reasons (24h)">
        {!data ? <div style={{ fontSize: 12, color: "var(--a-muted)" }}>Loading…</div> :
          data.topErrors.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--a-muted)" }}>No failures recorded — system is healthy. ✨</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.topErrors.map((e) => (
                <div key={e.reason} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AlertTriangle size={12} style={{ color: "var(--a-warning, #f59e0b)" }} />
                  <span style={{ fontSize: 12, flex: 1 }}>{e.reason}</span>
                  <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{e.count}×</span>
                </div>
              ))}
            </div>
          )}
      </Panel>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function StatusBadge({ healthy, degraded }: { healthy: boolean; degraded: boolean }) {
  const color = healthy ? "var(--a-success, #10b981)" : degraded ? "var(--a-warning, #f59e0b)" : "var(--a-danger, #ef4444)";
  const label = healthy ? "Healthy" : degraded ? "Degraded" : "Unhealthy";
  return (
    <span className="a-mono" style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 999,
      border: `1px solid ${color}`, color, letterSpacing: "0.06em", textTransform: "uppercase",
      display: "inline-flex", alignItems: "center", gap: 6,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" | "neutral"; icon?: React.ReactNode }) {
  const color = tone === "bad" ? "var(--a-danger, #ef4444)" : tone === "warn" ? "var(--a-warning, #f59e0b)" : tone === "good" ? "var(--a-success, #10b981)" : "var(--a-text)";
  return (
    <div style={{ padding: 14, border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--a-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
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
