// Server function for processing a UPI payment.
//
// Why this exists in addition to the client-side flow in ScanPay.tsx:
//   - Re-runs fraud rules on the server using the user's RLS-scoped client
//     so the client cannot disable / tamper with the rules.
//   - Re-checks balance immediately before the debit, in the same request,
//     to minimise the race window.
//   - Returns a real `upi://pay?...` deep link the client can hand off to
//     a real UPI app on mobile.
//
// Note: This currently uses the same "select balance → insert txn → update
// balance" pattern as the client. A true atomic debit requires a Postgres
// RPC / RLS-safe stored proc; we keep the API shape so we can swap the
// implementation later without touching callers.

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildUpiDeepLink } from "@/lib/upi";
import type { Database } from "@/integrations/supabase/types";

const PayInput = z.object({
  amount: z.number().positive().max(100_000),
  upiId: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/, "Invalid UPI ID"),
  payeeName: z.string().min(1).max(120),
  note: z.string().max(80).nullable().optional(),
  // Passed by callWithAuth. Keeping auth inside validated data avoids raw
  // framework-level 401 Responses from middleware, which surfaced as
  // `[object Response]` blank-screen runtime errors.
  authToken: z.string().min(1).optional(),
});

export type PayUpiResult =
  | {
      ok: true;
      txnId: string;
      createdAt: string;
      newBalance: number;
      upiDeepLink: string;
      flags: { rule: string; severity: "block" | "warn" | "info"; message: string }[];
    }
  | {
      ok: false;
      reason: "auth_required" | "blocked" | "insufficient" | "balance_changed" | "fetch_failed" | "insert_failed";
      message: string;
      newBalance?: number;
      flags?: { rule: string; severity: "block" | "warn" | "info"; message: string }[];
    };

const DAILY_LIMIT = 10_000;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
const VELOCITY_MAX = 5;

type RecentTxn = { amount: number; upi_id: string; created_at: string };
type FraudFlag = { rule: string; severity: "block" | "warn" | "info"; message: string };

function runFraudRules(
  txns: RecentTxn[],
  amount: number,
  upiId: string,
  now = new Date(),
): { flags: FraudFlag[]; blocked: boolean } {
  const flags: FraudFlag[] = [];

  const recentCount = txns.filter(
    (t) => now.getTime() - new Date(t.created_at).getTime() < VELOCITY_WINDOW_MS,
  ).length;
  if (recentCount >= VELOCITY_MAX) {
    flags.push({
      rule: "VELOCITY",
      severity: "block",
      message: "Unusual activity detected. Please wait 10 minutes or contact support.",
    });
  }

  if (txns.length >= 3) {
    const avg = txns.reduce((s, t) => s + Number(t.amount), 0) / txns.length;
    if (avg > 0 && amount > avg * 3) {
      flags.push({
        rule: "AMOUNT_ANOMALY",
        severity: "warn",
        message: `Larger than usual ₹${avg.toFixed(0)} payment.`,
      });
    }
  }

  if (!txns.some((t) => t.upi_id === upiId)) {
    flags.push({
      rule: "NEW_MERCHANT",
      severity: "warn",
      message: "First time paying this merchant.",
    });
  }

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const spentToday = txns
    .filter((t) => new Date(t.created_at) >= dayStart)
    .reduce((s, t) => s + Number(t.amount), 0);
  const remaining = DAILY_LIMIT - spentToday;
  if (amount > remaining) {
    flags.push({
      rule: "DAILY_LIMIT",
      severity: "block",
      message: `Daily limit ₹${DAILY_LIMIT.toLocaleString("en-IN")} exceeded. ₹${remaining.toFixed(0)} remaining today.`,
    });
  }

  const hr = now.getHours();
  if (hr >= 23 || hr < 6) {
    flags.push({
      rule: "NIGHT_TIME",
      severity: "warn",
      message: "Late-night payment.",
    });
  }

  return { flags, blocked: flags.some((f) => f.severity === "block") };
}

type PayInputData = z.infer<typeof PayInput>;

type UserClientResult =
  | { ok: true; supabase: ReturnType<typeof createClient<Database>>; userId: string }
  | { ok: false; message: string };

async function createUserSupabaseClient(authToken?: string): Promise<UserClientResult> {
  if (!authToken) {
    return { ok: false, message: "Please sign in again before making a payment." };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, message: "Payments are temporarily unavailable." };
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${authToken}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(authToken);
  const userId = data?.claims?.sub;
  if (error || !userId) {
    return { ok: false, message: "Your session expired. Please sign in again." };
  }

  return { ok: true, supabase, userId };
}

export const payUpi = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PayInput.parse(input))
  .handler(async ({ data }: { data: PayInputData }): Promise<PayUpiResult> => {
    const auth = await createUserSupabaseClient(data.authToken);
    if (!auth.ok) {
      return { ok: false, reason: "auth_required", message: auth.message };
    }
    const { supabase, userId } = auth;

    // 1. Pull recent history (RLS-scoped to this user)
    const { data: recent, error: recentErr } = await supabase
      .from("transactions")
      .select("amount, upi_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (recentErr) {
      return { ok: false, reason: "fetch_failed", message: "Couldn't load transaction history." };
    }

    const txns = (recent ?? []) as RecentTxn[];

    // 2. Server-side fraud check
    const { flags, blocked } = runFraudRules(txns, data.amount, data.upiId);
    if (blocked) {
      // Best-effort log — non-fatal if it fails.
      await supabase.from("fraud_logs").insert(
        flags.map((f) => ({
          user_id: userId,
          transaction_id: null,
          rule_triggered: f.rule,
          resolution: "blocked",
        })),
      );
      const blockMsg = flags.find((f) => f.severity === "block")?.message ?? "Payment blocked";
      return { ok: false, reason: "blocked", message: blockMsg, flags };
    }

    // 3. Re-fetch live balance just before debit
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("balance")
      .eq("id", userId)
      .single();
    if (profErr || !profile) {
      return { ok: false, reason: "fetch_failed", message: "Couldn't verify balance." };
    }
    const liveBalance = Number(profile.balance);
    if (data.amount > liveBalance) {
      return {
        ok: false,
        reason: "insufficient",
        message: `Your balance is ₹${liveBalance.toFixed(2)}, not enough for this payment.`,
        newBalance: liveBalance,
      };
    }

    // 4. Insert the txn (RLS enforces user_id = auth.uid())
    const { data: txn, error: insErr } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        amount: data.amount,
        merchant_name: data.payeeName,
        upi_id: data.upiId,
        note: data.note ?? null,
        status: "success",
        // jsonb column — store the full flag list for audit trail
        fraud_flags: flags as never,
      })
      .select("id, created_at")
      .single();

    if (insErr || !txn) {
      return {
        ok: false,
        reason: "insert_failed",
        message: insErr?.message ?? "Could not record the payment.",
      };
    }

    // 5. Debit the wallet + log warn-level flags + notify
    const newBalance = Number((liveBalance - data.amount).toFixed(2));
    await supabase.from("profiles").update({ balance: newBalance }).eq("id", userId);

    if (flags.length > 0) {
      await supabase.from("fraud_logs").insert(
        flags.map((f) => ({
          user_id: userId,
          transaction_id: txn.id,
          rule_triggered: f.rule,
          resolution: "user_confirmed",
        })),
      );
    }

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "payment_sent",
      title: `₹${data.amount.toFixed(2)} paid to ${data.payeeName}`,
      body: data.note ? `${data.upiId} · ${data.note}` : data.upiId,
    });

    // 6. Build the UPI deep link the client can hand off to a real UPI app
    const upiDeepLink = buildUpiDeepLink({
      upiId: data.upiId,
      payeeName: data.payeeName,
      amount: data.amount,
      note: data.note ?? null,
      txnRef: txn.id,
    });

    return {
      ok: true,
      txnId: txn.id,
      createdAt: txn.created_at ?? new Date().toISOString(),
      newBalance,
      upiDeepLink,
      flags,
    };
  });
