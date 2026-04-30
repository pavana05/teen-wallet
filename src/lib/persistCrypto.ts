// Lightweight AES-GCM helper for obfuscating sensitive values stored in
// localStorage (e.g. last decoded UPI QR payload). The key is generated
// per-device and stored alongside the ciphertext — this is NOT a defence
// against an attacker with full device access, but it does prevent casual
// inspection of plaintext UPI IDs / notes / amounts in a storage dump,
// shared device, or browser-extension scrape.
//
// Falls back to plaintext JSON when SubtleCrypto isn't available (very old
// browsers / SSR), so calls never throw.

const KEY_STORAGE = "tw-persist-key-v1";

function hasSubtle(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.crypto !== "undefined" &&
    typeof window.crypto.subtle !== "undefined"
  );
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

async function getKey(): Promise<CryptoKey | null> {
  if (!hasSubtle()) return null;
  try {
    let raw = window.localStorage.getItem(KEY_STORAGE);
    if (!raw) {
      const bytes = window.crypto.getRandomValues(new Uint8Array(32));
      raw = bufToB64(bytes.buffer);
      window.localStorage.setItem(KEY_STORAGE, raw);
    }
    return await window.crypto.subtle.importKey(
      "raw",
      b64ToBuf(raw),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

/** Encrypt an arbitrary JSON-serialisable value. Returns a string safe to store. */
export async function encryptJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  const key = await getKey();
  if (!key || !hasSubtle()) return "p:" + json; // plaintext fallback
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(json),
    );
    return "e:" + bufToB64(iv.buffer) + "." + bufToB64(ct);
  } catch {
    return "p:" + json;
  }
}

/** Decrypt a value produced by encryptJson. Returns null on any error. */
export async function decryptJson<T = unknown>(raw: string | null): Promise<T | null> {
  if (!raw) return null;
  try {
    if (raw.startsWith("p:")) return JSON.parse(raw.slice(2)) as T;
    if (raw.startsWith("e:")) {
      const [ivB64, ctB64] = raw.slice(2).split(".");
      if (!ivB64 || !ctB64) return null;
      const key = await getKey();
      if (!key || !hasSubtle()) return null;
      const pt = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(ivB64)) },
        key,
        b64ToBuf(ctB64),
      );
      return JSON.parse(new TextDecoder().decode(pt)) as T;
    }
    // Legacy plaintext (older builds wrote JSON directly).
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
