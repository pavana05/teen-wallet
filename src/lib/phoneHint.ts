/**
 * Phone number hint — one-tap pre-fill of the user's phone number.
 *
 * Strategy (best-effort, layered fallback):
 *  1. Native Android (Capacitor): call our custom `PhoneNumberHint` plugin which
 *     wraps Google Identity's `GetPhoneNumberHintIntentRequest`. The OS shows a
 *     system sheet with the SIM number(s) — one tap, no contact picker, no SMS.
 *  2. Web on Android Chrome: fall back to the Contact Picker API
 *     (`navigator.contacts.select(['tel'])`).
 *  3. Anywhere else: return null and the caller hides the affordance.
 *
 * The native plugin is registered by name only — if the Android app hasn't been
 * rebuilt with the plugin yet, the call rejects and we fall through to web.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface PhoneNumberHintPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  request(): Promise<{ phoneNumber: string }>;
}

const PhoneNumberHint = registerPlugin<PhoneNumberHintPlugin>("PhoneNumberHint");

interface ContactInfo {
  tel?: string[];
}
interface ContactsManager {
  select(props: string[], opts?: { multiple?: boolean }): Promise<ContactInfo[]>;
  getProperties(): Promise<string[]>;
}

function getContactsManager(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const cm = (navigator as unknown as { contacts?: ContactsManager }).contacts;
  return cm && typeof cm.select === "function" ? cm : null;
}

/** Normalize any raw phone string to a 10-digit Indian mobile, or null. */
function normalizeIndian(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const trimmed =
    digits.startsWith("91") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0") && digits.length === 11
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

/** True when we can offer a one-tap pre-fill on this device. */
export async function isPhoneHintAvailable(): Promise<boolean> {
  // Native Android path — preferred.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const r = await PhoneNumberHint.isAvailable();
      if (r?.available) return true;
    } catch {
      /* plugin missing — fall through to web detection */
    }
  }
  // Web Contact Picker fallback (Chrome Android).
  const cm = getContactsManager();
  if (!cm) return false;
  try {
    const props = await cm.getProperties();
    return props.includes("tel");
  } catch {
    return false;
  }
}

/**
 * Trigger the system phone-number hint sheet (native) or the contact picker
 * (web fallback). Returns a 10-digit Indian mobile, or null if cancelled /
 * unsupported / no usable number.
 */
export async function requestPhoneHint(): Promise<string | null> {
  // Native Android path.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const r = await PhoneNumberHint.request();
      const num = r?.phoneNumber ? normalizeIndian(r.phoneNumber) : null;
      if (num) return num;
    } catch {
      /* user cancelled or plugin missing — fall through */
    }
  }

  // Web Contact Picker fallback.
  const cm = getContactsManager();
  if (!cm) return null;
  try {
    const result = await cm.select(["tel"], { multiple: false });
    if (!result || result.length === 0) return null;
    for (const raw of result[0].tel ?? []) {
      const num = normalizeIndian(raw);
      if (num) return num;
    }
    return null;
  } catch {
    return null;
  }
}
