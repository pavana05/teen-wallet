// FPS guard — samples requestAnimationFrame frame times during a critical
// animation window (slide drag, processing orb) and, if sustained frame drops
// are detected, automatically downgrades the global motion level to "reduced"
// so heavy effects (perspective floor, drifting ribbons, particle motes,
// large blurs) stop competing for the main thread.
//
// Design goals:
//   • Zero cost when not actively sampling.
//   • One downgrade per session — never thrash up/down.
//   • Respect explicit user choice: if the user already picked "full" in
//     this session AFTER a downgrade, we won't override them again.
//   • Debug breadcrumb on downgrade so we can trace it later.

import { breadcrumb } from "./breadcrumbs";
import { getMotionLevel, setMotionLevel } from "./motionPrefs";

type SampleResult = {
  avgFps: number;
  p95FrameMs: number;
  drops: number;       // # of frames > 33ms (i.e. <30fps)
  samples: number;
};

const DOWNGRADE_FLAG = "tw-fps-downgrade-applied-v1";

function alreadyDowngraded(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(DOWNGRADE_FLAG) === "1"; } catch { return false; }
}
function markDowngraded() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(DOWNGRADE_FLAG, "1"); } catch { /* ignore */ }
}

/**
 * Start sampling frame times. Returns a stop() function. When stop() is called,
 * if the sampled window shows sustained jank, motion is automatically reduced.
 *
 * @param label  Short tag for breadcrumb context (e.g. "slide", "processing")
 * @param opts.minSamples  Minimum frames before evaluating (default 30 ≈ 0.5s)
 * @param opts.dropThresholdPct  Fraction of dropped frames that triggers a downgrade (default 0.25 = 25%)
 */
export function sampleFrames(
  label: string,
  opts: { minSamples?: number; dropThresholdPct?: number } = {},
): () => SampleResult | null {
  const minSamples = opts.minSamples ?? 30;
  const dropThresholdPct = opts.dropThresholdPct ?? 0.25;

  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    return () => null;
  }

  const frameTimes: number[] = [];
  let last = performance.now();
  let stopped = false;
  let rafId = 0;

  const tick = (now: number) => {
    if (stopped) return;
    const dt = now - last;
    last = now;
    // Skip the very first delta (often huge) and absurd outliers from tab
    // throttling so a backgrounded tab doesn't poison the sample.
    if (frameTimes.length > 0 && dt < 500) frameTimes.push(dt);
    else if (frameTimes.length === 0) frameTimes.push(dt);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return function stop(): SampleResult | null {
    stopped = true;
    cancelAnimationFrame(rafId);
    if (frameTimes.length < minSamples) return null;

    // Drop the first frame (warm-up) before computing.
    const samples = frameTimes.slice(1);
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
    const avgFps = avgMs > 0 ? 1000 / avgMs : 0;
    const drops = samples.filter((d) => d > 33).length;
    const dropRatio = drops / samples.length;

    const result: SampleResult = {
      avgFps: Math.round(avgFps * 10) / 10,
      p95FrameMs: Math.round(p95 * 10) / 10,
      drops,
      samples: samples.length,
    };

    // Auto-downgrade if jank is sustained AND we haven't already nudged the
    // user this session AND they're currently on "full".
    if (
      dropRatio >= dropThresholdPct &&
      !alreadyDowngraded() &&
      getMotionLevel() === "full"
    ) {
      markDowngraded();
      setMotionLevel("reduced");
      breadcrumb(
        "perf.motion_auto_reduced",
        { where: label, ...result, dropRatio: Math.round(dropRatio * 100) / 100 },
        "warning",
      );
    } else {
      breadcrumb("perf.fps_sample", { where: label, ...result }, "info");
    }

    return result;
  };
}
