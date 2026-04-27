# Home Hero Image — Generation & Export Spec

This note locks in the exact production settings used for the Home screen
hero (`src/assets/home-hero-scan.jpg`) so future regenerations stay
visually consistent with the reference composition.

## Source asset

| Field            | Value                                  |
| ---------------- | -------------------------------------- |
| Path             | `src/assets/home-hero-scan.jpg`        |
| Native size      | **764 × 498 px** (≈ **1.534 : 1**)      |
| Encoding         | JPEG, 8-bit sRGB, baseline, q ≈ 82     |
| Color profile    | sRGB IEC61966-2.1 (no embedded ICC)    |
| Target file size | ≤ 90 KB                                |

> The card always renders at `width: calc(100% - 40px)` with `height: auto`,
> so the **aspect ratio is the load-bearing constraint** — not the pixel
> size. Keep new exports at the same ratio (1.534 : 1, ±0.5%).

## Composition & safe margins

The hero is a button (the tap-to-scan target), so the focal artwork must
survive the press/scale animation and the overlay gradient mask without
losing meaning.

| Region                | Reserved space (in source px)        |
| --------------------- | ------------------------------------ |
| Outer safe margin     | 24 px on all sides                   |
| Top "title" safe area | top 96 px (gradient + headline)      |
| Bottom CTA safe area  | bottom 88 px (sub-label + chevron)   |
| Logo / focal subject  | centered in the middle 60% × 60% box |

Anything mission-critical (logo, scanner reticle, primary subject) **must
stay inside the centered 60 % × 60 % box** so it remains visible when the
card is scaled by `:active { transform: scale(.985) }` and clipped by the
1px gradient border (`.hp-scan-card::after`).

## Generation prompt template

When regenerating with an image model, use these settings:

- Prompt aspect ratio: **3:2** (closest supported to 1.534:1; crop final
  output to exactly 764×498).
- Style: cinematic dark-mode product hero, deep blacks (#000–#0a0a0a),
  subtle lime/green accent matching `--hp-accent`.
- Negative: no text, no logos other than TW, no watermarks, no people,
  no harsh white backgrounds.
- Export: JPEG, quality 82, progressive **off**, strip metadata.

## Export checklist (manual)

1. Render at ≥ 1528 × 996 (2× retina), then downscale to **764 × 498**.
2. Re-encode as `mozjpeg -quality 82 -progressive 0`.
3. Verify file size ≤ 90 KB.
4. Run the automated check: `bun run test:hero`
   (alias of `vitest run src/assets/__tests__/home-hero-scan.test.ts`).
5. Visually diff against the previous version in the Home preview route
   `/preview/home` at the three reference viewports below.

## Tap-to-scan overlay alignment (reference)

These are the runtime contract values the button overlay must hit. They
are enforced by `src/assets/__tests__/home-hero-scan.test.ts` and
referenced by `.hp-scan-card` in `src/styles.css`:

| Property            | Value                                |
| ------------------- | ------------------------------------ |
| Card horizontal pad | `20px` each side (`100% - 40px`)     |
| Card border radius  | `var(--hp-radius-lg)`                |
| Hit area            | full card surface, min **44×44 pt**  |
| Press scale         | `0.985` over `var(--hp-dur)` ease    |
| Hover lift          | `translateY(-2px)`                   |
| Border highlight    | 1 px gradient via `::after`          |

If the source aspect ratio changes, the overlay positioning will drift —
re-run the spec test before merging.

## Common viewport coverage (no-crop guarantee)

The card is `object-fit: unset` (natural `height: auto`), so we don't
crop on any device width. The automated test (next section) still
verifies that under the supported aspect-ratio envelope no part of the
60 % × 60 % focal box ever falls outside the visible card area.

Reference viewports tested:

| Device class | Viewport (CSS px) | Card width (CSS px) |
| ------------ | ----------------- | ------------------- |
| iPhone SE    | 375 × 667         | 335                 |
| iPhone 15    | 393 × 852         | 353                 |
| Pixel 8      | 412 × 915         | 372                 |
| iPad mini    | 768 × 1024        | 728 (capped 480)    |
| iPad Pro 11" | 834 × 1194        | 794 (capped 480)    |

The PhoneShell caps the layout at 480 px wide, so tablet classes are
clamped — but the test runs the math at the raw widths to catch
regressions if PhoneShell is ever removed.
