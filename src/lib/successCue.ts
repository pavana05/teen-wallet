/**
 * Tiny, dependency-free success cue used after micro-interactions like
 * "Phone verified". Honors the user's "Sounds & haptics" preference saved
 * by ProfilePanel under `tw-profile-prefs`, and respects the OS
 * `prefers-reduced-motion` setting (we still emit audio/haptics there —
 * reduced motion only suppresses *visual* motion, not audio cues).
 *
 * Returns whether each side-channel actually fired so callers can decide
 * to also show a visual fallback when both are muted.
 */

export interface SoundPrefs {
  /** Whether the user opted into sounds + haptics (default true). */
  sounds: boolean;
}

const PREFS_KEY = "tw-profile-prefs";

export function readSoundPrefs(): SoundPrefs {
  if (typeof window === "undefined") return { sounds: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { sounds: true };
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return { sounds: parsed.sounds !== false };
  } catch {
    return { sounds: true };
  }
}

export function setSoundPrefs(next: Partial<SoundPrefs>) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const cur = raw ? JSON.parse(raw) : {};
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...cur, ...next }));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Emit a short two-note "ding" via WebAudio + a 12ms haptic blip.
 * No-op when the user has muted via Settings, or when we're SSR.
 * Safe to call from React effects — never throws.
 */
export function playSuccessCue(): { audio: boolean; haptic: boolean } {
  const out = { audio: false, haptic: false };
  if (typeof window === "undefined") return out;
  const { sounds } = readSoundPrefs();
  if (!sounds) return out;

  // --- Haptic (Android / some Chromium iOS — silently no-ops elsewhere) ---
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([12, 40, 18]);
      out.haptic = true;
    }
  } catch { /* ignore */ }

  // --- Audio (WebAudio "ding") — gated behind user-gesture by browsers,
  // so we wrap in try/catch and let it silently no-op when blocked. ---
  try {
    const Ctx: typeof AudioContext | undefined =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return out;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const tone = (freq: number, start: number, dur: number, gain: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(gain, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };

    tone(880, 0, 0.18, 0.18);   // A5
    tone(1318.5, 0.09, 0.22, 0.14); // E6 — brighter resolution
    out.audio = true;

    // Auto-close the context to free the audio device.
    setTimeout(() => { try { void ctx.close(); } catch { /* ignore */ } }, 600);
  } catch { /* ignore — autoplay blocked, no audio device, etc. */ }

  return out;
}

/**
 * Prefers-reduced-motion helper that's safe on SSR and updates reactively.
 * Returns the current snapshot — pair with a window matchMedia listener
 * if you need live updates within a single React render.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
