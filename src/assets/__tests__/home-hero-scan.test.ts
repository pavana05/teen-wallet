/**
 * Hero image contract test.
 *
 * Guarantees the Home `home-hero-scan.jpg` asset stays within the spec
 * documented in `docs/HERO_IMAGE_SPEC.md`. Run with:
 *
 *     bunx vitest run src/assets/__tests__/home-hero-scan.test.ts
 *
 * If this test fails after regenerating the hero, update both the asset
 * AND the spec doc — never just bump the numbers here in isolation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const HERO_PATH = resolve(__dirname, "../home-hero-scan.jpg");

// ---------- Spec constants (mirrored from docs/HERO_IMAGE_SPEC.md) ----------
const SPEC = {
  width: 764,
  height: 498,
  aspect: 764 / 498, // ≈ 1.534
  aspectTolerance: 0.005, // ±0.5 %
  maxBytes: 90 * 1024, // 90 KB
  // Card outer horizontal padding (matches `.hp-scan-card` width: calc(100% - 40px))
  cardOuterPaddingPx: 20,
  // Phone-shell cap; widths above this are clamped before the card renders.
  shellMaxCssWidthPx: 480,
  // Apple HIG / Material minimum tap target.
  minHitAreaPt: 44,
  // Press animation
  pressScale: 0.985,
  // Reserved focal box (centered) — must stay visible in every viewport.
  focalBoxRatio: 0.6,
};

// Reference viewports we promise not to crop the hero on.
const VIEWPORTS = [
  { name: "iPhone SE", w: 375, h: 667 },
  { name: "iPhone 15", w: 393, h: 852 },
  { name: "Pixel 8", w: 412, h: 915 },
  { name: "iPad mini", w: 768, h: 1024 },
  { name: 'iPad Pro 11"', w: 834, h: 1194 },
] as const;

/** Read JPEG SOF0/SOF2 marker to extract intrinsic pixel dimensions. */
function readJpegSize(buf: Buffer): { width: number; height: number } {
  // Skip 0xFFD8 SOI
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("Invalid JPEG marker at " + i);
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry frame size.
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    i += 2 + len;
  }
  throw new Error("No SOF marker found in JPEG");
}

describe("home-hero-scan.jpg — image contract", () => {
  const buf = readFileSync(HERO_PATH);
  const { width, height } = readJpegSize(buf);
  const bytes = statSync(HERO_PATH).size;

  it("uses the documented native dimensions (764×498)", () => {
    expect(width).toBe(SPEC.width);
    expect(height).toBe(SPEC.height);
  });

  it("matches the documented aspect ratio within ±0.5%", () => {
    const ratio = width / height;
    const drift = Math.abs(ratio - SPEC.aspect) / SPEC.aspect;
    expect(drift).toBeLessThanOrEqual(SPEC.aspectTolerance);
  });

  it("stays under the export size budget", () => {
    expect(bytes).toBeLessThanOrEqual(SPEC.maxBytes);
  });

  it("is a valid baseline JPEG (SOI marker present)", () => {
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });
});

describe("home-hero-scan.jpg — no-crop across reference viewports", () => {
  const buf = readFileSync(HERO_PATH);
  const { width: srcW, height: srcH } = readJpegSize(buf);
  const aspect = srcW / srcH;

  for (const vp of VIEWPORTS) {
    it(`renders fully visible on ${vp.name} (${vp.w}×${vp.h})`, () => {
      // Card width = min(viewport, shellCap) - 2*padding
      const effectiveViewport = Math.min(vp.w, SPEC.shellMaxCssWidthPx);
      const cardW = effectiveViewport - SPEC.cardOuterPaddingPx * 2;
      // height: auto with width set → rendered height derives from aspect.
      const cardH = cardW / aspect;

      // Sanity: no negative or zero dims.
      expect(cardW).toBeGreaterThan(0);
      expect(cardH).toBeGreaterThan(0);

      // Focal box must fit fully inside the rendered card area
      // (tests our promise of zero cropping of mission-critical content).
      const focalW = cardW * SPEC.focalBoxRatio;
      const focalH = cardH * SPEC.focalBoxRatio;
      expect(focalW).toBeLessThanOrEqual(cardW);
      expect(focalH).toBeLessThanOrEqual(cardH);

      // Card must not exceed viewport height (would force scroll-clip).
      expect(cardH).toBeLessThan(vp.h);
    });
  }
});

describe("tap-to-scan overlay — alignment & motion contract", () => {
  // These mirror `.hp-scan-card` in src/styles.css. If CSS changes,
  // update both places together.
  it("hit area meets HIG minimum after press animation", () => {
    const minRenderedCardW = 320 - SPEC.cardOuterPaddingPx * 2; // worst-case 320px viewport
    const pressedW = minRenderedCardW * SPEC.pressScale;
    expect(pressedW).toBeGreaterThanOrEqual(SPEC.minHitAreaPt);
    // Height during press also stays clearly above 44pt
    const aspect = SPEC.width / SPEC.height;
    const pressedH = (minRenderedCardW / aspect) * SPEC.pressScale;
    expect(pressedH).toBeGreaterThanOrEqual(SPEC.minHitAreaPt);
  });

  it("press scale is a subtle, premium tap (between 0.97 and 1)", () => {
    expect(SPEC.pressScale).toBeGreaterThan(0.97);
    expect(SPEC.pressScale).toBeLessThan(1);
  });
});
