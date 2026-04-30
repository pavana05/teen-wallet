/**
 * Phone number hint — one-tap pre-fill of the user's phone number.
 *
 * Strategy (best-effort, layered fallback):
 *  1. Native Android (Capacitor): call our custom `PhoneNumberHint` plugin which
 *     wraps Google Identity's `GetPhoneNumberHintIntentRequest`. The OS shows a
 *     system sheet with the SIM number(s) — one tap, no contact picker, no SMS.
 *  2. Web on Android Chrome: fall back to the Contact Picker API
 *     (`navigator.contacts.select(['tel'])`).
 *  3. Anywhere else: return an `unsupported` outcome and the caller hides the affordance.
 *
 * Returns a tagged result so the UI can show specific recovery copy:
 *  - `ok`            → got a 10-digit Indian mobile.
 *  - `cancelled`     → user dismissed the system sheet/picker.
 *  - `permission`    → permission was denied (web Contact Picker only).
 *  - `no_match`      → user picked a contact but no usable Indian mobile on it.
 *  - `unsupported`   → device/browser exposes no API at all.
 *  - `error`         → unexpected failure; `detail` carries the message.
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

export type PhoneHintSource = "native" | "contacts";

export type PhoneHintResult =
  | { kind: "ok"; phone: string; source: PhoneHintSource }
  | { kind: "cancelled"; source: PhoneHintSource }
  | { kind: "permission"; source: PhoneHintSource }
  | { kind: "no_match"; source: PhoneHintSource; rawPicked: string[] }
  | { kind: "unsupported" }
  | { kind: "error"; source: PhoneHintSource; detail: string };

function getContactsManager(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const cm = (navigator as unknown as { contacts?: ContactsManager }).contacts;
  return cm && typeof cm.select === "function" ? cm : null;
}

/** Normalize any raw phone string to a 10-digit Indian mobile, or null. */
export function normalizeIndianMobile(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  // Strip common Indian prefixes: country code (91), trunk zero, or both.
  let trimmed = digits;
  if (trimmed.startsWith("91") && trimmed.length === 12) trimmed = trimmed.slice(2);
  else if (trimmed.startsWith("091") && trimmed.length === 13) trimmed = trimmed.slice(3);
  else if (trimmed.startsWith("0") && trimmed.length === 11) trimmed = trimmed.slice(1);
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

/**
 * Live input normalizer for the phone field. Strips +91/0/spaces as the user
 * types or pastes, clamps to 10 digits, and returns the cleaned digits.
 */
export function liveNormalizePhoneInput(raw: string): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * Validate a 10-digit Indian mobile in real time. Returns one of:
 *  - "empty"        — nothing typed yet.
 *  - "incomplete"   — fewer than 10 digits (no error shown, just disable CTA).
 *  - "bad_prefix"   — 10 digits but doesn't start with 6-9 (Indian rule).
 *  - "valid"        — ready to submit.
 */
export type PhoneFieldState = "empty" | "incomplete" | "bad_prefix" | "valid";

export function classifyPhoneField(digits: string): PhoneFieldState {
  if (!digits) return "empty";
  if (digits.length < 10) return "incomplete";
  if (!/^[6-9]/.test(digits)) return "bad_prefix";
  return /^[6-9]\d{9}$/.test(digits) ? "valid" : "bad_prefix";
}

/** True when we can offer a one-tap pre-fill on this device. */
export async function isPhoneHintAvailable(): Promise<boolean> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const r = await PhoneNumberHint.isAvailable();
      if (r?.available) return true;
    } catch {
      /* plugin missing — fall through */
    }
  }
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
 * (web fallback). Always returns a typed `PhoneHintResult` so the UI can
 * show precise next-step copy.
 */
export async function requestPhoneHint(): Promise<PhoneHintResult> {
  // Native Android path.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const r = await PhoneNumberHint.request();
      const num = r?.phoneNumber ? normalizeIndianMobile(r.phoneNumber) : null;
      if (num) return { kind: "ok", phone: num, source: "native" };
      // Plugin returned a number we couldn't normalize (foreign SIM, etc.)
      return { kind: "no_match", source: "native", rawPicked: r?.phoneNumber ? [r.phoneNumber] : [] };
    } catch (e) {
      const msg = (e as { message?: string; code?: string })?.message ?? "";
      const code = (e as { code?: string })?.code ?? "";
      // Our plugin rejects with code "cancelled" on user dismiss.
      if (code === "cancelled" || /cancel/i.test(msg)) return { kind: "cancelled", source: "native" };
      if (code === "unavailable") {
        // Plugin reachable but no eligible SIM number — fall through to contacts.
      } else if (code !== "error") {
        // Plugin missing entirely — fall through to web path.
      }
    }
  }

  // Web Contact Picker fallback.
  const cm = getContactsManager();
  if (!cm) return { kind: "unsupported" };
  let result: ContactInfo[];
  try {
    result = await cm.select(["tel"], { multiple: false });
  } catch (e) {
    const msg = (e as { name?: string; message?: string })?.message ?? "";
    const name = (e as { name?: string })?.name ?? "";
    if (name === "AbortError" || /cancel|abort/i.test(msg)) {
      return { kind: "cancelled", source: "contacts" };
    }
    if (name === "SecurityError" || name === "NotAllowedError" || /permission|denied/i.test(msg)) {
      return { kind: "permission", source: "contacts" };
    }
    return { kind: "error", source: "contacts", detail: msg || "picker_failed" };
  }
  if (!result || result.length === 0) return { kind: "cancelled", source: "contacts" };
  const tels = result[0].tel ?? [];
  for (const raw of tels) {
    const num = normalizeIndianMobile(raw);
    if (num) return { kind: "ok", phone: num, source: "contacts" };
  }
  return { kind: "no_match", source: "contacts", rawPicked: tels };
}
