// Lightweight perf telemetry for the admin app.
// All counters live at the module level — no React re-renders unless a
// subscriber calls `subscribe()`. Designed to add zero overhead in production
// (the overlay is gated by `isDevHost()`).

import { useEffect, useState } from "react";

export interface PanelStat {
  /** ms of the most recent load */
  lastMs: number;
  /** rolling average of the last 10 loads */
  avgMs: number;
  /** number of loads recorded for this panel */
  loads: number;
  /** ts of the most recent load (epoch ms) */
  lastAt: number;
}

interface State {
  /** total fetch() calls to the admin-auth edge function */
  requests: number;
  /** number of realtime postgres_changes events received in the admin shell */
  realtimeEvents: number;
  /** per-panel load timings */
  panels: Record<string, PanelStat>;
  /** rolling per-action request count */
  actions: Record<string, number>;
}

const state: State = {
  requests: 0,
  realtimeEvents: 0,
  panels: {},
  actions: {},
};

const listeners = new Set<() => void>();
function emit() {
  // Snapshot — do not mutate after notifying.
  for (const l of listeners) l();
}

export function recordRequest(action?: string) {
  state.requests++;
  if (action) state.actions[action] = (state.actions[action] ?? 0) + 1;
  emit();
}

export function recordRealtime() {
  state.realtimeEvents++;
  emit();
}

export function recordPanelLoad(panel: string, ms: number) {
  const prev = state.panels[panel];
  const loads = (prev?.loads ?? 0) + 1;
  // Simple EMA on the last ~10 samples.
  const avgMs = prev ? Math.round(prev.avgMs * 0.9 + ms * 0.1) : ms;
  state.panels[panel] = { lastMs: Math.round(ms), avgMs, loads, lastAt: Date.now() };
  emit();
}

export function resetPerf() {
  state.requests = 0;
  state.realtimeEvents = 0;
  state.panels = {};
  state.actions = {};
  emit();
}

export function getPerfSnapshot(): State {
  return {
    requests: state.requests,
    realtimeEvents: state.realtimeEvents,
    panels: { ...state.panels },
    actions: { ...state.actions },
  };
}

/** React hook — subscribes to perf changes. Use only inside the overlay. */
export function usePerfState(): State {
  const [snap, setSnap] = useState<State>(() => getPerfSnapshot());
  useEffect(() => {
    const update = () => setSnap(getPerfSnapshot());
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  return snap;
}

/** Helper: time an async operation and report it as a panel load. */
export async function timePanelLoad<T>(panel: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    recordPanelLoad(panel, performance.now() - t0);
  }
}

/** True when running on lovableproject.com / localhost (preview/dev). */
export function isDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovableproject.com") ||
    h.endsWith("-dev.lovable.app")
  );
}
