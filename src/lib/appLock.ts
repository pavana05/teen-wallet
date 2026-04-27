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

// ===== WebAuthn helpers (server-driven challenge + signature verification) =====
//
// Both registration and authentication go through the edge function:
//   1. Client requests options (server issues + stores a one-time challenge).
//   2. Browser invokes navigator.credentials.create/get with those options.
//   3. Client returns the full attestation/assertion to the server.
//   4. Server cryptographically verifies via @simplewebauthn/server.

function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
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

function rpAndOrigin(): { rp_id: string; origin: string } {
  return { rp_id: window.location.hostname, origin: window.location.origin };
}

// Drive a full WebAuthn registration flow with the server.
// Returns true if enrollment succeeded.
export async function enrollBiometric(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  const ctx = rpAndOrigin();
  const optsRes = await callAppLock<{ options: PublicKeyCredentialCreationOptionsJSON }>({
    action: "biometric_register_options",
    ...ctx,
  });
  if (optsRes.error || !optsRes.data) throw new Error(optsRes.error?.message ?? "Failed to start enrollment");
  const opts = optsRes.data.options;

  const cred = await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: b64urlToBuf(opts.challenge),
      user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
      excludeCredentials: opts.excludeCredentials?.map((c) => ({
        ...c, id: b64urlToBuf(c.id),
      })),
    } as PublicKeyCredentialCreationOptions,
  }) as PublicKeyCredential | null;
  if (!cred) return false;

  const att = cred.response as AuthenticatorAttestationResponse;
  const transports = typeof att.getTransports === "function" ? att.getTransports() : [];
  const attestation_response = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: bufToB64url(att.clientDataJSON),
      attestationObject: bufToB64url(att.attestationObject),
      transports,
    },
  };

  const verify = await callAppLock<{ ok: true }>({
    action: "biometric_register_verify",
    ...ctx,
    attestation_response,
  });
  if (verify.error) throw new Error(verify.error.message);
  return true;
}

// Drive a full WebAuthn assertion (unlock) flow with the server.
export async function verifyBiometricUnlock(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  const ctx = rpAndOrigin();
  const optsRes = await callAppLock<{ options: PublicKeyCredentialRequestOptionsJSON }>({
    action: "biometric_auth_options",
    ...ctx,
  });
  if (optsRes.error || !optsRes.data) throw new Error(optsRes.error?.message ?? "Failed to start verification");
  const opts = optsRes.data.options;

  const assertion = await navigator.credentials.get({
    publicKey: {
      ...opts,
      challenge: b64urlToBuf(opts.challenge),
      allowCredentials: opts.allowCredentials?.map((c) => ({
        ...c, id: b64urlToBuf(c.id),
      })),
    } as PublicKeyCredentialRequestOptions,
  }) as PublicKeyCredential | null;
  if (!assertion) return false;

  const a = assertion.response as AuthenticatorAssertionResponse;
  const assertion_response = {
    id: assertion.id,
    rawId: bufToB64url(assertion.rawId),
    type: assertion.type,
    clientExtensionResults: assertion.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: bufToB64url(a.clientDataJSON),
      authenticatorData: bufToB64url(a.authenticatorData),
      signature: bufToB64url(a.signature),
      userHandle: a.userHandle ? bufToB64url(a.userHandle) : null,
    },
  };

  const verify = await callAppLock<{ ok: true }>({
    action: "biometric_auth_verify",
    ...ctx,
    assertion_response,
  });
  if (verify.error) throw new Error(verify.error.message);
  return true;
}

// Lightweight types matching @simplewebauthn/server output shape (avoids extra deps).
type PublicKeyCredentialCreationOptionsJSON = {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: "public-key"; alg: number }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: Array<{ id: string; type: "public-key"; transports?: AuthenticatorTransport[] }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
};
type PublicKeyCredentialRequestOptionsJSON = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{ id: string; type: "public-key"; transports?: AuthenticatorTransport[] }>;
};
