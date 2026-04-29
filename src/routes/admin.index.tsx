import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { callAdminFn, readAdminSession } from "@/admin/lib/adminAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Users as UsersIcon, Activity, FileCheck2, ArrowRightLeft,
  IndianRupee, ShieldAlert, TrendingUp, TrendingDown,
} from "lucide-react";
import { adminChartTokens } from "@/lib/themeTokens";

export const Route = createFileRoute("/admin/")({
  component: CommandCenter,
});

interface Kpis {
  totalUsers: number;
  newUsers7d: number;
  activeToday: number;
  kycPending: number;
  totalTxnsToday: number;
  totalVolumeToday: number;
  fraudOpen: number;
  successRate: number;
}

interface DashboardData {
  kpis: Kpis;
  txnSeries: Array<{ date: string; volume: number; count: number; success: number }>;
  signupSeries: Array<{ date: string; approved: number; pending: number; other: number }>;
  fraudBreakdown: Array<{ rule: string; count: number }>;
}

interface ActivityItem {
  kind: string;
  ts: string;
  title: string;
  subtitle?: string;
  refId?: string;
}

// Chart colors are sourced from theme tokens (see src/styles.css → .admin-shell
// --a-chart-*, --a-tooltip-*, --a-success/warn/danger/info). Resolved at render
// time via adminChartTokens() so future theme changes flow through automatically.

type RangeKey = 7 | 30 | 90;

function CommandCenter() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [days, setDays] = useState<RangeKey>(30);

  const lastLoadAt = useRef(0);
  const inflight = useRef(false);

  const loadAll = useCallback(async () => {
    if (inflight.current) return;
    const s = readAdminSession();
    if (!s) return;
    inflight.current = true;
    try {
      const [stats, act] = await Promise.all([
        callAdminFn<DashboardData>({ action: "dashboard_stats", sessionToken: s.sessionToken, days }),
        callAdminFn<{ items: ActivityItem[] }>({ action: "recent_activity", sessionToken: s.sessionToken, limit: 40 }),
      ]);
      setData(stats);
      setActivity(act.items);
      setUpdatedAt(new Date().toLocaleTimeString());
      setErr("");
      lastLoadAt.current = Date.now();
    } catch (e: any) {
      setErr(e.message || "Failed to load");
    } finally {
      inflight.current = false;
    }
  }, [days]);

  useEffect(() => {
    void loadAll();
    // Poll less aggressively (60s) and skip when tab is hidden
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadAll();
    }, 60000);
    return () => clearInterval(id);
  }, [loadAll]);

  useEffect(() => {
    // Throttled realtime — coalesce bursts to at most one reload per 5s
    const throttled = () => {
      if (Date.now() - lastLoadAt.current < 5000) return;
      void loadAll();
    };
    const ch = supabase
      .channel("admin-cmd-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, throttled)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, throttled)
      .on("postgres_changes", { event: "*", schema: "public", table: "kyc_submissions" }, throttled)
      .on("postgres_changes", { event: "*", schema: "public", table: "fraud_logs" }, throttled)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAll]);

  const k = data?.kpis;
  const sparkVolume = useMemo(
    () => (data?.txnSeries ?? []).slice(-7).map((d) => ({ v: d.volume })),
    [data],
  );
  const sparkSignups = useMemo(
    () => (data?.signupSeries ?? []).slice(-7).map((d) => ({ v: d.approved + d.pending + d.other })),
    [data],
  );

  const t = useMemo(() => adminChartTokens(), [data]);
  const tooltipStyle = useMemo(
    () => ({
      background: t.tooltipBg,
      border: `1px solid ${t.tooltipBorder}`,
      borderRadius: 6,
      fontSize: 12,
      color: t.tooltipText,
    }),
    [t],
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Command Center</h1>
          <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>Live operational view. Auto-refreshes every 60s.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--a-border)", borderRadius: 8, overflow: "hidden" }}>
            {([7, 30, 90] as RangeKey[]).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
                  background: days === d ? "var(--a-accent)" : "transparent",
                  color: days === d ? "#0a0a0b" : "var(--a-muted)",
                }}
              >{d}d</button>
            ))}
          </div>
          <div className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>
            {updatedAt ? `Updated ${updatedAt}` : "Loading…"}
          </div>
        </div>
      </div>

      {err && <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: "var(--a-danger-soft)", border: "1px solid var(--a-danger-border)", color: "var(--a-danger-text)", fontSize: 13 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KpiCard icon={<UsersIcon size={14} />} label="Total Users" value={k?.totalUsers ?? "—"} delta={k?.newUsers7d} deltaLabel="new 7d" spark={sparkSignups} />
        <KpiCard icon={<Activity size={14} />} label="Active Today" value={k?.activeToday ?? "—"} />
        <KpiCard icon={<FileCheck2 size={14} />} label="KYC Pending" value={k?.kycPending ?? "—"} warn={(k?.kycPending ?? 0) > 20} />
        <KpiCard icon={<ArrowRightLeft size={14} />} label="Txns Today" value={k?.totalTxnsToday ?? "—"} spark={sparkVolume} />
        <KpiCard icon={<IndianRupee size={14} />} label="Volume Today" value={k ? `₹${k.totalVolumeToday.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"} mono />
        <KpiCard icon={<ShieldAlert size={14} />} label="Fraud Open" value={k?.fraudOpen ?? "—"} danger={(k?.fraudOpen ?? 0) > 0} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        <ChartCard title="Transaction Volume" subtitle="Last 30 days · ₹">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data?.txnSeries ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gVol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.accent} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={t.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} stroke={t.axis} tick={{ fontSize: 11 }} />
              <YAxis stroke={t.axis} tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${shortNum(v)}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`₹${Number(v).toLocaleString("en-IN")}`, "Volume"]} labelFormatter={shortDate} />
              <Area type="monotone" dataKey="volume" stroke={t.accent} strokeWidth={2} fill="url(#gVol)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Open Fraud Alerts" subtitle="By rule">
          {data && data.fraudBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.fraudBreakdown} dataKey="count" nameKey="rule" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {data.fraudBreakdown.map((_, i) => (
                    <Cell key={i} fill={t.series[i % t.series.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: t.legend }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--a-muted)", fontSize: 13 }}>No open fraud alerts</div>
          )}
        </ChartCard>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <ChartCard title="Signups vs KYC" subtitle="Last 30 days">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.signupSeries ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={t.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} stroke={t.axis} tick={{ fontSize: 11 }} />
              <YAxis stroke={t.axis} tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} />
              <Legend wrapperStyle={{ fontSize: 11, color: t.legend }} />
              <Bar dataKey="approved" stackId="s" fill={t.success} />
              <Bar dataKey="pending" stackId="s" fill={t.warn} />
              <Bar dataKey="other" stackId="s" fill={t.info} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="a-surface" style={{ padding: 16, maxHeight: 360, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Live Activity</div>
              <div className="a-label">Realtime stream</div>
            </div>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.success, boxShadow: `0 0 8px ${t.success}` }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {activity.length === 0 && <div style={{ fontSize: 12, color: "var(--a-muted)", padding: 12 }}>No recent events</div>}
            {activity.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--a-border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, background: dotColor(it.kind), flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                  {it.subtitle && <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.subtitle}</div>}
                </div>
                <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", whiteSpace: "nowrap" }}>{relTime(it.ts)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, delta, deltaLabel, spark, warn, danger, mono }: {
  icon: React.ReactNode; label: string; value: number | string;
  delta?: number; deltaLabel?: string;
  spark?: Array<{ v: number }>;
  warn?: boolean; danger?: boolean; mono?: boolean;
}) {
  const t = useMemo(() => adminChartTokens(), []);
  const color = danger ? t.danger : warn ? t.warn : "var(--a-text)";
  const deltaColor = (delta ?? 0) >= 0 ? t.success : t.danger;
  return (
    <div className="a-kpi">
      <div className="a-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--a-muted)" }}>
        <span style={{ color: "var(--a-accent)" }}>{icon}</span> {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 8, gap: 8 }}>
        <div className={mono ? "a-mono" : ""} style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", color }}>{value}</div>
        {spark && spark.length > 0 && (
          <div style={{ width: 88, height: 30 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark}>
                <Area dataKey="v" stroke={t.accent} fill={t.accent} fillOpacity={0.18} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {typeof delta === "number" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 11, color: deltaColor }}>
          {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span className="a-mono">{delta}</span>
          <span style={{ color: "var(--a-muted)" }}>{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="a-surface" style={{ padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {subtitle && <div className="a-label">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function shortDate(d: string) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}
function shortNum(n: number) {
  if (n >= 1e7) return (n / 1e7).toFixed(1) + "Cr";
  if (n >= 1e5) return (n / 1e5).toFixed(1) + "L";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function relTime(ts: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
function dotColor(kind: string) {
  const t = adminChartTokens();
  if (kind.startsWith("user")) return t.success;
  if (kind === "kyc_approved") return t.success;
  if (kind.startsWith("kyc")) return t.warn;
  if (kind === "txn_failed") return t.danger;
  if (kind.startsWith("txn")) return t.info;
  if (kind === "fraud") return t.danger;
  return t.legend;
}
