/**
 * Lightweight, stable device fingerprint.
 *
 * We mix a handful of low-entropy signals (UA, screen, timezone, language,
 * platform, hardware concurrency, a tiny canvas hash) and SHA-256 the
 * concatenated string. The result is *not* a security boundary on its own —
 * it's a "is this likely the same physical device" signal. The actual
 * authentication boundary is the Google account match. We also cache the
 * computed hash in localStorage so the same device is recognized even if
 * a browser update changes one signal.
 */

const STORAGE_KEY = "tw.device.fp.v1";

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Extremely defensive fallback — should never run in modern browsers.
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return `fb_${(h >>> 0).toString(16)}`;
}

function canvasSignature(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 30;
    const ctx = c.getContext("2d");
    if (!ctx) return "no-ctx";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 60, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("teenwallet-fp-🔐", 2, 2);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("teenwallet-fp-🔐", 4, 4);
    return c.toDataURL().slice(-64);
  } catch {
    return "no-canvas";
  }
}

export async function getDeviceFingerprint(): Promise<string> {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached && cached.length >= 16) return cached;
  } catch {
    /* ignore */
  }

  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const scr = typeof screen !== "undefined" ? screen : ({} as Screen);
  const parts = [
    nav.userAgent || "",
    (nav as Navigator & { platform?: string }).platform || "",
    nav.language || "",
    String((nav as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? ""),
    `${scr.width || 0}x${scr.height || 0}x${scr.colorDepth || 0}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    canvasSignature(),
  ];
  const hash = await sha256Hex(parts.join("|"));
  try {
    localStorage.setItem(STORAGE_KEY, hash);
  } catch {
    /* ignore */
  }
  return hash;
}

export function clearDeviceFingerprint(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
