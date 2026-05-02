import { useState, useCallback, useEffect } from "react";
import {
  Users, MapPin, Camera, Bell, Mic,
  Check, ChevronRight, Loader2, AlertCircle, ShieldCheck,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

type PermKey = "contacts" | "location" | "camera" | "notifications" | "microphone";
type PermStatus = "idle" | "granted" | "denied" | "unsupported" | "loading" | "error";

interface PermDef {
  key: PermKey;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const PERMS: PermDef[] = [
  { key: "contacts",      title: "Contacts",       desc: "Send money to friends",         icon: Users },
  { key: "location",      title: "Location",       desc: "Nearby offers & safe transactions", icon: MapPin },
  { key: "camera",        title: "Camera",         desc: "Scan QR codes & KYC selfies",   icon: Camera },
  { key: "notifications", title: "Notifications",  desc: "Payment alerts & OTPs",         icon: Bell },
  { key: "microphone",    title: "Microphone",     desc: "Voice notes for support",       icon: Mic },
];

const isNative = () => Capacitor.isNativePlatform();

async function checkPermission(key: PermKey): Promise<PermStatus> {
  try {
    switch (key) {
      case "contacts": {
        if (!isNative()) return "unsupported";
        const { Contacts } = await import("@capacitor-community/contacts");
        const r = await Contacts.checkPermissions();
        return r.contacts === "granted" ? "granted" : "denied";
      }
      case "location": {
        if (isNative()) {
          const { Geolocation } = await import("@capacitor/geolocation");
          const r = await Geolocation.checkPermissions();
          return r.location === "granted" ? "granted" : "denied";
        }
        if (!("geolocation" in navigator)) return "unsupported";
        return "idle";
      }
      case "camera": {
        if (isNative()) {
          const { Camera: CapCamera } = await import("@capacitor/camera");
          const r = await CapCamera.checkPermissions();
          return r.camera === "granted" ? "granted" : "denied";
        }
        return "idle";
      }
      case "notifications": {
        if (isNative()) {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const r = await PushNotifications.checkPermissions();
          return r.receive === "granted" ? "granted" : "denied";
        }
        if (!("Notification" in window)) return "unsupported";
        return Notification.permission === "granted" ? "granted" : "denied";
      }
      case "microphone": {
        return "idle";
      }
    }
  } catch (e) {
    console.warn("[perm-check]", key, e);
    return "error";
  }
}

async function requestPermission(key: PermKey): Promise<PermStatus> {
  try {
    switch (key) {
      case "contacts": {
        if (!isNative()) return "unsupported";
        const { Contacts } = await import("@capacitor-community/contacts");
        const r = await Contacts.requestPermissions();
        return r.contacts === "granted" ? "granted" : "denied";
      }
      case "location": {
        if (isNative()) {
          const { Geolocation } = await import("@capacitor/geolocation");
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
          const { Camera: CapCamera } = await import("@capacitor/camera");
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
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const r = await PushNotifications.requestPermissions();
          if (r.receive === "granted") {
            try { await PushNotifications.register(); } catch { /* ignore */ }
            return "granted";
          }
          return "denied";
        }
        if (!("Notification" in window)) return "unsupported";
        const r = await Notification.requestPermission();
        return r === "granted" ? "granted" : "denied";
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
    console.warn("[perm-request]", key, e);
    return "error";
  }
}

export function PermissionsManager() {
  const [status, setStatus] = useState<Record<PermKey, PermStatus>>({
    contacts: "idle", location: "idle", camera: "idle", notifications: "idle", microphone: "idle",
  });

  // Check current permission status on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of PERMS) {
        const s = await checkPermission(p.key);
        if (!cancelled) setStatus((prev) => ({ ...prev, [p.key]: s }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ask = useCallback(async (key: PermKey) => {
    setStatus((s) => ({ ...s, [key]: "loading" }));
    const r = await requestPermission(key);
    setStatus((s) => ({ ...s, [key]: r }));
    if (r === "granted") {
      toast.success(`${key} permission granted`);
    } else if (r === "denied") {
      toast.message("Permission declined", {
        description: "You can enable it from your device settings.",
      });
    }
  }, []);

  const grantedCount = Object.values(status).filter((s) => s === "granted").length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-3 px-1">
        <ShieldCheck className="w-4 h-4 text-emerald-400" strokeWidth={2} />
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {grantedCount}/{PERMS.length} permissions granted
        </span>
      </div>
      {PERMS.map((p) => {
        const s = status[p.key];
        const granted = s === "granted";
        const denied = s === "denied";
        const unsupported = s === "unsupported";
        const loading = s === "loading";
        const errored = s === "error";
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => !granted && !loading && ask(p.key)}
            disabled={granted || loading || unsupported}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors bg-[var(--card)] hover:bg-[var(--accent)] disabled:opacity-60"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--muted)]">
              <p.icon className="w-4 h-4 text-[var(--foreground)]" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] text-[var(--foreground)] font-medium">{p.title}</p>
              <p className="text-[11px] text-[var(--muted-foreground)] leading-snug">{p.desc}</p>
            </div>
            <div className="shrink-0">
              {loading ? <Loader2 className="w-4 h-4 animate-spin text-[var(--muted-foreground)]" /> :
               granted ? <Check className="w-4 h-4 text-emerald-400" strokeWidth={2.5} /> :
               denied ? <AlertCircle className="w-3.5 h-3.5 text-amber-400" strokeWidth={2} /> :
               unsupported || errored ? <span className="text-[10px] text-[var(--muted-foreground)]">N/A</span> :
               <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)]" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
