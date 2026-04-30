/**
 * Phone number hint — one-tap pre-fill of the user's phone number.
 *
 * Strategy (best-effort, graceful fallback):
 *  1. Android Chrome / Capacitor WebView: use the Contact Picker API
 *     (`navigator.contacts.select(['tel'])`). The user picks a contact (their own
 *     "Me" card on most Android setups) and we extract the number.
 *  2. Anywhere else (desktop, iOS WebView, unsupported browsers): return null —
 *     the caller hides the affordance.
 *
 * NOTE: A truly silent SIM-number read requires a native Capacitor plugin with
 * Java code calling Google Identity's Phone Number Hint API. We don't ship that
 * yet — this Contact Picker path works in the existing WebView with zero native
 * code and still gets the user to a single-tap pre-fill.
 */

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

/** True when we can offer a one-tap pre-fill on this device. */
export async function isPhoneHintAvailable(): Promise<boolean> {
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
 * Prompt the user to pick a contact and return the first 10-digit Indian number
 * found on it. Returns null if cancelled, unsupported, or no usable number.
 */
export async function requestPhoneHint(): Promise<string | null> {
  const cm = getContactsManager();
  if (!cm) return null;
  try {
    const result = await cm.select(["tel"], { multiple: false });
    if (!result || result.length === 0) return null;
    const tels = result[0].tel ?? [];
    for (const raw of tels) {
      const digits = raw.replace(/\D/g, "");
      // Strip Indian country code variants.
      const trimmed = digits.startsWith("91") && digits.length === 12
        ? digits.slice(2)
        : digits.startsWith("0") && digits.length === 11
          ? digits.slice(1)
          : digits;
      if (/^[6-9]\d{9}$/.test(trimmed)) return trimmed;
    }
    return null;
  } catch {
    // User dismissed or permission denied.
    return null;
  }
}
