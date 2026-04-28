// Reusable boot skeletons. Each flow gets its own silhouette so users see
// the *right* loading shape — no flash of the wrong screen during boot.
//
// Both share the same premium dark-graphite tokens and shimmer treatment
// already defined in styles.css (.boot-skel, .boot-skel-card, .boot-skel-row).

interface SkelProps {
  /** Optional aria-live message for screen readers. */
  label?: string;
}

/**
 * Home skeleton — mirrors the Home layout (avatar/bell, balance card,
 * 4-up quick actions, section header, activity rows). Used by `/home` and
 * by the `/` boot router when it's likely heading to /home.
 */
export function HomeSkeleton({ label = "Loading your wallet…" }: SkelProps = {}) {
  return (
    <div className="flex-1 flex flex-col gap-4 px-5 pt-8 pb-6 boot-slide-in" data-skeleton="home">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="boot-skel" style={{ width: 40, height: 40, borderRadius: 999 }} />
          <div className="flex flex-col gap-2">
            <div className="boot-skel" style={{ width: 96, height: 10, borderRadius: 6 }} />
            <div className="boot-skel" style={{ width: 64, height: 8, borderRadius: 6 }} />
          </div>
        </div>
        <div className="boot-skel" style={{ width: 38, height: 38, borderRadius: 14 }} />
      </div>

      <div className="boot-skel boot-skel-card" style={{ height: 148, borderRadius: 22, marginTop: 6 }} />

      <div className="grid grid-cols-4 gap-3 mt-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="boot-skel" style={{ width: 60, height: 60, borderRadius: 16 }} />
            <div className="boot-skel" style={{ width: 44, height: 8, borderRadius: 6 }} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="boot-skel" style={{ width: 120, height: 12, borderRadius: 6 }} />
        <div className="boot-skel" style={{ width: 48, height: 10, borderRadius: 6 }} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="boot-skel boot-skel-row" />
        <div className="boot-skel boot-skel-row" />
        <div className="boot-skel boot-skel-row" />
      </div>

      <span className="sr-only" role="status" aria-live="polite">{label}</span>
    </div>
  );
}

/**
 * Onboarding skeleton — mirrors a single full-bleed onboarding panel:
 * a centered hero glyph, two title lines, three bullet hints, and a
 * primary CTA chip. Distinct silhouette so users can immediately tell the
 * onboarding flow is loading (not Home).
 */
export function OnboardingSkeleton({ label = "Getting things ready…" }: SkelProps = {}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-between px-7 pt-14 pb-10 boot-slide-in" data-skeleton="onboarding">
      <div className="flex flex-col items-center gap-5 w-full">
        {/* Hero glyph */}
        <div className="boot-skel" style={{ width: 132, height: 132, borderRadius: 36 }} />
        {/* Title block */}
        <div className="flex flex-col items-center gap-3 w-full mt-2">
          <div className="boot-skel" style={{ width: "70%", height: 18, borderRadius: 8 }} />
          <div className="boot-skel" style={{ width: "55%", height: 14, borderRadius: 7 }} />
        </div>
        {/* Bullet hints */}
        <div className="flex flex-col gap-3 w-full mt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="boot-skel" style={{ width: 28, height: 28, borderRadius: 10 }} />
              <div className="boot-skel" style={{ flex: 1, height: 10, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="w-full flex flex-col items-center gap-4">
        {/* Pagination dots */}
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="boot-skel" style={{ width: i === 0 ? 22 : 8, height: 8, borderRadius: 999 }} />
          ))}
        </div>
        {/* Primary CTA */}
        <div className="boot-skel" style={{ width: "100%", height: 52, borderRadius: 18 }} />
      </div>

      <span className="sr-only" role="status" aria-live="polite">{label}</span>
    </div>
  );
}
