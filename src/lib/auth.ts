import { supabase } from "@/integrations/supabase/client";
import { offlineCache } from "@/lib/offlineCache";
import { perfLog } from "@/lib/perfLog";
import type { Stage } from "./store";

/**
 * Phone-as-email auth shim.
 * Real Indian SMS OTP requires a Supabase SMS provider (MSG91/Twilio).
 * For dev we map +91XXXXXXXXXX -> {phone}@teenwallet.local with a deterministic password
 * derived from the phone. The 6-digit OTP is fixed at 123456 in dev.
 *
 * To switch to real SMS: replace sendOtp/verifyOtp with supabase.auth.signInWithOtp({ phone })
 * and supabase.auth.verifyOtp({ phone, token, type: 'sms' }).
 */

const DEV_OTP = "123456";
const passwordFor = (phone: string) => `tw!${phone}!${phone.slice(-4)}A`;
const emailFor = (phone: string) => `${phone.replace(/\D/g, "")}@teenwallet.local`;

export async function sendOtp(phone10: string): Promise<{ ok: true; devOtp: string }> {
  // No-op in dev — real impl would call signInWithOtp here.
  return { ok: true, devOtp: DEV_OTP };
}

export async function verifyOtp(phone10: string, otp: string) {
  if (otp !== DEV_OTP) throw new Error("Invalid OTP. Use 123456 in dev mode.");
  const fullPhone = "+91" + phone10;
  const email = emailFor(fullPhone);
  const password = passwordFor(fullPhone);

  // 1) Try sign in first — works for any returning user.
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.data.session) return signIn.data.session;

  const code = (signIn.error as { code?: string } | null)?.code;
  const msg = signIn.error?.message?.toLowerCase() ?? "";

  // 2) Account exists but credentials no longer match (shouldn't happen with deterministic pw)
  //    or email not confirmed — surface a clear error instead of looping signUp.
  if (code === "email_not_confirmed" || msg.includes("not confirmed")) {
    throw new Error("Account exists but is not verified. Please contact support or try again shortly.");
  }

  // 3) No account yet — create one. Auto-confirm is enabled, so sign-in will succeed immediately.
  if (code === "invalid_credentials" || msg.includes("invalid login")) {
    const signUp = await supabase.auth.signUp({
      email,
      password,
      options: { data: { phone: fullPhone } },
    });
    if (signUp.error) {
      const sCode = (signUp.error as { code?: string }).code;
      if (sCode === "over_email_send_rate_limit") {
        throw new Error("Too many attempts. Please wait a minute before trying again.");
      }
      throw signUp.error;
    }
    // Mark this device as a fresh signup so the post-OTP flow knows to show
    // the mandatory Google-link step. Cleared once the user completes it.
    try { localStorage.setItem("tw.signup.needsGoogleLink", "1"); } catch { /* ignore */ }
    // Auto-confirm: session may be returned directly from signUp.
    if (signUp.data.session) {
      if (signUp.data.user) {
        await supabase.from("profiles").update({ phone: fullPhone }).eq("id", signUp.data.user.id);
      }
      return signUp.data.session;
    }
    // Otherwise, retry sign-in.
    const retry = await supabase.auth.signInWithPassword({ email, password });
    if (retry.error) throw retry.error;
    if (retry.data.user) {
      await supabase.from("profiles").update({ phone: fullPhone }).eq("id", retry.data.user.id);
    }
    return retry.data.session;
  }

  // 4) Anything else — bubble up.
  throw signIn.error ?? new Error("Sign-in failed. Please try again.");
}

export async function fetchProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  perfLog.markStart("fetchProfile");
  const { data, error } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  const ms = perfLog.markEnd("fetchProfile");
  if (ms !== null) perfLog.trackQuery("profiles", ms);
  if (data) {
    offlineCache.set("profile", data);
    return data;
  }
  // Network error — try offline cache (typed to match Supabase row shape)
  if (error) {
    const cached = offlineCache.get<typeof data>("profile");
    if (cached) return cached;
  }
  return null;
}

export async function setStage(stage: Stage) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("profiles").update({ onboarding_stage: stage }).eq("id", u.user.id);
}

import type { TablesUpdate } from "@/integrations/supabase/types";
export async function updateProfileFields(fields: TablesUpdate<"profiles">) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("profiles").update(fields).eq("id", u.user.id);
}

export async function logout() {
  await supabase.auth.signOut();
}
