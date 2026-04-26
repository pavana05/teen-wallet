import { useState, useCallback } from "react";
import {
  Users, MapPin, Camera, Bell, Mic,
  Check, ChevronRight, Loader2, ShieldCheck, AlertCircle,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Camera as CapCamera } from "@capacitor/camera";
import { PushNotifications } from "@capacitor/push-notifications";
import { Contacts } from "@capacitor-community/contacts";
import { toast } from "sonner";

type PermKey = "contacts" | "location" | "camera" | "notifications" | "microphone";
type PermStatus = "idle" | "granted" | "denied" | "unsupported" | "loading";

interface PermDef {
  key: PermKey;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  required?: boolean;
}

const PERMS: PermDef[] = [
  { key: "contacts",      title: "Contacts",       desc: "Send money to friends and split bills instantly.", icon: Users },
  { key: "location",      title: "Location",       desc: "Show nearby offers and verify safe transactions.", icon: MapPin },
  { key: "camera",        title: "Camera",         desc: "Scan UPI QR codes and capture KYC selfies.",       icon: Camera, required: true },
  { key: "notifications", title: "Notifications",  desc: "Real-time alerts for payments, OTPs and KYC.",     icon: Bell },
  { key: "microphone",    title: "Microphone",     desc: "Voice notes for support tickets (optional).",      icon: Mic },
];

const isNative = () => Capacitor.isNativePlatform();

async function requestPermission(key: PermKey): Promise<PermStatus> {
  try {
    switch (key) {
      case "contacts": {
        if (!isNative()) return "unsupported";
        const r = await Contacts.requestPermissions();
        return r.contacts === "granted" ? "granted" : "denied";
      }
      case "location": {
        if (isNative()) {
          const r = await Geolocation.requestPermissions({ permissions: ["location"] });
          return r.location === "granted" ? "granted" : "denied";
        }
        if (!("geolocation" in navigator)) return "unsupported";
        return await new Promise<PermStatus>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve("granted"),
            () => resolve("denied"),
            { timeout: 8000 },
          );
        });
      }
      case "camera": {
        if (isNative()) {
          const r = await CapCamera.requestPermissions({ permissions: ["camera"] });
          return r.camera === "granted" ? "granted" : "denied";
        }
        if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((t) => t.stop());
          return "granted";
        } catch { return "denied"; }
      }
      case "notifications": {
        if (isNative()) {
          const r = await PushNotifications.requestPermissions();
          if (r.receive === "granted") {
            try { await PushNotifications.register(); } catch { /* ignore */ }
            return "granted";
          }
          return "denied";
        }
        if (!("Notification" in window)) return "unsupported";
        const r = await Notification.requestPermission();
        return r === "granted" ? "granted" : r === "denied" ? "denied" : "denied";
      }
      case "microphone": {
        if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          return "granted";
        } catch { return "denied"; }
      }
    }
  } catch (e) {
    console.warn("[permissions]", key, e);
    return "denied";
  }
}

interface Props {
  onDone: () => void;
}

export function Permissions({ onDone }: Props) {
  const [status, setStatus] = useState<Record<PermKey, PermStatus>>({
    contacts: "idle", location: "idle", camera: "idle", notifications: "idle", microphone: "idle",
  });
  const [busyAll, setBusyAll] = useState(false);
  // Brief neon-lime exit animation when continuing — only shown if any permissions
  // are still missing (granted-everything → instant route, no transition delay).
  const [continuing, setContinuing] = useState(false);

  const ask = useCallback(async (key: PermKey) => {
    setStatus((s) => ({ ...s, [key]: "loading" }));
    const r = await requestPermission(key);
    setStatus((s) => ({ ...s, [key]: r }));
    if (r === "denied") {
      toast.message("Permission declined", {
        description: "You can enable it later from your device settings.",
      });
    }
  }, []);

  const askAll = async () => {
    setBusyAll(true);
    for (const p of PERMS) {
      // sequential to avoid OS blocking concurrent prompts
      // eslint-disable-next-line no-await-in-loop
      const r = await requestPermission(p.key);
      setStatus((s) => ({ ...s, [p.key]: r }));
    }
    setBusyAll(false);
  };

  const grantedCount = Object.values(status).filter((s) => s === "granted").length;
  const allGranted = grantedCount === PERMS.length;

  const handleContinue = () => {
    if (continuing) return;
    // If everything is already granted, route immediately — no animation needed.
    if (allGranted) { onDone(); return; }
    // Otherwise play the short neon-lime transition before advancing.
    setContinuing(true);
    setTimeout(() => onDone(), 480);
  };

  return (
    <div className={`perm-root flex-1 flex flex-col p-6 tw-slide-up ${continuing ? "perm-exit" : ""}`}>
      <div className="perm-aurora" aria-hidden="true" />

      {/* Neon-lime transition overlay shown only when continuing with missing perms */}
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
        <h1 className="text-[26px] font-bold leading-tight">Make Teen Wallet<br/>truly yours</h1>
        <p className="text-[#9aa0a6] text-[13px] mt-2 max-w-[300px] mx-auto leading-relaxed">
          Grant a few permissions so payments, scanning and alerts work seamlessly. You can change these anytime.
        </p>
      </div>

      <div className="relative z-10 mt-6 space-y-2.5">
        {PERMS.map((p) => {
          const s = status[p.key];
          const granted = s === "granted";
          const denied = s === "denied";
          const unsupported = s === "unsupported";
          const loading = s === "loading";
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => !granted && !loading && ask(p.key)}
              disabled={granted || loading || unsupported || continuing}
              className={`perm-row ${granted ? "perm-row-on" : ""} ${denied ? "perm-row-denied" : ""}`}
            >
              <div className="perm-row-icon">
                <p.icon className="w-[18px] h-[18px]" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[13.5px] text-white font-medium flex items-center gap-1.5">
                  {p.title}
                  {p.required && <span className="text-[9.5px] uppercase tracking-wider text-emerald-300/80">Recommended</span>}
                </p>
                <p className="text-[11.5px] text-white/55 mt-0.5 leading-snug">{p.desc}</p>
              </div>
              <div className="perm-row-state">
                {loading ? <Loader2 className="w-4 h-4 animate-spin text-white/70" /> :
                 granted ? <span className="perm-pill-on"><Check className="w-3 h-3" strokeWidth={3} />Granted</span> :
                 denied ? <span className="perm-pill-off"><AlertCircle className="w-3 h-3" strokeWidth={2.4} />Denied</span> :
                 unsupported ? <span className="perm-pill-na">N/A</span> :
                 <ChevronRight className="w-4 h-4 text-white/50" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="relative z-10 space-y-2.5 pt-6">
        <button
          onClick={askAll}
          disabled={busyAll || continuing}
          className="btn-primary w-full"
        >
          {busyAll ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Requesting…</>
          ) : allGranted ? (
            <>All set — Continue</>
          ) : (
            <>Allow all & continue</>
          )}
        </button>
        <button
          onClick={handleContinue}
          disabled={continuing}
          className="w-full text-center text-[12px] text-white/55 hover:text-white/80 py-2 tracking-wide disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          {continuing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin text-lime-300" /> <span className="text-lime-200">Continuing…</span></>
          ) : (
            grantedCount > 0 ? "Continue" : "Skip for now"
          )}
        </button>
      </div>
    </div>
  );
}
