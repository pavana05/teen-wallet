/**
 * Client helpers for the Google ↔ phone account binding flow.
 *
 * Three high-level operations:
 *  1. linkGoogleToCurrentUser — called on the signup screen after the user
 *     completes the Google OAuth flow. Persists google_sub/email onto the
 *     profile and registers this device as trusted.
 *  2. requireGoogleOnNewDevice — called BEFORE sending phone OTP. Looks up
 *     the phone in the public index and tells the UI whether to gate the
 *     login behind Google verification.
 *  3. verifyGoogleForPhone — called after the user completes Google OAuth
 *     on a new-device login. Confirms the Google identity matches the
 *     phone's stored Google sub. On match, the phone OTP step proceeds.
 */

import { supabase } from "@/integrations/supabase/client";
import { getDeviceFingerprint } from "./deviceFingerprint";

export interface LoginRequirements {
  requires_google: boolean;
  google_email_hint: string | null;
  account_exists: boolean;
}

/** Resolve whether the phone needs Google verification before OTP. */
export async function getLoginRequirements(phone10: string): Promise<LoginRequirements> {
  const { data, error } = await supabase.rpc("get_login_requirements", { _phone: phone10 });
  if (error) {
    // Fail-open ONLY for unknown phones (treat as a new signup). For any other
    // error we fail-closed and assume Google is required to be safe.
    if (error.code === "PGRST116") {
      return { requires_google: false, google_email_hint: null, account_exists: false };
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { requires_google: false, google_email_hint: null, account_exists: false };
  return {
    requires_google: !!row.requires_google,
    google_email_hint: (row.google_email_hint as string | null) ?? null,
    account_exists: !!row.account_exists,
  };
}

/** Whether the current authenticated session is on a known/trusted device. */
export async function isCurrentDeviceTrusted(): Promise<boolean> {
  const fp = await getDeviceFingerprint();
  const { data, error } = await supabase.rpc("is_trusted_device", { _fingerprint_hash: fp });
  if (error) return false;
  return !!data;
}

/** Mark the current device as trusted for the current authenticated user. */
export async function registerCurrentDeviceTrusted(label?: string): Promise<void> {
  const fp = await getDeviceFingerprint();
  const { error } = await supabase.rpc("register_trusted_device", {
    _fingerprint_hash: fp,
    _label: label ?? null,
  });
  if (error) throw error;
}

/**
 * After the signed-in user has completed Google OAuth identity-linking, write
 * the resulting Google sub/email onto the profile and onto the phone index.
 */
export async function persistLinkedGoogleIdentity(googleSub: string, googleEmail: string): Promise<void> {
  const { error } = await supabase.rpc("link_google_to_phone", {
    _google_sub: googleSub,
    _google_email: googleEmail,
  });
  if (error) throw error;
}

/**
 * Verify that a Google sub matches what's stored for the given phone.
 * Returns { ok, reason } where reason is "match" / "mismatch" / "no_link_required".
 */
export async function verifyGoogleForPhone(phone10: string, googleSub: string): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("verify_google_for_phone", {
    _phone: phone10,
    _google_sub: googleSub,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: !!row?.ok, reason: (row?.reason as string) ?? "unknown" };
}

/**
 * Read Google identity (sub + email) from the *current* signed-in user's
 * Supabase identities. Returns null if Google isn't linked.
 */
export async function readCurrentGoogleIdentity(): Promise<{ sub: string; email: string } | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const identities = (user.identities ?? []) as Array<{
    provider: string;
    identity_data?: Record<string, unknown> | null;
  }>;
  const g = identities.find((i) => i.provider === "google");
  if (!g) return null;
  const sub = (g.identity_data?.sub as string | undefined) ?? (g.identity_data?.provider_id as string | undefined);
  const email = (g.identity_data?.email as string | undefined) ?? (user.email ?? "");
  if (!sub) return null;
  return { sub, email: email || "" };
}
