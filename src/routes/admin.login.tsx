import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { callAdminFn, writeAdminSession, type AdminMe } from "@/admin/lib/adminAuth";
import { Shield, KeyRound, Loader2 } from "lucide-react";

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

  useEffect(() => {
    if (otpauthUrl) QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: "#0d0d0d", light: "#c8f135" } }).then(setQrSrc).catch(() => {});
  }, [otpauthUrl]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await callAdminFn<any>({ action: "login_password", email, password });
      if (r.stage === "set_password") setStage("set_password");
      else if (r.stage === "enroll_totp") {
        setChallengeToken(r.challengeToken); setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setStage("enroll_totp");
      } else if (r.stage === "totp") { setChallengeToken(r.challengeToken); setStage("totp"); }
    } catch (e: any) { setErr(e.message || "Login failed"); }
    finally { setBusy(false); }
  }

  async function submitSetPassword(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await callAdminFn<any>({ action: "set_password", email, password });
      setChallengeToken(r.challengeToken); setOtpauthUrl(r.otpauthUrl); setSecret(r.secret); setStage("enroll_totp");
    } catch (e: any) { setErr(e.message || "Could not set password"); }
    finally { setBusy(false); }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await callAdminFn<{ sessionToken: string; expiresAt: string; admin: AdminMe }>({
        action: "verify_totp", challengeToken, code,
      });
      writeAdminSession(r);
      nav({ to: "/admin" });
    } catch (e: any) { setErr(e.message || "Invalid code"); }
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

        {err && <div style={{ marginTop: 16, padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>{err}</div>}

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
          </form>
        )}
      </div>
    </div>
  );
}
