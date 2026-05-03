import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, QrCode, Copy, Check, Link2, Sparkles, Shield, PartyPopper
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

interface Props {
  onBack: () => void;
}

export function FamilyLinking({ onBack }: Props) {
  const { accountType, userId } = useApp();
  const isParent = accountType === "parent";

  // Parent generates code; Teen enters code
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Teen input
  const [inputCode, setInputCode] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");

  // Success state
  const [success, setSuccess] = useState(false);

  // Poll for acceptance (parent side)
  useEffect(() => {
    if (!isParent || !inviteCode) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("family_invite_codes")
        .select("status")
        .eq("code", inviteCode)
        .maybeSingle();
      if (data?.status === "accepted") {
        setSuccess(true);
        haptics.press();
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isParent, inviteCode]);

  const generateCode = async () => {
    haptics.tap();
    setGenBusy(true);
    try {
      // Ensure we have a valid session first
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        toast.error("Please log in again to generate a code");
        setGenBusy(false);
        return;
      }
      const { data, error } = await supabase.rpc("generate_family_invite_code");
      console.log("[FamilyLinking] generateCode result:", { data, error });
      if (error) throw error;
      if (!data) {
        toast.error("No code was generated. Please try again.");
        setGenBusy(false);
        return;
      }
      setInviteCode(data as string);
    } catch (e: unknown) {
      console.error("[FamilyLinking] generateCode error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to generate code");
    }
    setGenBusy(false);
  };

  const copyCode = async () => {
    if (!inviteCode) return;
    haptics.tap();
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Code copied!");
    } catch { toast.error("Couldn't copy"); }
  };

  const handleAcceptInvite = async () => {
    if (!inputCode.trim() || linkBusy) return;
    haptics.tap();
    setLinkBusy(true);
    setLinkError("");
    try {
      const { data, error } = await supabase.rpc("accept_family_invite", { _code: inputCode.trim() });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row && !row.ok) { setLinkError(row.message); setLinkBusy(false); return; }
      haptics.press();
      setSuccess(true);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Failed to link");
    }
    setLinkBusy(false);
  };

  // Success Screen
  if (success) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 fl-root">
        <div className="fl-success-ring">
          <PartyPopper className="w-10 h-10" style={{ color: "oklch(0.82 0.06 85)" }} />
        </div>
        <h2 className="text-xl font-bold fl-heading mt-6">Family Linked! 🎉</h2>
        <p className="text-sm fl-sub mt-2 text-center max-w-[280px]">
          {isParent
            ? "Your child's account is now connected. You can monitor activity and set controls."
            : "Your parent's account is now connected. They can help manage your wallet."}
        </p>
        <button onClick={() => { haptics.tap(); onBack(); }} className="fl-btn-primary mt-8 w-full max-w-[280px]">
          Go to Dashboard
        </button>
        <style>{flStyles}</style>
      </div>
    );
  }

  // Parent: Generate & show code/QR
  if (isParent) {
    return (
      <div className="flex-1 flex flex-col fl-root overflow-y-auto">
        <div className="flex items-center gap-3 px-5 pt-6 pb-4">
          <button onClick={() => { haptics.tap(); onBack(); }} className="fl-back-btn">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold fl-heading">Link Your Child</h1>
        </div>

        <div className="flex-1 flex flex-col items-center px-6 pt-4">
          {!inviteCode ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="fl-big-icon">
                <Link2 className="w-10 h-10" style={{ color: "oklch(0.82 0.06 85)" }} />
              </div>
              <h2 className="text-lg font-bold fl-heading mt-5">Generate Invite Code</h2>
              <p className="text-sm fl-sub mt-2 text-center max-w-[280px]">
                Create a unique code that your child can enter in their Teen Wallet app to link accounts.
              </p>
              <button onClick={generateCode} disabled={genBusy} className="fl-btn-primary mt-6 w-full max-w-[280px]">
                <QrCode className="w-4.5 h-4.5" />
                {genBusy ? "Generating…" : "Generate Code"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full">
              <p className="text-[11px] font-medium tracking-widest uppercase fl-label mb-4">
                <Sparkles className="w-3.5 h-3.5 inline mr-1" />Scan or Enter Code
              </p>

              {/* QR Code */}
              <div className="fl-qr-container">
                <QRCodeSVG
                  value={inviteCode}
                  size={180}
                  bgColor="transparent"
                  fgColor="oklch(0.85 0.05 85)"
                  level="M"
                />
              </div>

              {/* Code Display */}
              <div className="fl-code-display mt-5">
                <span className="fl-code-text">{inviteCode}</span>
              </div>

              <button onClick={copyCode} className="fl-copy-btn mt-3">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy Code"}
              </button>

              <div className="fl-info-card mt-6">
                <Shield className="w-4 h-4 flex-shrink-0" style={{ color: "oklch(0.65 0.03 85)" }} />
                <p className="text-[12px] fl-sub">Code expires in 24 hours. Ask your child to enter this code or scan the QR in their app.</p>
              </div>

              <div className="fl-waiting-pill mt-5">
                <span className="fl-waiting-dot" />
                <span className="text-[12px] fl-sub">Waiting for your child to accept…</span>
              </div>
            </div>
          )}
        </div>
        <style>{flStyles}</style>
      </div>
    );
  }

  // Teen: Enter code
  return (
    <div className="flex-1 flex flex-col fl-root overflow-y-auto">
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <button onClick={() => { haptics.tap(); onBack(); }} className="fl-back-btn">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold fl-heading">Link with Parent</h1>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 pt-8">
        <div className="fl-big-icon">
          <Shield className="w-10 h-10" style={{ color: "oklch(0.82 0.06 85)" }} />
        </div>
        <h2 className="text-lg font-bold fl-heading mt-5">Enter Invite Code</h2>
        <p className="text-sm fl-sub mt-2 text-center max-w-[280px]">
          Ask your parent to share their invite code or scan their QR code.
        </p>

        <input
          type="text"
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value.toUpperCase())}
          placeholder="Enter 8-character code"
          maxLength={8}
          className="fl-input mt-6 w-full max-w-[300px]"
          autoFocus
        />
        {linkError && <p className="text-xs mt-2" style={{ color: "oklch(0.65 0.15 25)" }}>{linkError}</p>}

        <button
          onClick={handleAcceptInvite}
          disabled={inputCode.length < 6 || linkBusy}
          className="fl-btn-primary mt-4 w-full max-w-[300px]"
        >
          {linkBusy ? "Linking…" : "Link Account"}
        </button>

        <div className="fl-info-card mt-8">
          <QrCode className="w-4 h-4 flex-shrink-0" style={{ color: "oklch(0.65 0.03 85)" }} />
          <p className="text-[12px] fl-sub">You can also scan your parent's QR code using your phone camera.</p>
        </div>
      </div>
      <style>{flStyles}</style>
    </div>
  );
}

const flStyles = `
  .fl-root { background: var(--background); }
  .fl-heading { color: var(--foreground); }
  .fl-sub { color: oklch(0.55 0.01 250); }
  .fl-label { color: oklch(0.82 0.06 85); }

  .fl-back-btn {
    width: 40px; height: 40px; border-radius: 14px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
    display: flex; align-items: center; justify-content: center;
    color: oklch(0.7 0.01 250); cursor: pointer;
  }

  .fl-big-icon {
    width: 80px; height: 80px; border-radius: 24px;
    background: oklch(0.82 0.06 85 / 0.1);
    border: 1.5px solid oklch(0.82 0.06 85 / 0.2);
    display: flex; align-items: center; justify-content: center;
  }

  .fl-qr-container {
    padding: 24px; border-radius: 22px;
    background: oklch(0.1 0.005 250);
    border: 1.5px solid oklch(0.82 0.06 85 / 0.2);
    display: flex; align-items: center; justify-content: center;
  }

  .fl-code-display {
    padding: 16px 24px; border-radius: 16px;
    background: oklch(0.1 0.005 250);
    border: 2px solid oklch(0.82 0.06 85 / 0.25);
  }
  .fl-code-text {
    font-size: 26px; font-weight: 800; letter-spacing: 0.2em;
    color: oklch(0.92 0.04 85); font-family: monospace;
  }

  .fl-copy-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 18px; border-radius: 10px;
    background: oklch(0.82 0.06 85 / 0.12);
    color: oklch(0.82 0.06 85);
    font-size: 13px; font-weight: 600;
    border: none; cursor: pointer;
  }

  .fl-info-card {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 14px 16px; border-radius: 14px;
    background: oklch(0.13 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
    width: 100%; max-width: 300px;
  }

  .fl-waiting-pill {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 18px; border-radius: 999px;
    background: oklch(0.15 0.005 250);
    border: 1px solid oklch(0.22 0.005 250);
  }
  .fl-waiting-dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: oklch(0.65 0.1 145);
    animation: fl-pulse 1.5s ease-in-out infinite;
  }
  @keyframes fl-pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  .fl-input {
    padding: 16px 18px; border-radius: 16px;
    background: oklch(0.1 0.005 250);
    border: 1.5px solid oklch(0.25 0.005 250);
    color: var(--foreground); font-size: 18px;
    text-align: center; letter-spacing: 0.2em; font-weight: 700;
  }
  .fl-input::placeholder { color: oklch(0.35 0.01 250); letter-spacing: 0.1em; font-weight: 400; font-size: 14px; }
  .fl-input:focus { outline: none; border-color: oklch(0.82 0.06 85 / 0.5); }

  .fl-btn-primary {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px; border-radius: 16px; font-weight: 600; font-size: 15px;
    background: linear-gradient(135deg, oklch(0.75 0.08 85), oklch(0.65 0.06 60));
    color: oklch(0.12 0.005 250); border: none; cursor: pointer;
  }
  .fl-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .fl-success-ring {
    width: 88px; height: 88px; border-radius: 999px;
    background: oklch(0.82 0.06 85 / 0.1);
    border: 2px solid oklch(0.82 0.06 85 / 0.3);
    display: flex; align-items: center; justify-content: center;
    animation: fl-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes fl-pop {
    0% { transform: scale(0.5); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .fl-waiting-dot { animation: none; opacity: 1; }
    .fl-success-ring { animation: none; }
  }
`;
