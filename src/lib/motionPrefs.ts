// User-controllable motion intensity.
//
// Three levels:
//   • full    – all premium animations (default unless OS prefers-reduced-motion)
//   • reduced – essential cues only (fades / opacity); no perspective floor,
//               drifting ribbons, particle motes, or large transforms
//   • off     – no animation at all; everything is static
//
// Applied app-wide by toggling classes on <html>:
//   .motion-full  .motion-reduced  .motion-off
// CSS uses these classes to gate keyframes / transitions.

import { useEffect, useSyncExternalStore } from "react";

export type MotionLevel = "full" | "reduced" | "off";
const STORAGE_KEY = "tw-motion-level-v1";

function detectOsReduced(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readStored(): MotionLevel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "full" || raw === "reduced" || raw === "off") return raw;
    return null;
  } catch {
    return null;
  }
}

let current: MotionLevel = readStored() ?? (detectOsReduced() ? "reduced" : "full");
const listeners = new Set<() => void>();

function applyToDocument(level: MotionLevel) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("motion-full", "motion-reduced", "motion-off");
  root.classList.add(`motion-${level}`);
}

// Apply on module load (client-side only).
if (typeof document !== "undefined") applyToDocument(current);

export function getMotionLevel(): MotionLevel {
  return current;
}

export function setMotionLevel(level: MotionLevel) {
  current = level;
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    /* ignore quota */
  }
  applyToDocument(level);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook returning [level, setter]. */
export function useMotionLevel(): [MotionLevel, (l: MotionLevel) => void] {
  const level = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  // Re-apply if React remounts (e.g. after SSR hydration).
  useEffect(() => {
    applyToDocument(current);
  }, []);
  return [level, setMotionLevel];
}

/** True if the user wants animations meaningfully reduced or off. */
export function shouldReduceMotion(): boolean {
  return current !== "full";
}

/** True if there should be no animation at all. */
export function isMotionOff(): boolean {
  return current === "off";
}
