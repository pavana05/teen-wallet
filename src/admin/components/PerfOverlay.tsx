// Floating perf overlay for the admin app — visible only on dev / preview hosts.
// Shows total request count, realtime events, per-action calls, and per-panel
// last/avg load durations.
import { useState } from "react";
import { Activity, X, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { isDevHost, resetPerf, usePerfState } from "@/admin/lib/perfBus";

export function PerfOverlay() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const perf = usePerfState();

  if (!isDevHost()) return null;

  const panelEntries = Object.entries(perf.panels).sort((a, b) => b[1].lastAt - a[1].lastAt);
  const actionEntries = Object.entries(perf.actions).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      {!open && (
        <button
          aria-label="Open performance overlay"
          onClick={() => setOpen(true)}
          className="perf-fab"
        >
          <Activity size={14} />
          <span className="a-mono">{perf.requests}</span>
        </button>
      )}

      {open && (
        <div className="perf-overlay">
          <div className="perf-head">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={14} style={{ color: "var(--a-accent)" }} />
              <span className="a-mono" style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--a-accent)" }}>
                Admin Perf
              </span>
              <span style={{ fontSize: 10, color: "var(--a-muted)" }}>(dev only)</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="perf-icon-btn" onClick={() => setExpanded((v) => !v)} aria-label="Toggle details">
                {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </button>
              <button className="perf-icon-btn" onClick={resetPerf} aria-label="Reset counters" title="Reset counters">
                <RotateCcw size={12} />
              </button>
              <button className="perf-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="perf-row">
            <div className="perf-stat">
              <div className="perf-stat-label">Requests</div>
              <div className="perf-stat-value">{perf.requests}</div>
            </div>
            <div className="perf-stat">
              <div className="perf-stat-label">Realtime</div>
              <div className="perf-stat-value">{perf.realtimeEvents}</div>
            </div>
            <div className="perf-stat">
              <div className="perf-stat-label">Panels</div>
              <div className="perf-stat-value">{Object.keys(perf.panels).length}</div>
            </div>
          </div>

          {expanded && (
            <>
              <div className="perf-section-title">Panel load (ms)</div>
              <div className="perf-list">
                {panelEntries.length === 0 && <div className="perf-empty">No panels yet.</div>}
                {panelEntries.map(([name, s]) => (
                  <div key={name} className="perf-item">
                    <span className="perf-item-name">{name}</span>
                    <span className="a-mono perf-item-meta">
                      <span style={{ color: msColor(s.lastMs) }}>{s.lastMs}ms</span>
                      <span style={{ color: "var(--a-muted)", marginLeft: 6 }}>avg {s.avgMs}</span>
                      <span style={{ color: "var(--a-muted)", marginLeft: 6 }}>×{s.loads}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="perf-section-title">Top actions</div>
              <div className="perf-list">
                {actionEntries.length === 0 && <div className="perf-empty">No requests yet.</div>}
                {actionEntries.map(([action, count]) => (
                  <div key={action} className="perf-item">
                    <span className="perf-item-name a-mono" style={{ fontSize: 11 }}>{action}</span>
                    <span className="a-mono perf-item-meta">{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function msColor(ms: number): string {
  if (ms < 250) return "var(--a-success, #22c55e)";
  if (ms < 800) return "var(--a-warn, #f59e0b)";
  return "var(--a-danger, #ef4444)";
}
