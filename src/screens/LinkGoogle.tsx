/**
 * Mandatory Google-link step shown after a *new* user verifies their phone
 * OTP. The user MUST link a Google account before proceeding to KYC; this
 * binds the wallet to a recoverable identity that can be re-checked when the
 * user signs in from a different device.
 *
 * Existing users (signed up before this feature) are grandfathered and never
 * see this screen — see Index in src/routes/index.tsx for the gating logic.
 */
import { useEffect, useState } from "react";
import { Sparkles, ShieldCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import {
  persistLinkedGoogleIdentity,
  readCurrentGoogleIdentity,
  registerCurrentDeviceTrusted,
} from "@/lib/googleLink";

interface Props {
  onLinked: () => void;
}

export function LinkGoogle({ onLinked }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After the OAuth round-trip Supabase will have appended a Google identity
  // to the current user. Detect it on mount and finalize.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ident = await readCurrentGoogleIdentity();
      if (!ident || cancelled) return;
      try {
        await persistLinkedGoogleIdentity(ident.sub, ident.email);
        await registerCurrentDeviceTrusted("Signup device");
        if (!cancelled) {
          toast.success("Google linked", { description: ident.email });
          onLinked();
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't save Google link");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLinked]);

  async function handleLink() {
    setBusy(true);
    setError(null);
    try {
      // linkIdentity attaches Google to the *current* signed-in (phone) user
      // rather than creating a new account. After redirect, the Google sub
      // appears in `auth.users.identities`.
      const { error: linkErr } = await supabase.auth.linkIdentity({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (linkErr) throw linkErr;
      // If linkIdentity returned without a redirect (rare), try the OAuth
      // helper as a fallback so the flow still completes.
      const r = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (r.error) throw r.error instanceof Error ? r.error : new Error(String(r.error));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed";
      setError(msg);
      toast.error("Couldn't open Google", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex items-center justify-between mb-12">
        <span className="text-sm tracking-[0.3em] text-white/80 font-light">TEEN WALLET</span>
        <span className="text-[10.5px] tracking-[0.18em] uppercase text-white/40">
          Step 2 of 3
        </span>
      </div>

      <div className="flex flex-col items-start">
        <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-6">
          <ShieldCheck className="w-7 h-7 text-[hsl(var(--gold-warm))]" />
        </div>
        <h1 className="text-[30px] font-bold leading-tight">
          Secure your<br />wallet with Google
        </h1>
        <p className="text-white/60 mt-3 text-[14px] leading-relaxed max-w-[320px]">
          Linking your Google account lets you safely sign in from a new phone
          later. We'll never post anything or read your data.
        </p>

        <ul className="mt-8 space-y-3 text-[13px] text-white/75">
          <li className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 mt-0.5 text-[hsl(var(--gold-warm))]" />
            <span>Recover access if you lose this phone</span>
          </li>
          <li className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 mt-0.5 text-[hsl(var(--gold-warm))]" />
            <span>Block strangers from signing in with just your number</span>
          </li>
          <li className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 mt-0.5 text-[hsl(var(--gold-warm))]" />
            <span>Used only to verify it's really you — nothing else</span>
          </li>
        </ul>
      </div>

      <div className="mt-auto pt-8 flex flex-col gap-3">
        {error ? (
          <p className="text-[12px] text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          onClick={handleLink}
          disabled={busy}
          className="h-14 rounded-2xl bg-white text-black font-semibold flex items-center justify-center gap-3 disabled:opacity-60 active:scale-[0.99] transition-transform"
        >
          {/* Inline Google "G" mark */}
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13.5 24 13.5c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.4 4.5 9.8 8.7 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2 14-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.5 2.4-5.2 0-9.6-3.3-11.2-8L6.2 32.4C9.7 38.7 16.3 43.5 24 43.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.5 5.5c-.5.4 7-5.1 7-15.2 0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          {busy ? "Opening Google…" : "Continue with Google"}
          <ArrowRight className="w-4 h-4 opacity-60" />
        </button>
        <p className="text-[11px] text-white/40 text-center px-4">
          Linking is required to keep your wallet safe. You can switch to a
          different Google account later from Profile → Security.
        </p>
      </div>
    </div>
  );
}
