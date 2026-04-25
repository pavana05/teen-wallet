import { supabase } from "@/integrations/supabase/client";
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
  if (otp !== DEV_OTP) throw new Error("Invalid OTP. In dev mode, use 123456.");
  const fullPhone = "+91" + phone10;
  const email = emailFor(fullPhone);
  const password = passwordFor(fullPhone);

  // Try sign in, fall back to sign up
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.data.session) return signIn.data.session;

  const signUp = await supabase.auth.signUp({
    email,
    password,
    options: { data: { phone: fullPhone } },
  });
  if (signUp.error) throw signUp.error;
  // Some setups require email confirm — try sign in again
  const retry = await supabase.auth.signInWithPassword({ email, password });
  if (retry.error) throw retry.error;
  // Persist phone on profile
  if (retry.data.user) {
    await supabase.from("profiles").update({ phone: fullPhone }).eq("id", retry.data.user.id);
  }
  return retry.data.session;
}

export async function fetchProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  return data;
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
