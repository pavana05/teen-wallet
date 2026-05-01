/**
 * New-device login gate. Shown BEFORE the phone OTP step when the entered
 * phone belongs to an account that has Google linked. The user must complete
 * Google OAuth with the *exact* matching account; on success we proceed to
 * phone OTP. On mismatch we hard-block and surface a support contact.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { AccountMismatchBlock } from "@/components/AccountMismatchBlock";
import {
  readCurrentGoogleIdentity,
  verifyGoogleForPhone,
} from "@/lib/googleLink";

type Status = "idle" | "verifying" | "ok" | "mismatch";

interface Props {
  phone10: string;
  emailHint: string | null;
  onBack: () => void;
  /** Called once Google identity is confirmed to match. */
  onVerified: () => void;
}

export function VerifyGoogleOnNewDevice({ phone10, emailHint, onBack, onVerified }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // After the OAuth round-trip we'll have a Google session. Verify match,
  // then sign back out (we don't want a Google-only session to persist —
  // the actual wallet session must be created via phone OTP).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ident = await readCurrentGoogleIdentity();
      if (!ident || cancelled) return;
      setStatus("verifying");
      try {
        const res = await verifyGoogleForPhone(phone10, ident.sub);
        if (cancelled) return;
        if (res.ok) {
          setStatus("ok");
          // Drop the Google-only session; phone OTP will create the real one.
          await supabase.auth.signOut();
          onVerified();
        } else {
          setStatus("mismatch");
          await supabase.auth.signOut();
        }
      } catch (e) {
        if (cancelled) return;
        setStatus("mismatch");
        setError(e instanceof Error ? e.message : "Verification failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phone10, onVerified]);

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      const r = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (r.error) throw r.error instanceof Error ? r.error : new Error(String(r.error));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't open Google";
      setError(msg);
      toast.error("Couldn't open Google", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  if (status === "mismatch") {
    return (
      <AccountMismatchBlock
        reason="google_mismatch"
        emailHint={emailHint}
        phone10={phone10}
        detail={error}
        onBack={onBack}
        onRetry={() => {
          setStatus("idle");
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 tw-slide-up">
      <div className="flex items-center justify-between mb-12">
        <button onClick={onBack} className="w-10 h-10 rounded-full glass flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm tracking-[0.3em] text-white/80 font-light">TEEN WALLET</span>
        <div className="w-10" />
      </div>

      <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-6">
        <ShieldCheck className="w-7 h-7 text-[hsl(var(--gold-warm))]" />
      </div>
      <h1 className="text-[30px] font-bold leading-tight">
        Verify it's you<br />on this new device
      </h1>
      <p className="text-white/60 mt-3 text-[14px] leading-relaxed max-w-[320px]">
        We've never seen this device before. To keep your wallet safe, sign in
        with the Google account linked to <span className="text-white/85">+91 {phone10}</span>
        {emailHint ? <> — <span className="text-white/85">{emailHint}</span></> : null}.
      </p>

      <div className="mt-auto pt-8 flex flex-col gap-3">
        {status === "verifying" ? (
          <p className="text-[12px] text-white/60 text-center" role="status">
            Verifying Google identity…
          </p>
        ) : null}
        <button
          onClick={handleContinue}
          disabled={busy || status === "verifying"}
          className="h-14 rounded-2xl bg-white text-black font-semibold flex items-center justify-center gap-3 disabled:opacity-60 active:scale-[0.99] transition-transform"
        >
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13.5 24 13.5c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.4 4.5 9.8 8.7 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2 14-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.5 2.4-5.2 0-9.6-3.3-11.2-8L6.2 32.4C9.7 38.7 16.3 43.5 24 43.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.5 5.5c-.5.4 7-5.1 7-15.2 0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
        <p className="text-[11px] text-white/40 text-center px-4">
          We sign you out of Google immediately after the check. Your wallet
          session is only created after you also enter the OTP on your phone.
        </p>
      </div>
    </div>
  );
}
