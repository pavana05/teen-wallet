/**
 * Referral program client helpers.
 *
 * Talks to two RPCs added by the referral migration:
 *   - get_or_create_my_referral_code() → text
 *   - redeem_referral_code(_code text) → { ok, message, referred_reward }
 *
 * Plus direct reads against the `referrals` table (RLS-scoped to the user).
 */
import { supabase } from "@/integrations/supabase/client";

export interface MyReferralStats {
  code: string | null;
  totalReferred: number;
  totalEarned: number;
  redeemedCode: string | null;       // the code I used (if any)
  invitees: Array<{
    id: string;
    referred_user_id: string;
    status: string;
    referrer_reward: number;
    created_at: string;
  }>;
}

export async function getOrCreateMyReferralCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_or_create_my_referral_code");
  if (error) {
    console.warn("[referral] get_or_create failed", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

export interface RedeemResult { ok: boolean; message: string; reward: number }

export async function redeemReferralCode(code: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("redeem_referral_code", { _code: code });
  if (error) return { ok: false, message: error.message, reward: 0 };
  // RPC returns a SETOF row — postgrest gives us an array
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, message: "No response from server", reward: 0 };
  return {
    ok: Boolean(row.ok),
    message: String(row.message ?? ""),
    reward: Number(row.referred_reward ?? 0),
  };
}

export async function fetchMyReferralStats(userId: string): Promise<MyReferralStats> {
  const [codeRes, sentRes, receivedRes] = await Promise.all([
    getOrCreateMyReferralCode(),
    supabase
      .from("referrals")
      .select("id,referred_user_id,status,referrer_reward,created_at")
      .eq("referrer_user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("referrals")
      .select("code")
      .eq("referred_user_id", userId)
      .maybeSingle(),
  ]);

  const invitees = (sentRes.data ?? []) as MyReferralStats["invitees"];
  const totalEarned = invitees
    .filter((r) => r.status === "completed")
    .reduce((s, r) => s + Number(r.referrer_reward), 0);

  return {
    code: codeRes,
    totalReferred: invitees.length,
    totalEarned,
    redeemedCode: receivedRes.data?.code ?? null,
    invitees,
  };
}

const REFERRAL_PROMPT_KEY = "tw-referral-prompt-v1";

/** Whether to show the optional referral step during onboarding. */
export function shouldShowReferralPrompt(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REFERRAL_PROMPT_KEY) !== "done";
}

export function markReferralPromptDone() {
  try { localStorage.setItem(REFERRAL_PROMPT_KEY, "done"); } catch { /* ignore */ }
}
