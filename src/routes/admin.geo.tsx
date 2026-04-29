import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { Map as MapIcon, RefreshCw, Users, IndianRupee } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/geo")({
  component: GeoPage,
});

interface Row { state: string; users: number; volume: number; txns: number }
interface Resp { days: number; totalUsers: number; knownStates: number; rows: Row[] }

const RANGES = [
  { label: "7d", days: 7 }, { label: "30d", days: 30 }, { label: "90d", days: 90 },
];

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}

function GeoPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<"users" | "volume">("users");

  const load = async (d: number) => {
    setLoading(true);
    try {
      const r = await callAdminFn<Resp>({ action: "geo_distribution", days: d });
      setData(r);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(days); }, [days]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => (metric === "users" ? b.users - a.users : b.volume - a.volume));
  }, [data, metric]);

  const max = sorted[0]?.[metric] ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <MapIcon size={20} /> Geographic Distribution
          </h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Users by Indian state · transaction volume in selected window. States derived from address or pincode prefix.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Toggle value={metric} onChange={(v) => setMetric(v as any)} options={[
            { label: "By users", value: "users" },
            { label: "By volume", value: "volume" },
          ]} />
          <Toggle value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGES.map((r) => ({ label: r.label, value: String(r.days) }))} />
          <button onClick={() => load(days)} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Kpi icon={<Users size={14} />} label="Total users sampled" value={data ? data.totalUsers.toLocaleString() : "—"} />
        <Kpi icon={<MapIcon size={14} />} label="Known regions" value={data ? `${data.knownStates}` : "—"} sub="States/regions with users" />
        <Kpi icon={<IndianRupee size={14} />} label={`Volume · ${days}d`} value={data ? fmtINR(data.rows.reduce((s, r) => s + r.volume, 0)) : "—"} />
      </div>

      <section style={{ border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--a-border)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--a-muted)" }}>
          Distribution by region
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {!data && <div style={{ fontSize: 12, color: "var(--a-muted)" }}>Loading…</div>}
          {data && sorted.length === 0 && <div style={{ fontSize: 12, color: "var(--a-muted)" }}>No data.</div>}
          {sorted.map((r) => {
            const v = metric === "users" ? r.users : r.volume;
            const pct = max > 0 ? (v / max) * 100 : 0;
            return (
              <div key={r.state} style={{ display: "grid", gridTemplateColumns: "180px 1fr 110px", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.state}
                </div>
                <div style={{ height: 22, background: "var(--a-surface-2)", borderRadius: 6, position: "relative", overflow: "hidden" }}>
                  <div style={{
                    width: `${pct}%`, height: "100%",
                    background: "var(--a-grad-accent, var(--a-accent))",
                    transition: "width 300ms ease",
                  }} />
                </div>
                <div className="a-mono" style={{ fontSize: 11, textAlign: "right", color: "var(--a-text)" }}>
                  {metric === "users"
                    ? `${r.users.toLocaleString()} users`
                    : fmtINR(r.volume)}
                  <span style={{ color: "var(--a-muted)", marginLeft: 6, fontSize: 10 }}>
                    · {r.txns.toLocaleString()} txns
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Toggle({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden" }}>
      {options.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="a-mono"
          style={{
            padding: "6px 10px", fontSize: 11, letterSpacing: "0.05em",
            background: value === o.value ? "var(--a-surface-2)" : "transparent",
            color: value === o.value ? "var(--a-text)" : "var(--a-muted)",
            border: "none", cursor: "pointer",
            borderRight: i < options.length - 1 ? "1px solid var(--a-border)" : undefined,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 14, border: "1px solid var(--a-border)", borderRadius: 10, background: "var(--a-surface)", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--a-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--a-muted)" }}>{sub}</div>}
    </div>
  );
}
