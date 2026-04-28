/**
 * Haptic feedback vocabulary.
 *
 * One file, one API. Each pattern is tuned to *feel* like the interaction:
 * a tap is crisp, a success is a rising two-beat, an error is a stutter,
 * a long-press is a slow swell. We use Capacitor on native and the Web
 * Vibration API in the browser as a graceful fallback. Anything beyond a
 * single Light tap on native gets composed from multiple short impacts so
 * the bloom feels organic instead of buzzing.
 *
 * Usage:
 *   import { haptics } from "@/lib/haptics";
 *   haptics.tap();          // micro tactile tick
 *   haptics.select();       // sharp selection click
 *   haptics.success();      // rising two-beat (payment ok, claim)
 *   haptics.warning();      // single firm thump
 *   haptics.error();        // triple stutter
 *   haptics.bloom();        // expanding swell (FAB launch, modal open)
 *   haptics.swipe();        // light swoosh (page change, panel close)
 *   haptics.heartbeat();    // double-pulse (greeting, like)
 */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};
const STORAGE_KEY = "tw_haptics_enabled";

/**
 * Wrap a haptic implementation so it NEVER throws or rejects, regardless of
 * platform support. Buttons stay animated via CSS even when haptics are
 * unavailable (older browsers, iOS Safari without user gesture, locked-down
 * webviews, SSR, etc.). Failures are silent by design.
 */
function safe<A extends unknown[]>(fn: (...args: A) => Promise<void> | void) {
  return async (...args: A): Promise<void> => {
    try { await fn(...args); } catch { /* swallow — haptics are best-effort */ }
  };
}

let enabled = (() => {
  if (typeof window === "undefined") return true;
  try { const v = localStorage.getItem(STORAGE_KEY); return v === null ? true : v === "1"; }
  catch { return true; }
})();

let lastFired = 0;
const THROTTLE_MS = 35; // prevents rapid-fire taps from melting into a buzz

function canFire(): boolean {
  if (!enabled) return false;
  const now = performance.now();
  if (now - lastFired < THROTTLE_MS) return false;
  lastFired = now;
  return true;
}

function webVibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

async function impact(style: ImpactStyle, webMs: number) {
  if (isNative()) {
    try { await Haptics.impact({ style }); return; } catch { /* fall through */ }
  }
  webVibrate(webMs);
}

async function notification(type: NotificationType, webPattern: number[]) {
  if (isNative()) {
    try { await Haptics.notification({ type }); return; } catch { /* fall through */ }
  }
  webVibrate(webPattern);
}

async function compose(steps: Array<{ style: ImpactStyle; delay?: number }>, webPattern: number[]) {
  if (isNative()) {
    try {
      for (const s of steps) {
        await Haptics.impact({ style: s.style });
        if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
      }
      return;
    } catch { /* fall through */ }
  }
  webVibrate(webPattern);
}

export const haptics = {
  /** Toggle the entire system. Persisted across reloads. */
  setEnabled(v: boolean) {
    enabled = v;
    try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  },
  isEnabled() { return enabled; },

  /** Micro-tap — for tile/icon taps where you want a featherlight tick. */
  async tap() {
    if (!canFire()) return;
    await impact(ImpactStyle.Light, 8);
  },

  /** Selection click — discrete, crisp. Tab switches, toggles, segment picks. */
  async select() {
    if (!canFire()) return;
    if (isNative()) {
      try { await Haptics.selectionStart(); await Haptics.selectionChanged(); await Haptics.selectionEnd(); return; }
      catch { /* fall through */ }
    }
    webVibrate(12);
  },

  /** Medium thump — primary CTA press, confirm. */
  async press() {
    if (!canFire()) return;
    await impact(ImpactStyle.Medium, 18);
  },

  /** Heavy strike — destructive or final action. */
  async strike() {
    if (!canFire()) return;
    await impact(ImpactStyle.Heavy, 28);
  },

  /** Rising two-beat — success state (payment ok, reward claimed). */
  async success() {
    if (!canFire()) return;
    await notification(NotificationType.Success, [14, 60, 22]);
  },

  /** Single firm thump — warning, near limit. */
  async warning() {
    if (!canFire()) return;
    await notification(NotificationType.Warning, [22, 80, 22]);
  },

  /** Stutter — error / rejected. */
  async error() {
    if (!canFire()) return;
    await notification(NotificationType.Error, [10, 40, 10, 40, 18]);
  },

  /** Expanding swell — FAB launch, modal/sheet bloom, screen morph. */
  async bloom() {
    if (!canFire()) return;
    await compose(
      [
        { style: ImpactStyle.Light, delay: 50 },
        { style: ImpactStyle.Medium, delay: 80 },
        { style: ImpactStyle.Heavy },
      ],
      [10, 50, 16, 80, 26]
    );
  },

  /** Soft swoosh — page transitions, panel close, swipe complete. */
  async swipe() {
    if (!canFire()) return;
    await compose(
      [{ style: ImpactStyle.Light, delay: 40 }, { style: ImpactStyle.Light }],
      [8, 40, 8]
    );
  },

  /** Heartbeat double-pulse — greeting tap, like, "you're seen". */
  async heartbeat() {
    if (!canFire()) return;
    await compose(
      [{ style: ImpactStyle.Medium, delay: 110 }, { style: ImpactStyle.Light }],
      [16, 110, 10]
    );
  },

  /** Long-press confirmation — slow build then release. */
  async longPress() {
    if (!canFire()) return;
    await compose(
      [
        { style: ImpactStyle.Light, delay: 120 },
        { style: ImpactStyle.Medium, delay: 120 },
        { style: ImpactStyle.Heavy },
      ],
      [10, 120, 18, 120, 30]
    );
  },
};
