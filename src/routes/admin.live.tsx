import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Activity, Pause, Play, RefreshCw, AlertTriangle, ArrowUpRight,
  ShieldAlert, FileCheck2, UserPlus, IndianRupee, TrendingUp, Users,
} from "lucide-react";
import { adminChartTokens } from "@/lib/themeTokens";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/live")({
  component: LiveActivityPage,
});

interface Item {
  id: string; kind: string; ts: string; title: string;
  subtitle?: string; amount?: number; status?: string; userId?: string; refId?: string;
}
interface Bucket { ts: string; count: number; volume: number; success: number; failed: number }
interface TopMerchant { name: string; count: number; volume: number }
interface TopUser { id: string; name: string; count: number; volume: number }
interface Stats {
  todayCount: number; todayVolume: number; todaySuccess: number; todayFailed: number;
  tpm: number; last5MinCount: number; activeUsersLast10Min: number;
}
interface FeedResponse {
  items: Item[]; stats: Stats; buckets: Bucket[];
  topMerchants: TopMerchant[]; topUsers: TopUser[];
  anomaly: { active: boolean; baseline?: number; recent?: number; message?: string };
  serverTs: string;
}

const POLL_MS = 3500;
const MAX_FEED_ITEMS = 200;

function fmtINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function kindMeta(kind: string): { color: string; label: string; Icon: any } {
  if (kind === "txn_done") return { color: "var(--a-success)", label: "Payment", Icon: IndianRupee };
  if (kind === "txn_failed") return { color: "var(--a-danger)", label: "Failed", Icon: AlertTriangle };
  if (kind === "txn_flagged") return { color: "var(--a-warn)", label: "Flagged", Icon: ShieldAlert };
  if (kind === "txn_pending") return { color: "var(--a-info)", label: "Pending", Icon: Activity };
  if (kind.startsWith("kyc_")) return { color: "var(--a-info)", label: "KYC", Icon: FileCheck2 };
  if (kind === "user_new") return { color: "var(--a-accent)", label: "Signup", Icon: UserPlus };
  if (kind === "fraud") return { color: "var(--a-danger)", label: "Fraud", Icon: ShieldAlert };
  return { color: "var(--a-muted)", label: "Event", Icon: Activity };
}

function LiveActivityPage() {
  const [feed, setFeed] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [topMerchants, setTopMerchants] = useState<TopMerchant[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [anomaly, setAnomaly] = useState<FeedResponse["anomaly"]>({ active: false });
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [tick, setTick] = useState(0); // forces relTime re-render

  const lastTsRef = useRef<string>("");
  const inflight = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await callAdminFn<FeedResponse>({
        action: "live_feed",
        sinceTs: lastTsRef.current || undefined,
        limit: 60,
      });
      // Always refresh aggregate widgets
      setStats(res.stats);
      setBuckets(res.buckets);
      setTopMerchants(res.topMerchants);
      setTopUsers(res.topUsers);
      setAnomaly(res.anomaly);
      setUpdatedAt(new Date().toLocaleTimeString());
      setErr("");

      // Merge new feed items (dedupe by id)
      if (res.items.length) {
        const fresh: Item[] = [];
        for (const it of res.items) {
          if (!seenIds.current.has(it.id)) {
            seenIds.current.add(it.id);
            fresh.push(it);
          }
        }
        if (fresh.length) {
          setFeed((prev) => {
            const combined = [...fresh, ...prev].slice(0, MAX_FEED_ITEMS);
            return combined;
          });
          // Update lastTs to newest item
          const newest = res.items[0]?.ts;
          if (newest && newest > lastTsRef.current) lastTsRef.current = newest;
        }
      } else if (!lastTsRef.current && res.serverTs) {
        // First load returned no items but we still want a baseline
        lastTsRef.current = res.serverTs;
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load live feed");
    } finally {
      inflight.current = false;
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    void load();
    if (paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, paused]);

  // Tick once a second to update relative timestamps
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const tokens = useMemo(() => adminChartTokens(), []);
  const tpmChartData = useMemo(
    () => buckets.map((b) => ({
      t: new Date(b.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      count: b.count, volume: b.volume,
    })),
    [buckets],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: 999,
              background: paused ? "var(--a-muted)" : "var(--a-danger)",
              boxShadow: paused ? "none" : "0 0 0 0 var(--a-danger)",
              animation: paused ? "none" : "live-pulse 1.6s ease-out infinite",
            }} />
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--a-text)" }}>
              Live Activity
            </h1>
            <span className="a-mono" style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: paused ? "var(--a-surface-2)" : "color-mix(in oklab, var(--a-danger) 18%, transparent)", color: paused ? "var(--a-muted)" : "var(--a-danger)", border: "1px solid var(--a-border)", letterSpacing: "0.12em" }}>
              {paused ? "PAUSED" : "LIVE"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Real-time stream of payments, KYC events, signups, and fraud alerts
            {updatedAt && <span> · updated {updatedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="a-btn-ghost"
            onClick={() => setPaused((p) => !p)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13 }}
            title={paused ? "Resume live updates" : "Pause live updates"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="a-btn-ghost"
            onClick={() => void load()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13 }}
            title="Refresh now"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div style={{ padding: 12, borderRadius: 10, background: "color-mix(in oklab, var(--a-danger) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--a-danger) 35%, transparent)", color: "var(--a-danger)", fontSize: 13 }}>
          {err}
        </div>
      )}

      {anomaly.active && (
        <div style={{ padding: 12, borderRadius: 10, background: "color-mix(in oklab, var(--a-warn) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--a-warn) 35%, transparent)", color: "var(--a-warn)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} />
          <span><b>Anomaly detected:</b> {anomaly.message}</span>
        </div>
      )}

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <KpiTile icon={IndianRupee} label="Volume today" value={stats ? fmtINR(stats.todayVolume) : "—"} sub={stats ? `${stats.todayCount} txns` : ""} />
        <KpiTile icon={Activity} label="Txns / min" value={stats ? stats.tpm.toFixed(1) : "—"} sub={stats ? `${stats.last5MinCount} in last 5m` : ""} />
        <KpiTile icon={Users} label="Active now" value={stats ? String(stats.activeUsersLast10Min) : "—"} sub="last 10 min" />
        <KpiTile icon={TrendingUp} label="Success rate" value={stats && stats.todayCount > 0 ? `${((stats.todaySuccess / stats.todayCount) * 100).toFixed(1)}%` : "—"} sub={stats ? `${stats.todayFailed} failed` : ""} accent={stats && stats.todayFailed > 0 ? "var(--a-warn)" : "var(--a-success)"} />
      </div>

      {/* ── Body grid: feed + side panel ────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
        {/* Feed */}
        <div style={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 280px)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--a-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--a-text)" }}>Event stream</div>
            <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", letterSpacing: "0.08em" }}>
              {feed.length} EVENTS · POLL {Math.round(POLL_MS / 1000)}s
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {feed.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--a-muted)", fontSize: 13 }}>
                Waiting for events…
              </div>
            ) : (
              feed.map((it) => <FeedRow key={it.id} item={it} />)
            )}
          </div>
        </div>

        {/* Side panel: per-min chart + top merchants + top users */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--a-text)", marginBottom: 8 }}>Txns / min · last 60</div>
            <div style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tpmChartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                  <defs>
                    <linearGradient id="livefill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={tokens.accent} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={tokens.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={tokens.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="t" hide />
                  <YAxis tick={{ fontSize: 10, fill: tokens.muted }} width={28} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: tokens.tooltipBg, border: `1px solid ${tokens.tooltipBorder}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: tokens.muted }}
                  />
                  <Area type="monotone" dataKey="count" stroke={tokens.accent} strokeWidth={1.5} fill="url(#livefill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <SidePanel title="Top merchants · last 60m" empty={topMerchants.length === 0 ? "No activity yet" : null}>
            {topMerchants.map((m, i) => (
              <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < topMerchants.length - 1 ? "1px solid var(--a-border)" : "none" }}>
                <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", width: 16 }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--a-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>{m.count} txn · {fmtINR(m.volume)}</div>
                </div>
              </div>
            ))}
          </SidePanel>

          <SidePanel title="Top users · last 60m" empty={topUsers.length === 0 ? "No activity yet" : null}>
            {topUsers.map((u, i) => (
              <Link
                key={u.id}
                to="/admin/users/$id" params={{ id: u.id }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < topUsers.length - 1 ? "1px solid var(--a-border)" : "none", textDecoration: "none", color: "inherit" }}
              >
                <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", width: 16 }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--a-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</div>
                  <div className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>{u.count} txn · {fmtINR(u.volume)}</div>
                </div>
                <ArrowUpRight size={12} style={{ color: "var(--a-muted)" }} />
              </Link>
            ))}
          </SidePanel>
        </div>
      </div>

      <style>{`
        @keyframes live-pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--a-danger) 60%, transparent); }
          70%  { box-shadow: 0 0 0 8px color-mix(in oklab, var(--a-danger) 0%, transparent); }
          100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--a-danger) 0%, transparent); }
        }
        @keyframes feed-in {
          from { opacity: 0; transform: translateY(-6px); background: color-mix(in oklab, var(--a-accent) 10%, transparent); }
          to   { opacity: 1; transform: translateY(0); background: transparent; }
        }
      `}</style>
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 12,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
        display: "grid", placeItems: "center", color: accent || "var(--a-accent)",
        flexShrink: 0,
      }}>
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: "var(--a-muted)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
        <div className="a-mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--a-text)", letterSpacing: "-0.02em", marginTop: 2 }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: "var(--a-muted)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SidePanel({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string | null }) {
  return (
    <div style={{ background: "var(--a-surface)", border: "1px solid var(--a-border)", borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--a-text)", marginBottom: 8 }}>{title}</div>
      {empty ? (
        <div style={{ fontSize: 12, color: "var(--a-muted)", padding: "6px 0" }}>{empty}</div>
      ) : children}
    </div>
  );
}

function FeedRow({ item }: { item: Item }) {
  const meta = kindMeta(item.kind);
  const Icon = meta.Icon;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 16px", borderBottom: "1px solid var(--a-border)",
      borderLeft: `2px solid ${meta.color}`,
      animation: "feed-in 360ms ease-out",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: "var(--a-surface-2)", border: "1px solid var(--a-border)",
        display: "grid", placeItems: "center", color: meta.color,
        flexShrink: 0,
      }}>
        <Icon size={13} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, background: "var(--a-surface-2)" }}>
            {meta.label}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--a-text)" }}>{item.title}</span>
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11, color: "var(--a-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.subtitle}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div className="a-mono" style={{ fontSize: 11, color: "var(--a-text)" }}>{fmtTime(item.ts)}</div>
        <div style={{ fontSize: 10, color: "var(--a-muted)" }}>{relTime(item.ts)}</div>
      </div>
      {item.userId && (
        <Link
          to="/admin/users/$id" params={{ id: item.userId }}
          style={{ color: "var(--a-muted)", display: "grid", placeItems: "center", padding: 4 }}
          title="Open user"
        >
          <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  );
}
