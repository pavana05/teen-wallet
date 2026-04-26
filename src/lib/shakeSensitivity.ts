// Persisted shake-to-report sensitivity. Read/written from localStorage so
// the user can change it from Profile → Help without redeploying. The
// detector reads these values fresh on every motion event.

export type ShakeSensitivity = "off" | "normal" | "strict";

export interface ShakeProfile {
  threshold: number;        // accel-delta needed for one jolt
  shakesRequired: number;   // jolts in window to trigger
  windowMs: number;         // collection window
}

const KEY = "tw-shake-sensitivity-v1";

export const SHAKE_PROFILES: Record<ShakeSensitivity, ShakeProfile> = {
  // Off disables triggering — matched by detector returning early.
  off:    { threshold: Infinity, shakesRequired: 999, windowMs: 1200 },
  normal: { threshold: 18, shakesRequired: 3, windowMs: 1200 },
  // Strict = harder to fire (avoid accidental triggers in pocket / car).
  strict: { threshold: 26, shakesRequired: 4, windowMs: 1000 },
};

export function getShakeSensitivity(): ShakeSensitivity {
  if (typeof localStorage === "undefined") return "normal";
  const v = localStorage.getItem(KEY);
  if (v === "off" || v === "normal" || v === "strict") return v;
  return "normal";
}

export function setShakeSensitivity(v: ShakeSensitivity): void {
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  // Notify any active detector to re-read.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tw-shake-sensitivity-changed", { detail: v }));
  }
}

export function getActiveShakeProfile(): ShakeProfile {
  return SHAKE_PROFILES[getShakeSensitivity()];
}
