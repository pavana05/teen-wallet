import { RefreshCw, Loader2, ShieldAlert, Clock } from "lucide-react";

interface Props {
  /** Seconds remaining in the current cooldown (0 when ready). */
  resendIn: number;
  /** Total ms of the *current* cooldown window (for ring fill progress). */
  cooldownTotalMs: number;
  /** True while the resend button must be blocked. */
  blocked: boolean;
  /** True while a network call (send / verify) is in flight. */
  busy: boolean;
  /** True when the user has exhausted the ladder — show hard-block UI. */
  lockedOut: boolean;
  /** True when the most recent error was a server-side rate-limit. */
  rateLimited: boolean;
  /** How many resends used so far in this attempt. */
  resendCount: number;
  /** Max resends before the hard lock kicks in. */
  maxResends: number;
  /** Triggered when the user taps the active "Resend now" CTA. */
  onResend: () => void;
}

/**
 * Premium circular-ring countdown that visualises the OTP resend cooldown.
 * Doubles as a *hard* client-side rate-limit guard: while `blocked` is true the
 * CTA is disabled, the icon swaps to a clock, and the ring fills as time passes.
 *
 * - Ladder progress is shown as a row of dashes under the pill so the user can
 *   see they're approaching the hard lock.
 * - When `lockedOut` is true the styling shifts to a destructive tone and the
 *   copy changes to make the block feel intentional, not glitchy.
 */
export function ResendCountdown({
  resendIn,
  cooldownTotalMs,
  blocked,
  busy,
  lockedOut,
  rateLimited,
  resendCount,
  maxResends,
  onResend,
}: Props) {
  const totalSec = Math.max(1, Math.round(cooldownTotalMs / 1000));
  // Progress 0 → 1 as the cooldown completes.
  const elapsed = Math.min(1, Math.max(0, (totalSec - resendIn) / totalSec));
  // SVG ring constants.
  const SIZE = 36;
  const STROKE = 3;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - elapsed);

  const mm = Math.floor(resendIn / 60);
  const ss = resendIn % 60;
  const timeLabel = mm > 0 ? `${mm}:${ss.toString().padStart(2, "0")}` : `${ss}s`;

  const tone = lockedOut ? "locked" : rateLimited ? "warn" : blocked ? "wait" : "ready";

  return (
    <div className={`otp-resend otp-resend-${tone}`}>
      <button
        type="button"
        onClick={onResend}
        disabled={blocked || busy}
        aria-disabled={blocked || busy}
        aria-live="polite"
        className="otp-resend-pill"
      >
        <span className="otp-resend-ring" aria-hidden="true">
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth={STROKE}
            />
            {blocked && (
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                style={{ transition: "stroke-dashoffset 950ms linear" }}
              />
            )}
          </svg>
          <span className="otp-resend-icon">
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : lockedOut ? (
              <ShieldAlert className="w-3.5 h-3.5" />
            ) : blocked ? (
              <Clock className="w-3.5 h-3.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </span>
        </span>

        <span className="otp-resend-text">
          <span className="otp-resend-headline">
            {busy
              ? "Sending…"
              : lockedOut
              ? "Too many resends"
              : blocked
              ? `Resend in ${timeLabel}`
              : "Resend OTP"}
          </span>
          <span className="otp-resend-sub">
            {lockedOut
              ? "Try again after the cooldown ends or edit your number."
              : blocked
              ? rateLimited
                ? "Server-side rate limit active."
                : "Hold on while we make sure your code went through."
              : resendCount === 0
              ? "Tap to get a fresh 6-digit code."
              : `${resendCount}/${maxResends} resends used.`}
          </span>
        </span>
      </button>

      {/* Ladder dots — visual hint of remaining resends in the current attempt. */}
      <ol className="otp-resend-ladder" aria-hidden="true">
        {Array.from({ length: maxResends }).map((_, i) => (
          <li
            key={i}
            className={`otp-resend-ladder-dot ${
              i < resendCount ? "is-used" : ""
            } ${i === resendCount && blocked ? "is-active" : ""}`}
          />
        ))}
      </ol>
    </div>
  );
}
