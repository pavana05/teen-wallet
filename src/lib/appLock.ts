// App Lock state machine + visibility/idle listeners.
//
// Triggers that lock the session:
//   1. Cold start (always — store never persists "unlocked")
//   2. Tab/window hidden longer than the user's auto_lock_seconds (default 30s)
//   3. Manual lock from settings
//   4. (Optional) After every successful payment when lock_after_payment is on
//
// The "unlocked" flag lives in sessionStorage so it dies with the tab.
import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export type AppLockStatus = {
  enabled: boolean;
  has_pin: boolean;
  pin_length: number | null;
  biometric_enrolled: boolean;
  biometric_credential_id: string | null;
  auto_lock_seconds: number; // 0=immediate, -1=never, otherwise seconds
  lock_after_payment: boolean;
  setup_prompt_dismissed: boolean;
  locked_until: string | null;
};

type LockState = {
  ready: boolean;          // status loaded?
  status: AppLockStatus | null;
  locked: boolean;         // overlay should show?
  lastHiddenAt: number | null;
  setStatus: (s: AppLockStatus | null) => void;
  refresh: () => Promise<void>;
  markUnlocked: () => void;
  lockNow: () => void;
};

const SESSION_KEY = "tw_app_unlocked";

function readUnlockedFromSession(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}
function writeUnlocked(v: boolean) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (v) sessionStorage.setItem(SESSION_KEY, "1");
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export const useAppLock = create<LockState>((set, get) => ({
  ready: false,
  status: null,
  locked: false,
  lastHiddenAt: null,
  setStatus: (s) => {
    // Determine initial locked state: locked if enabled & not already unlocked this session.
    const wasUnlocked = readUnlockedFromSession();
    const locked = !!s?.enabled && !wasUnlocked;
    set({ status: s, ready: true, locked });
  },
  refresh: async () => {
    const s = await fetchStatus();
    get().setStatus(s);
  },
  markUnlocked: () => {
    writeUnlocked(true);
    set({ locked: false, lastHiddenAt: null });
  },
  lockNow: () => {
    writeUnlocked(false);
    if (get().status?.enabled) set({ locked: true });
  },
}));

export async function fetchStatus(): Promise<AppLockStatus | null> {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) return null;
  const { data, error } = await supabase.functions.invoke("app-lock", {
    headers: { Authorization: `Bearer ${accessToken}` },
    body: { action: "get_status" },
  });
  if (error) return null;
  return data as AppLockStatus;
}

export async function callAppLock<T = unknown>(
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string; status?: number; payload?: unknown } | null }> {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) return { data: null, error: { message: "Sign in required" } };
  const { data, error } = await supabase.functions.invoke("app-lock", {
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (error) {
    // supabase-js stuffs the response into error.context; try to surface server message.
    let msg = error.message;
    let payload: unknown = undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        payload = await ctx.json();
        if (payload && typeof payload === "object" && "error" in payload) {
          msg = String((payload as { error: unknown }).error);
        }
      }
    } catch { /* ignore */ }
    return { data: null, error: { message: msg, payload } };
  }
  return { data: data as T, error: null };
}

// One-time install: hooks into visibility change, focus, and auth changes.
let installed = false;
export function installAppLockListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // On any auth change, re-read status.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      writeUnlocked(false);
      useAppLock.setState({ status: null, ready: false, locked: false });
      return;
    }
    void useAppLock.getState().refresh();
  });

  // Initial fetch (for already signed-in users on cold start)
  void useAppLock.getState().refresh();

  // Track when the tab becomes hidden so we can lock after threshold on return.
  const onVisibility = () => {
    const st = useAppLock.getState();
    if (!st.status?.enabled) return;
    if (document.visibilityState === "hidden") {
      useAppLock.setState({ lastHiddenAt: Date.now() });
    } else if (document.visibilityState === "visible") {
      const hiddenAt = st.lastHiddenAt;
      const auto = st.status.auto_lock_seconds;
      if (auto === -1) {
        useAppLock.setState({ lastHiddenAt: null });
        return; // never auto-lock on background
      }
      if (hiddenAt == null) return;
      const elapsed = (Date.now() - hiddenAt) / 1000;
      if (elapsed >= auto) {
        st.lockNow();
      } else {
        useAppLock.setState({ lastHiddenAt: null });
      }
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
}

// ===== Optional WebAuthn helpers (used by setup + unlock) =====

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(s: string): ArrayBuffer {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function isBiometricSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator?.credentials?.create === "function";
}

export async function createBiometricCredential(userId: string, userName: string): Promise<{ credentialId: string; publicKey: string } | null> {
  if (!isBiometricSupported()) return null;
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Teen Wallet", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName || userId,
        displayName: userName || "Teen Wallet User",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  }) as PublicKeyCredential | null;
  if (!cred) return null;
  const credentialId = bufToB64url(cred.rawId);
  const response = cred.response as AuthenticatorAttestationResponse;
  const publicKeyBuf = response.getPublicKey?.();
  const publicKey = publicKeyBuf ? bufToB64url(publicKeyBuf) : "";
  return { credentialId, publicKey };
}

export async function getBiometricAssertion(credentialId: string): Promise<string | null> {
  if (!isBiometricSupported()) return null;
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [{ type: "public-key", id: b64urlToBuf(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!assertion) return null;
  return bufToB64url(assertion.rawId);
}
