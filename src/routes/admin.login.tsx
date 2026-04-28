import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { callAdminFn, writeAdminSession, AdminFnError, type AdminMe } from "@/admin/lib/adminAuth";
import { Shield, KeyRound, Loader2 } from "lucide-react";
import { CopyableErrorId } from "@/components/CopyableErrorId";

export const Route = createFileRoute("/admin/login")({
  component: AdminLogin,
});

type Stage = "email" | "set_password" | "enroll_totp" | "totp";

function AdminLogin() {
  const nav = useNavigate();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [errCid, setErrCid] = useState<string | null>(null);

  function captureErr(e: unknown, fallback: string) {
    if (e instanceof AdminFnError) {
      setErrCid(e.correlationId);
      return e.message || fallback;
    }
    setErrCid(null);
    return e instanceof Error ? e.message || fallback : fallback;
  }

  useEffect(() => {
    if (otpauthUrl) QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: "#0c0c0e", light: "#d4c5a0" } }).then(setQrSrc).catch(() => {});
  }, [otpauthUrl]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setErrCid(null); setBusy(true);
    try {
      const r = await callAdminFn<any>({ action: "login_password", email, password });
      if (r.stage === "set_password") setStage("set_password");
      else if (r.stage === "enroll_totp") {
        setChallengeToken(r.challengeToken); setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setStage("enroll_totp");
      } else if (r.stage === "totp") { setChallengeToken(r.challengeToken); setStage("totp"); }
    } catch (e) { setErr(captureErr(e, "Login failed")); }
    finally { setBusy(false); }
  }

  async function submitSetPassword(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setErrCid(null); setBusy(true);
    try {
      const r = await callAdminFn<any>({ action: "set_password", email, password });
      setChallengeToken(r.challengeToken); setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setStage("enroll_totp");
    } catch (e) { setErr(captureErr(e, "Could not set password")); }
    finally { setBusy(false); }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setErrCid(null); setBusy(true);
    try {
      const r = await callAdminFn<{ sessionToken: string; expiresAt: string; admin: AdminMe }>({
        action: "verify_totp", challengeToken, code,
      });
      writeAdminSession(r);
      // Force a full reload so AdminLayout's useAdminSession() re-mounts and
      // reads the freshly written session token from sessionStorage. Without
      // this, the already-mounted hook still has admin=null from the initial
      // (pre-login) verify() call and bounces us right back to /admin/login.
      window.location.assign("/admin");
    } catch (e) {
      // Friendly translation of known TOTP error codes — preserve correlation ID.
      const cid = e instanceof AdminFnError ? e.correlationId : null;
      const raw = (e instanceof Error ? e.message : "").toLowerCase();
      let friendly = e instanceof Error ? (e.message || "Invalid code") : "Invalid code";
      if (raw.includes("invalid_code")) friendly = "Invalid or expired code. Codes refresh every 30 seconds — please enter the current code from your authenticator app.";
      else if (raw.includes("challenge")) friendly = "Your login session expired. Please re-enter your password.";
      else if (raw.includes("locked")) friendly = "Account temporarily locked due to too many attempts. Try again later.";
      else if (raw.includes("failed to fetch")) friendly = "Couldn't reach the server. Check your connection and try again.";
      setErr(friendly);
      setErrCid(cid);
      setCode("");
      if (raw.includes("challenge")) setStage("email");
    }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="a-surface" style={{ width: "100%", maxWidth: 420, padding: 32 }}>
        <div className="flex items-center gap-2 mb-1">
          <Shield size={18} style={{ color: "var(--a-accent)" }} />
          <span className="a-mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: "var(--a-accent)" }}>TEEN WALLET</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Admin Console</h1>
        <p style={{ fontSize: 13, color: "var(--a-muted)", marginTop: 4 }}>Restricted access. All activity is logged.</p>

        {err && (
          <div style={{ marginTop: 16, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
            <div>{err}</div>
            {errCid && <div style={{ marginTop: 6 }}><CopyableErrorId id={errCid} /></div>}
          </div>
        )}

        {stage === "email" && (
          <form onSubmit={submitEmail} style={{ marginTop: 20, display: "grid", gap: 12 }}>
            <div><div className="a-label" style={{ marginBottom: 6 }}>Email</div>
              <input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
            <div><div className="a-label" style={{ marginBottom: 6 }}>Password</div>
              <input className="a-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <button className="a-btn" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Continue</button>
          </form>
        )}

        {stage === "set_password" && (
          <form onSubmit={submitSetPassword} style={{ marginTop: 20, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--a-muted)" }}>First time setup — set your password (12+ chars, upper/lower/number/special).</p>
            <input className="a-input" type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            <button className="a-btn" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Set password</button>
          </form>
        )}

        {stage === "enroll_totp" && (
          <form onSubmit={submitTotp} style={{ marginTop: 20, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--a-muted)" }}>Scan with Google Authenticator / Authy, then enter the 6-digit code.</p>
            {qrSrc && <img src={qrSrc} alt="TOTP QR" style={{ alignSelf: "center", borderRadius: 8 }} />}
            <div className="a-mono" style={{ fontSize: 11, textAlign: "center", color: "var(--a-muted)", wordBreak: "break-all" }}>Secret: {secret}</div>
            <input className="a-input a-mono" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            <button className="a-btn" disabled={busy || code.length !== 6}>{busy && <Loader2 size={14} className="animate-spin" />} Verify & sign in</button>
          </form>
        )}

        {stage === "totp" && (
          <form onSubmit={submitTotp} style={{ marginTop: 20, display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--a-muted)" }}>Enter the 6-digit code from your authenticator app.</p>
            <input className="a-input a-mono" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            <button className="a-btn" disabled={busy || code.length !== 6}>{busy && <Loader2 size={14} className="animate-spin" />} Verify & sign in</button>
            <ResetTotpButton
              onArmed={async () => {
                const pw = window.prompt("Lost your authenticator? Re-enter your password to reset 2FA and re-enroll:");
                if (!pw) return;
                setErr(""); setBusy(true);
                try {
                  const r = await callAdminFn<any>({ action: "totp_reset_login", email, password: pw });
                  setChallengeToken(r.challengeToken); setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setCode(""); setStage("enroll_totp");
                } catch (e) { setErr(captureErr(e, "Reset failed")); }
                finally { setBusy(false); }
              }}
            />
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Three-tap + 5-second long-press gated reset control.
 *
 * Tap 1 / Tap 2: counts down a "armed" tap with visible feedback. Window resets after 4s of inactivity.
 * Tap 3: must be a long-press held for ≥ 5 seconds. Releasing early cancels and restarts the sequence.
 * This guards the destructive 2FA reset flow against accidental or casual clicks.
 */
function ResetTotpButton({ onArmed }: { onArmed: () => void | Promise<void> }) {
  const REQUIRED_TAPS = 3;
  const HOLD_MS = 5000;
  const RESET_WINDOW_MS = 4000;

  const [taps, setTaps] = useState(0);
  const [holding, setHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0..1
  const holdStart = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const inactivityRef = useRef<number | null>(null);

  const clearInactivity = () => {
    if (inactivityRef.current) { window.clearTimeout(inactivityRef.current); inactivityRef.current = null; }
  };
  const armInactivity = () => {
    clearInactivity();
    inactivityRef.current = window.setTimeout(() => setTaps(0), RESET_WINDOW_MS);
  };

  const cancelHold = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    holdStart.current = null;
    setHolding(false);
    setHoldProgress(0);
  };

  useEffect(() => () => { cancelHold(); clearInactivity(); }, []);

  const startPress = () => {
    // Taps 1 & 2: short press counts as a tap.
    if (taps < REQUIRED_TAPS - 1) return;
    // Tap 3: must hold ≥ HOLD_MS.
    holdStart.current = performance.now();
    setHolding(true);
    const tick = () => {
      if (holdStart.current == null) return;
      const elapsed = performance.now() - holdStart.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setHoldProgress(p);
      if (p >= 1) {
        cancelHold();
        setTaps(0);
        clearInactivity();
        void onArmed();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const endPress = () => {
    if (taps < REQUIRED_TAPS - 1) {
      // Count a tap.
      setTaps((t) => t + 1);
      armInactivity();
      return;
    }
    // Released the long-press early — cancel and restart sequence for safety.
    if (holdProgress < 1) {
      cancelHold();
      setTaps(0);
      clearInactivity();
    }
  };

  const remainingTaps = Math.max(0, REQUIRED_TAPS - 1 - taps);
  const onFinalTap = taps >= REQUIRED_TAPS - 1;
  const label = onFinalTap
    ? (holding
        ? `Hold ${Math.ceil((HOLD_MS - holdProgress * HOLD_MS) / 1000)}s to confirm reset…`
        : "Press and hold for 5s to reset 2FA")
    : `Lost your authenticator? Tap ${remainingTaps} more ${remainingTaps === 1 ? "time" : "times"} to enable reset`;

  return (
    <button
      type="button"
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={() => { if (holding) { cancelHold(); setTaps(0); } }}
      onTouchStart={(e) => { e.preventDefault(); startPress(); }}
      onTouchEnd={(e) => { e.preventDefault(); endPress(); }}
      onTouchCancel={() => { if (holding) { cancelHold(); setTaps(0); } }}
      aria-label="Reset 2FA — requires three taps and a five second long press"
      style={{
        position: "relative",
        background: onFinalTap ? "rgba(239,68,68,0.08)" : "none",
        border: onFinalTap ? "1px solid rgba(239,68,68,0.25)" : "1px solid transparent",
        borderRadius: 6,
        color: onFinalTap ? "#fca5a5" : "var(--a-muted)",
        fontSize: 12,
        textDecoration: onFinalTap ? "none" : "underline",
        cursor: "pointer",
        padding: onFinalTap ? "8px 10px" : "4px 6px",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        transition: "background 180ms, border-color 180ms, color 180ms",
      }}
    >
      <span style={{ position: "relative", zIndex: 1 }}>{label}</span>
      {holding && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "left center",
            transform: `scaleX(${holdProgress})`,
            background: "linear-gradient(90deg, rgba(239,68,68,0.18), rgba(239,68,68,0.32))",
            transition: "transform 60ms linear",
            zIndex: 0,
          }}
        />
      )}
    </button>
  );
}
