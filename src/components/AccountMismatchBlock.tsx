/**
 * Reusable hard-block screen shown when a user fails an identity check
 * (e.g. Google account doesn't match the phone, or Google identity is
 * already linked to a different wallet). Explains *why* the user is
 * blocked, surfaces a support contact CTA, and offers a retry path.
 *
 * Theme: premium dark — uses semantic tokens, no neon.
 */
import { ArrowLeft, Mail, ShieldAlert, RotateCcw } from "lucide-react";

export type MismatchReason = "google_mismatch" | "google_already_linked" | "generic";

interface Props {
  reason?: MismatchReason;
  /** Optional masked Google email hint to display ("a••••e@gmail.com"). */
  emailHint?: string | null;
  /** Optional phone (last 10 digits) shown in the explainer. */
  phone10?: string | null;
  /** Optional extra technical detail (correlation id, raw error). */
  detail?: string | null;
  /** Back arrow handler (e.g. return to phone entry). */
  onBack?: () => void;
  /** Retry CTA — re-opens the OAuth flow. */
  onRetry?: () => void;
  /** Support email (defaults to support@teenwallet.in). */
  supportEmail?: string;
}

const COPY: Record<MismatchReason, { title: string; body: (hint: string | null, phone: string | null) => string }> = {
  google_mismatch: {
    title: "That Google account doesn't match",
    body: (hint, phone) =>
      `For your safety, this wallet${phone ? ` (+91 ${phone})` : ""} can only be unlocked using the Google account it was originally linked to${hint ? ` (${hint})` : ""}. Please sign in with that exact account, or contact support if you've lost access.`,
  },
  google_already_linked: {
    title: "This Google account is already linked",
    body: () =>
      "The Google account you signed in with is already connected to a different TeenWallet. Each Google account can only secure one wallet. If this is a mistake, our support team can help you sort it out.",
  },
  generic: {
    title: "We couldn't verify it's you",
    body: () =>
      "Something didn't line up during verification. For your safety, we've stopped the sign-in. You can try again, or reach support if this keeps happening.",
  },
};

export function AccountMismatchBlock({
  reason = "google_mismatch",
  emailHint = null,
  phone10 = null,
  detail = null,
  onBack,
  onRetry,
  supportEmail = "support@teenwallet.in",
}: Props) {
  const copy = COPY[reason];
  const subject = encodeURIComponent(
    reason === "google_already_linked"
      ? "Google account already linked"
      : "Locked out — Google account mismatch",
  );
  const bodyPrefill = encodeURIComponent(
    [
      "Hi TeenWallet support,",
      "",
      `I was blocked while trying to sign in${phone10 ? ` to +91 ${phone10}` : ""}.`,
      `Reason: ${reason}.`,
      detail ? `Detail: ${detail}` : "",
      "",
      "Please help me regain access.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up bg-background text-foreground">
      <div className="flex items-center justify-between mb-12">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            className="w-10 h-10 rounded-full glass flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-10" />
        )}
        <span className="text-sm tracking-[0.3em] text-foreground/80 font-light">TEEN WALLET</span>
        <div className="w-10" />
      </div>

      <div
        className="w-14 h-14 rounded-2xl bg-destructive/15 border border-destructive/30 flex items-center justify-center mb-6"
        aria-hidden="true"
      >
        <ShieldAlert className="w-7 h-7 text-destructive" />
      </div>

      <h1 className="text-[26px] font-bold leading-tight">{copy.title}</h1>
      <p className="text-foreground/65 mt-3 text-[14px] leading-relaxed max-w-[320px]">
        {copy.body(emailHint, phone10)}
      </p>

      {detail ? (
        <p className="mt-3 text-[11px] font-mono text-foreground/40 break-all">
          ref: {detail}
        </p>
      ) : null}

      <div className="mt-auto pt-8 flex flex-col gap-3">
        <a
          href={`mailto:${supportEmail}?subject=${subject}&body=${bodyPrefill}`}
          className="h-14 rounded-2xl bg-foreground text-background font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
        >
          <Mail className="w-4 h-4" />
          Contact support
        </a>
        {onRetry ? (
          <button
            onClick={onRetry}
            className="h-12 rounded-2xl glass text-foreground/85 font-medium flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Try a different Google account
          </button>
        ) : null}
        {onBack ? (
          <button onClick={onBack} className="h-12 rounded-2xl text-foreground/55 font-medium">
            Use a different number
          </button>
        ) : null}
      </div>
    </div>
  );
}
