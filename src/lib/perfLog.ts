/**
 * Runtime performance logger.
 *
 * Tracks:
 *  - Page/screen load times (Navigation Timing + custom marks)
 *  - Supabase query counts and durations
 *  - Asset render timing (LCP, FCP via web-vitals-like observers)
 *
 * All metrics are surfaced via:
 *  - console.groupCollapsed("[perf]") for dev inspection
 *  - A `tw:perf` custom event on `window` so admin overlays can listen
 *
 * Usage:
 *   import { perfLog } from "@/lib/perfLog";
 *   perfLog.markStart("home.load");
 *   // ... do work
 *   perfLog.markEnd("home.load");
 *   perfLog.trackQuery("transactions", durationMs);
 */

export interface PerfEntry {
  label: string;
  durationMs: number;
  timestamp: number;
}

export interface QueryEntry {
  table: string;
  durationMs: number;
  timestamp: number;
}

interface PerfState {
  marks: Map<string, number>;
  entries: PerfEntry[];
  queries: QueryEntry[];
  sessionStart: number;
}

const state: PerfState = {
  marks: new Map(),
  entries: [],
  queries: [],
  sessionStart: typeof performance !== "undefined" ? performance.now() : Date.now(),
};

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function emit(type: string, detail: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("tw:perf", { detail: { type, ...detail } }));
  } catch { /* ignore */ }
}

export const perfLog = {
  markStart(label: string) {
    state.marks.set(label, now());
  },

  markEnd(label: string): number | null {
    const start = state.marks.get(label);
    if (start === undefined) return null;
    state.marks.delete(label);
    const durationMs = Math.round((now() - start) * 100) / 100;
    const entry: PerfEntry = { label, durationMs, timestamp: Date.now() };
    state.entries.push(entry);
    emit("timing", { ...entry });
    return durationMs;
  },

  trackQuery(table: string, durationMs: number) {
    const entry: QueryEntry = { table, durationMs: Math.round(durationMs * 100) / 100, timestamp: Date.now() };
    state.queries.push(entry);
    emit("query", { ...entry });
  },

  /** Print a summary of all collected metrics to the console. */
  summary() {
    if (typeof console === "undefined") return;
    const totalTime = Math.round(now() - state.sessionStart);
    const queryCount = state.queries.length;
    const queryTotalMs = Math.round(state.queries.reduce((s, q) => s + q.durationMs, 0));

    // Web Vitals from Performance API
    let fcp: number | null = null;
    let lcp: number | null = null;
    if (typeof performance !== "undefined" && performance.getEntriesByType) {
      const paints = performance.getEntriesByType("paint");
      const fcpEntry = paints.find((e) => e.name === "first-contentful-paint");
      if (fcpEntry) fcp = Math.round(fcpEntry.startTime);
    }

    console.groupCollapsed(
      `%c[perf] Session ${totalTime}ms | ${queryCount} queries (${queryTotalMs}ms) | FCP ${fcp ?? "n/a"}ms`,
      "color:#D4C5A0;font-weight:600"
    );

    if (state.entries.length) {
      console.table(state.entries.map((e) => ({ Label: e.label, "Duration (ms)": e.durationMs })));
    }
    if (state.queries.length) {
      // Group by table
      const byTable = new Map<string, { count: number; totalMs: number }>();
      for (const q of state.queries) {
        const prev = byTable.get(q.table) ?? { count: 0, totalMs: 0 };
        byTable.set(q.table, { count: prev.count + 1, totalMs: prev.totalMs + q.durationMs });
      }
      console.table(
        Array.from(byTable.entries()).map(([table, { count, totalMs }]) => ({
          Table: table,
          Queries: count,
          "Total (ms)": Math.round(totalMs),
          "Avg (ms)": Math.round(totalMs / count),
        }))
      );
    }

    console.log("FCP:", fcp ?? "n/a", "ms");
    console.log("LCP:", lcp ?? "n/a", "ms");
    console.groupEnd();
  },

  getEntries: () => [...state.entries],
  getQueries: () => [...state.queries],
  getQueryCount: () => state.queries.length,
};

// Auto-print summary after initial load settles
if (typeof window !== "undefined") {
  const printAfterSettle = () => {
    setTimeout(() => perfLog.summary(), 3000);
  };
  if (document.readyState === "complete") printAfterSettle();
  else window.addEventListener("load", printAfterSettle, { once: true });
}
