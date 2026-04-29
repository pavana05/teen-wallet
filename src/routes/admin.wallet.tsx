import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { callAdminFn } from "@/admin/lib/adminAuth";
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Lock, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/wallet")({
  component: WalletOverviewPage,
});

interface TopWallet {
  id: string; name: string; phone: string | null;
  balance: number; locked: boolean; kyc: string;
}
interface Adjustment {
  id: string; admin_email: string; user_id: string;
  delta: number; reason: string | null;
  old_balance: number; new_balance: number;
  created_at: string;
}
interface Resp {
  stats: {
    totalFloat: number; avgBalance: number;
    walletsActive: number; walletsLocked: number; walletsZero: number;
    walletsOver1k: number; walletsOver10k: number;
    movement24h: number; txns24hCount: number; sample: number;
  };
  topWallets: TopWallet[];
  recentAdjustments: Adjustment[];
}

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}
function fmtINRFull(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}
function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function WalletOverviewPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminFn<Resp>({ action: "wallet_overview" });
      setData(r);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Wallet size={20} /> Wallet Management
          </h1>
          <div style={{ fontSize: 12, color: "var(--a-muted)", marginTop: 4 }}>
            Aggregate float, top wallets, balance adjustments. Sampling first {data?.stats.sample ?? 0} wallets by balance.
          </div>
        </div>
        <button onClick={load} disabled={loading} className="a-btn-ghost" style={{ padding: "6px 10px", fontSize: 11 }}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} /> Refresh
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Kpi label="Total float" value={data ? fmtINRFull(data.stats.totalFloat) : "—"} sub={data ? `Avg ${fmtINR(data.stats.avgBalance)}` : undefined} />
        <Kpi label="Active wallets" value={data ? data.stats.walletsActive.toLocaleString() : "—"} sub={data ? `${data.stats.walletsLocked.toLocaleString()} locked` : undefined} />
        <Kpi label="Wallets ≥ ₹10k" value={data ? data.stats.walletsOver10k.toLocaleString() : "—"} sub={data ? `${data.stats.walletsOver1k.toLocaleString()} ≥ ₹1k` : undefined} />
        <Kpi label="24h movement" value={data ? fmtINRFull(data.stats.movement24h) : "—"} sub={data ? `${data.stats.txns24hCount.toLocaleString()} success txns` : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Panel title="Top wallets by balance">
          {!data ? <Loading /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>{["User", "Phone", "KYC", "Balance", ""].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {data.topWallets.map((w) => (
                  <tr key={w.id}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {w.locked && <Lock size={11} style={{ color: "var(--a-danger, #ef4444)" }} />}
                        <span style={{ fontWeight: 500 }}>{w.name}</span>
                      </div>
                    </td>
                    <td style={{ ...td, color: "var(--a-muted)" }} className="a-mono">{w.phone || "—"}</td>
                    <td style={td}>
                      <span className="a-mono" style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 4,
                        border: "1px solid var(--a-border)", color: "var(--a-muted)",
                        textTransform: "uppercase", letterSpacing: "0.04em",
                      }}>{w.kyc}</span>
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmtINRFull(w.balance)}</td>
                    <td style={td}>
                      <Link to="/admin/users/$id" params={{ id: w.id }} style={{ color: "var(--a-accent)", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 2 }}>
                        Open <ArrowUpRight size={10} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Recent admin adjustments">
          {!data ? <Loading /> : data.recentAdjustments.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--a-muted)", padding: 8 }}>No balance adjustments yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.recentAdjustments.map((a) => {
                const credit = a.delta >= 0;
                return (
                  <div key={a.id} style={{
                    padding: 10, borderRadius: 8, border: "1px solid var(--a-border)",
                    background: "var(--a-surface-2)", display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {credit
                        ? <TrendingUp size={13} style={{ color: "var(--a-success, #10b981)" }} />
                        : <TrendingDown size={13} style={{ color: "var(--a-danger, #ef4444)" }} />}
                      <span style={{
                        fontWeight: 600, fontSize: 13,
                        color: credit ? "var(--a-success, #10b981)" : "var(--a-danger, #ef4444)",
                      }}>
                        {credit ? "+" : ""}{fmtINRFull(a.delta)}
                      </span>
                      <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)", marginLeft: "auto" }}>
                        {timeAgo(a.created_at)}
                      </span>
                    </div>
                    {a.reason && <div style={{ fontSize: 11, color: "var(--a-text)" }}>{a.reason}</div>}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <span className="a-mono" style={{ fontSize: 10, color: "var(--a-muted)" }}>by {a.admin_email}</span>
                      <Link to="/admin/users/$id" params={{ id: a.user_id }} style={{ fontSize: 10, color: "var(--a-accent)" }}>
                        View user →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: "var(--a-muted)",
  borderBottom: "1px solid var(--a-border)", fontWeight: 500,
  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
};
const td: React.CSSProperties = { padding: "8px", borderBottom: "1px solid var(--a-border)" };

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      padding: 14, border: "1px solid var(--a-border)", borderRadius: 10,
      background: "var(--a-surface)", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ color: "var(--a-muted)", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
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
function Loading() {
  return <div style={{ fontSize: 12, color: "var(--a-muted)", padding: 8 }}>Loading…</div>;
}
