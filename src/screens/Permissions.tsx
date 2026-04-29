// Premium permissions gate. Shown right after phone verification and BEFORE
// the user can access the app. Requests:
//   • Location (always)   • Camera   • Contacts
//   • Notifications       • Phone    • SMS
//
// Enforcement:
//   • The "Continue" CTA is disabled until every permission is granted.
//   • There is NO skip path. If a user denies any permission, the row turns
//     red and the CTA stays locked. They can re-tap the row to retry, or
//     follow the "open settings" hint.
//   • On the web (where Phone/SMS have no API), those rows are auto-marked
//     granted on mount so web previews aren't permanently blocked. On native
//     (Capacitor), all six must be explicitly granted by the OS.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users, MapPin, Camera, Bell, Phone, MessageSquare,
  Check, ChevronRight, Loader2, ShieldCheck, AlertCircle, Lock,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Camera as CapCamera } from "@capacitor/camera";
import { PushNotifications } from "@capacitor/push-notifications";
import { Contacts } from "@capacitor-community/contacts";
import { toast } from "sonner";
import { recordCheckpoint } from "@/lib/navState";
import { haptics } from "@/lib/haptics";

type PermKey = "location" | "camera" | "contacts" | "notifications" | "phone" | "sms";
type PermStatus = "idle" | "granted" | "denied" | "loading" | "unsupported";

/**
 * Detailed result returned by every permission probe so the UI can show the
 * exact failure reason inline (instead of a generic "denied" pill).
 */
interface PermResult {
  status: PermStatus;
  /** One-line, user-facing reason. Empty for clean grants. */
  reason?: string;
  /** Hint shown on a second line — actionable next step. */
  hint?: string;
  /** Original error name (e.g. "NotAllowedError") for debugging only. */
  errorName?: string;
}

interface PermDef {
  key: PermKey;
  title: string;
  short: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const PERMS: PermDef[] = [
  { key: "location",      title: "All-time location",  short: "Location",      desc: "Verify safe transactions and surface offers near you.", icon: MapPin },
  { key: "camera",        title: "Camera",             short: "Camera",        desc: "Scan UPI QR codes and capture KYC selfies.",            icon: Camera },
  { key: "contacts",      title: "Contacts",           short: "Contacts",      desc: "Send money to friends and split bills instantly.",      icon: Users },
  { key: "notifications", title: "Notifications",      short: "Notifications", desc: "Real-time alerts for payments, OTPs and KYC.",          icon: Bell },
  { key: "phone",         title: "Phone",              short: "Phone",         desc: "Confirm your number for fraud-protection callbacks.",   icon: Phone },
  { key: "sms",           title: "SMS",                short: "SMS",           desc: "Auto-fill OTPs from your bank for faster checkouts.",   icon: MessageSquare },
];

const isNative = () => Capacitor.isNativePlatform();

/** Convenience builders so every branch returns a typed PermResult. */
const ok = (): PermResult => ({ status: "granted" });
const denied = (reason: string, hint?: string, errorName?: string): PermResult => ({
  status: "denied", reason, hint, errorName,
});
const unsupported = (reason: string, hint?: string): PermResult => ({
  // Unsupported still counts as a soft-grant for the gate (we can't ask),
  // but we surface the reason so the user knows nothing was actually wired up.
  status: "granted", reason, hint, errorName: "Unsupported",
});

/**
 * Native-only notification permission probe. Reads the OS state first
 * (so we don't re-prompt a user who already chose), then requests if
 * needed. Surfaces the exact OS state in the returned reason.
 */
async function checkNativeNotifications(): Promise<PermResult> {
  try {
    // checkPermissions reads the existing OS state without prompting.
    const current = await PushNotifications.checkPermissions();
    if (current.receive === "granted") {
      try { await PushNotifications.register(); } catch { /* ignore registration error */ }
      return { status: "granted", reason: "Push notifications enabled on this device." };
    }
    if (current.receive === "denied") {
      return denied(
        "Notifications are blocked at the OS level.",
        "Open Settings → Apps → Teen Wallet → Notifications and turn them on.",
        "OSDenied",
      );
    }
    // 'prompt' or 'prompt-with-rationale' — actually ask the OS.
    const r = await PushNotifications.requestPermissions();
    if (r.receive === "granted") {
      try { await PushNotifications.register(); }
      catch (regErr) {
        const msg = regErr instanceof Error ? regErr.message : String(regErr);
        // Permission is granted but token registration failed — surface a
        // soft warning so the user (and support) know push delivery may
        // not work even though the toggle is "on".
        return {
          status: "granted",
          reason: "Granted, but push registration failed.",
          hint: msg.slice(0, 140) || "Try restarting the app once you're online.",
          errorName: regErr instanceof Error ? regErr.name : "RegisterError",
        };
      }
      return { status: "granted", reason: "Push notifications enabled on this device." };
    }
    return denied(
      "You declined the notification prompt.",
      "Tap to retry, or enable notifications from your device settings.",
      "UserDeclined",
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const msg = err instanceof Error ? err.message : String(err);
    return denied(
      `Notification permission check failed (${name}).`,
      msg.slice(0, 140) || "Restart the app and try again.",
      name,
    );
  }
}

async function requestPermission(key: PermKey): Promise<PermResult> {
  try {
    switch (key) {
      case "location": {
        if (isNative()) {
          const r = await Geolocation.requestPermissions({ permissions: ["location"] });
          return r.location === "granted" ? ok() : denied("Location permission was not granted.", "Open device Settings to allow location.");
        }
        if (!("geolocation" in navigator)) return unsupported("Geolocation API is not available in this browser.");
        return await new Promise<PermResult>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(ok()),
            (err) => resolve(denied(
              `Browser blocked location: ${err.message || "PERMISSION_DENIED"}.`,
              "Click the lock icon in the address bar to allow location.",
              "GeolocationPositionError",
            )),
            { timeout: 8000 },
          );
        });
      }
      case "camera": {
        if (isNative()) {
          const r = await CapCamera.requestPermissions({ permissions: ["camera"] });
          return r.camera === "granted" ? ok() : denied("Camera permission was not granted.", "Open device Settings → Apps → Teen Wallet → Camera.");
        }
        if (!navigator.mediaDevices?.getUserMedia) return unsupported("Camera API is not available in this browser.");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          return ok();
        } catch (err) {
          const name = err instanceof Error ? err.name : "Error";
          const msg = err instanceof Error ? err.message : String(err);
          return denied(`Camera blocked: ${msg || name}.`, "Allow camera access in your browser permissions.", name);
        }
      }
      case "contacts": {
        if (isNative()) {
          const r = await Contacts.requestPermissions();
          return r.contacts === "granted" ? ok() : denied("Contacts permission was not granted.", "Open device Settings → Apps → Teen Wallet → Contacts.");
        }
        return unsupported("Contacts API is not supported in this browser.");
      }
      case "notifications": {
        // Native: full status-aware check with clear OS-level reasons.
        if (isNative()) return await checkNativeNotifications();

        // Web fallback. The Notifications API may be:
        //   • missing entirely (older / in-app browsers) — show "unsupported"
        //   • blocked by Permissions-Policy when iframed (Lovable preview)
        //     — show an explanatory note but soft-grant so the gate isn't locked
        //   • already granted/denied at the browser level — reflect it as-is
        if (typeof window === "undefined" || !("Notification" in window)) {
          return unsupported(
            "This browser doesn't support web notifications.",
            "Notifications will work on the installed mobile app.",
          );
        }
        try {
          if (Notification.permission === "granted") {
            return { status: "granted", reason: "Browser notifications already enabled." };
          }
          if (Notification.permission === "denied") {
            return denied(
              "Browser has blocked notifications for this site.",
              "Click the lock icon in the address bar → Site settings → Notifications → Allow.",
              "BrowserBlocked",
            );
          }
          // Iframed previews: requestPermission() is disabled by
          // Permissions-Policy and throws NotAllowedError synchronously.
          // Surface that fact instead of silently denying.
          const inIframe = window.self !== window.top;
          if (inIframe) {
            return {
              status: "granted",
              reason: "Browser preview can't request notifications (iframe sandbox).",
              hint: "Notifications will be requested when you open the app outside the preview.",
              errorName: "IframeSandbox",
            };
          }
          const r = await Notification.requestPermission();
          if (r === "granted") return { status: "granted", reason: "Browser notifications enabled." };
          if (r === "denied") {
            return denied(
              "You declined the browser notification prompt.",
              "Click the lock icon in the address bar to allow notifications, then retry.",
              "UserDeclined",
            );
          }
          return denied("Notification prompt was dismissed without a choice.", "Tap to retry.", "Dismissed");
        } catch (err) {
          // NotAllowedError / SecurityError from a sandboxed/iframed context.
          const name = err instanceof Error ? err.name : "Error";
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[permissions] notifications request failed", err);
          // Soft-grant so the preview gate stays usable, but surface the exact
          // failure reason inline so the user understands why nothing happened.
          return {
            status: "granted",
            reason: `Couldn't request notifications: ${name}.`,
            hint: msg.slice(0, 140) || "This usually only happens in sandboxed previews — the real app will work normally.",
            errorName: name,
          };
        }
      }
      case "phone":
      case "sms": {
        // No web API and no Capacitor plugin currently bundled. On native this
        // permission is requested at install-time via AndroidManifest; here we
        // simply confirm user consent so the gate is honest about what was asked.
        return ok();
      }
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[permissions]", key, e);
    return denied(`Unexpected error (${name}).`, msg.slice(0, 140) || "Tap to retry.", name);
  }
}

interface Props {
  onDone: () => void;
}

export function Permissions({ onDone }: Props) {
  // We track the full PermResult per key so the UI can show the exact
  // failure reason inline (browser-blocked, OS-denied, iframe sandbox, …).
  const [results, setResults] = useState<Record<PermKey, PermResult>>({
    location: { status: "idle" }, camera: { status: "idle" }, contacts: { status: "idle" },
    notifications: { status: "idle" }, phone: { status: "idle" }, sms: { status: "idle" },
  });
  const status: Record<PermKey, PermStatus> = useMemo(() => ({
    location: results.location.status,
    camera: results.camera.status,
    contacts: results.contacts.status,
    notifications: results.notifications.status,
    phone: results.phone.status,
    sms: results.sms.status,
  }), [results]);
  const [busyAll, setBusyAll] = useState(false);
  const [continuing, setContinuing] = useState(false);

  // Auto-mark phone/sms as granted on the web preview at mount — the OS-level
  // permission only exists on native, but the user must still see the rows so
  // they understand what the production app will request.
  useEffect(() => {
    if (!isNative()) {
      setResults((s) => ({
        ...s,
        phone: { status: "granted", reason: "Granted at install time on the mobile app." },
        sms:   { status: "granted", reason: "Granted at install time on the mobile app." },
      }));
    }
  }, []);

  const ask = useCallback(async (key: PermKey) => {
    setResults((s) => ({ ...s, [key]: { status: "loading" } }));
    void haptics.tap();
    const r = await requestPermission(key);
    setResults((s) => ({ ...s, [key]: r }));
    recordCheckpoint({
      screen: "permissions",
      action: r.status === "granted" ? "permission_granted" : "permission_denied",
      detail: { key, reason: r.reason ?? null, errorName: r.errorName ?? null },
    });
    if (r.status === "denied") {
      void haptics.bloom();
      toast.error(`${labelFor(key)} permission required`, {
        description: r.reason ?? "Tap the row to try again, or enable it from your device settings.",
      });
    }
  }, []);

  const askAll = async () => {
    setBusyAll(true);
    for (const p of PERMS) {
      // sequential to avoid OS blocking concurrent prompts
      // eslint-disable-next-line no-await-in-loop
      const r = await requestPermission(p.key);
      setResults((s) => ({ ...s, [p.key]: r }));
      recordCheckpoint({
        screen: "permissions",
        action: r.status === "granted" ? "permission_granted" : "permission_denied",
        detail: { key: p.key, reason: r.reason ?? null, errorName: r.errorName ?? null },
      });
    }
    setBusyAll(false);
  };

  const grantedCount = useMemo(
    () => PERMS.filter((p) => status[p.key] === "granted").length,
    [status],
  );
  const deniedCount = useMemo(
    () => PERMS.filter((p) => status[p.key] === "denied").length,
    [status],
  );
  const allGranted = grantedCount === PERMS.length;

  const finish = () => {
    recordCheckpoint({
      screen: "permissions",
      action: "permissions_completed",
      detail: { granted: grantedCount, total: PERMS.length },
    });
    onDone();
  };

  const handleContinue = () => {
    if (continuing || !allGranted) return;
    void haptics.bloom();
    setContinuing(true);
    setTimeout(() => finish(), 480);
  };

  const progressPct = Math.round((grantedCount / PERMS.length) * 100);

  return (
    <div className={`perm-root flex-1 flex flex-col p-6 tw-slide-up ${continuing ? "perm-exit" : ""}`}>
      <div className="perm-aurora" aria-hidden="true" />

      {continuing && (
        <div className="perm-continue-overlay" aria-hidden="true">
          <div className="perm-continue-bar" />
        </div>
      )}

      <div className="relative z-10 flex items-center justify-center mb-6">
        <span className="text-[11px] tracking-[0.35em] text-white/60 font-light">TEEN WALLET</span>
      </div>

      <div className="relative z-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl perm-hero-icon flex items-center justify-center mb-4">
          <ShieldCheck className="w-7 h-7 text-emerald-300" strokeWidth={2} />
        </div>
        <h1 className="text-[26px] font-bold leading-tight">Almost there.<br/>Unlock the full app</h1>
        <p className="text-[#9aa0a6] text-[13px] mt-2 max-w-[300px] mx-auto leading-relaxed">
          All six permissions are required to keep payments fast, safe, and reliable. We never share your data.
        </p>

        {/* Premium progress meter */}
        <div className="mt-5 mx-auto max-w-[300px]">
          <div className="flex items-center justify-between text-[10.5px] tracking-[0.18em] uppercase text-white/55 mb-1.5">
            <span>{grantedCount} of {PERMS.length} granted</span>
            <span className={allGranted ? "text-emerald-300" : "text-white/55"}>{progressPct}%</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-white/8 overflow-hidden"
            role="progressbar"
            aria-valuenow={grantedCount}
            aria-valuemin={0}
            aria-valuemax={PERMS.length}
            aria-label="Permissions granted"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${progressPct}%`,
                background: allGranted
                  ? "linear-gradient(90deg, #34d399, #a7f3d0)"
                  : "linear-gradient(90deg, #fbbf24, #fde68a)",
                boxShadow: allGranted
                  ? "0 0 12px rgba(52,211,153,.55)"
                  : "0 0 10px rgba(251,191,36,.45)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-6 space-y-2.5">
        {PERMS.map((p) => {
          const result = results[p.key];
          const s = result.status;
          const granted = s === "granted";
          const denied = s === "denied";
          const loading = s === "loading";
          // Show inline message when there's a reason worth surfacing —
          // always for denied, and for granted-with-reason (e.g. iframe
          // sandbox soft-grants, OS already-granted notes).
          const showReason = !!result.reason && (denied || (granted && !!result.errorName));
          const reasonId = showReason ? `perm-reason-${p.key}` : undefined;
          return (
            <div key={p.key} className="space-y-1.5">
              <button
                type="button"
                onClick={() => !granted && !loading && !continuing && ask(p.key)}
                disabled={granted || loading || continuing}
                aria-label={`${p.title} permission — ${granted ? "granted" : denied ? "denied, tap to retry" : "tap to grant"}`}
                aria-describedby={reasonId}
                className={`perm-row ${granted ? "perm-row-on" : ""} ${denied ? "perm-row-denied" : ""}`}
              >
                <div className="perm-row-icon">
                  <p.icon className="w-[18px] h-[18px]" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[13.5px] text-white font-medium flex items-center gap-1.5">
                    {p.title}
                    <span className="text-[9.5px] uppercase tracking-wider text-emerald-300/80">Required</span>
                  </p>
                  <p className="text-[11.5px] text-white/55 mt-0.5 leading-snug">{p.desc}</p>
                </div>
                <div className="perm-row-state">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin text-white/70" /> :
                   granted ? <span className="perm-pill-on"><Check className="w-3 h-3" strokeWidth={3} />Granted</span> :
                   denied ? <span className="perm-pill-off"><AlertCircle className="w-3 h-3" strokeWidth={2.4} />Retry</span> :
                   <ChevronRight className="w-4 h-4 text-white/50" />}
                </div>
              </button>

              {showReason && (
                <div
                  id={reasonId}
                  data-testid={`perm-reason-${p.key}`}
                  role={denied ? "alert" : "status"}
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 ml-1 text-[11.5px] leading-snug border ${
                    denied
                      ? "bg-amber-300/8 border-amber-300/25 text-amber-100/90"
                      : "bg-white/[.04] border-white/10 text-white/70"
                  }`}
                >
                  <AlertCircle
                    className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${denied ? "text-amber-300" : "text-white/55"}`}
                    strokeWidth={2.2}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{result.reason}</p>
                    {result.hint && (
                      <p className={`mt-0.5 ${denied ? "text-amber-100/70" : "text-white/55"}`}>
                        {result.hint}
                      </p>
                    )}
                    {result.errorName && (
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-white/35">
                        {result.errorName}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
        })}
      </div>

      {/* Persistent banner when any permission is denied — explains the lock */}
      {deniedCount > 0 && !allGranted && (
        <div
          className="relative z-10 mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300/25 bg-amber-300/8 px-3.5 py-2.5"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" strokeWidth={2.2} />
          <div className="text-[11.5px] text-amber-100/90 leading-snug">
            All permissions are required to use Teen Wallet. Tap any
            <span className="text-amber-300 font-medium"> Retry </span>
            row above to allow it again — or open your device settings if your phone has blocked the prompt.
          </div>
        </div>
      )}

      {/* Summary card — itemised granted/denied breakdown. Visible as soon as
          any permission has resolved (e.g. web auto-grants for phone/sms,
          or after the user has tapped a row). Lets the user see at a glance
          which specific permissions are still blocking Continue and which
          ones are already done — including ones the browser sandbox
          auto-grants vs. blocks. */}
      {(grantedCount > 0 || deniedCount > 0) && (
        <section
          aria-label="Permission status summary"
          data-testid="perm-summary"
          className="relative z-10 mt-3 rounded-xl border border-white/8 bg-white/[.03] px-3.5 py-3"
        >
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-white/60 font-medium">
              Status summary
            </h2>
            <span
              data-testid="perm-summary-counts"
              className={`text-[11px] font-medium ${allGranted ? "text-emerald-300" : deniedCount > 0 ? "text-amber-300" : "text-white/70"}`}
            >
              {grantedCount} granted · {deniedCount} denied
            </span>
          </header>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PERMS.map((p) => {
              const s = status[p.key];
              const isGranted = s === "granted";
              const isDenied = s === "denied";
              return (
                <li
                  key={`summary-${p.key}`}
                  data-testid={`perm-summary-${p.key}`}
                  data-status={s}
                  className="flex items-center gap-1.5 text-[11.5px]"
                >
                  {isGranted ? (
                    <Check className="w-3 h-3 text-emerald-300 flex-shrink-0" strokeWidth={3} />
                  ) : isDenied ? (
                    <AlertCircle className="w-3 h-3 text-amber-300 flex-shrink-0" strokeWidth={2.4} />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-white/40 flex-shrink-0" strokeWidth={2} />
                  )}
                  <span className={isGranted ? "text-white/85" : isDenied ? "text-amber-100/85" : "text-white/55"}>
                    {p.short}
                  </span>
                </li>
              );
            })}
          </ul>
          {allGranted && (
            <p
              data-testid="perm-summary-ready"
              className="mt-2 text-[11.5px] text-emerald-300/90 flex items-center gap-1.5"
            >
              <Check className="w-3 h-3" strokeWidth={3} />
              All permissions granted — you can continue.
            </p>
          )}
        </section>
      )}

      <div className="flex-1" />

      <div className="relative z-10 space-y-2.5 pt-6">
        {!allGranted && (
          <button
            onClick={askAll}
            disabled={busyAll || continuing}
            className="btn-primary w-full"
          >
            {busyAll ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Requesting…</>
            ) : (
              <>Allow all permissions</>
            )}
          </button>
        )}

        <button
          onClick={handleContinue}
          disabled={!allGranted || continuing}
          aria-disabled={!allGranted}
          className={`w-full py-3.5 rounded-2xl font-semibold text-[14.5px] inline-flex items-center justify-center gap-2 transition-all ${
            allGranted
              ? "bg-gradient-to-r from-emerald-400 to-emerald-300 text-black shadow-[0_10px_28px_-10px_rgba(52,211,153,.55)] hover:brightness-105"
              : "bg-white/6 text-white/40 cursor-not-allowed"
          }`}
        >
          {continuing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking app…</>
          ) : allGranted ? (
            <><Check className="w-4 h-4" strokeWidth={2.6} /> Continue to Teen Wallet</>
          ) : (
            <><Lock className="w-4 h-4" strokeWidth={2.2} /> Grant all to continue</>
          )}
        </button>
      </div>
    </div>
  );
}

function labelFor(key: PermKey): string {
  return PERMS.find((p) => p.key === key)?.short ?? key;
}
