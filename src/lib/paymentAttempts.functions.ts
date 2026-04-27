// Payment attempt lifecycle on the server.
//
// Why a separate table from `transactions`:
//   • An "attempt" exists from the moment the user taps Confirm and lasts
//     until the (simulated) PSP webhook resolves it. A `transactions` row is
//     only created on success.
//   • Persisting the attempt lets the user refresh / lock their phone and
//     resume the same payment screen (Confirm → Processing → Success) instead
//     of being dropped back into the scanner.
//   • Polling against the attempt id gives the UI a real "Processing →
//     Success" transition driven by backend state, not a client setTimeout.
//
// The "PSP webhook" is simulated: when an attempt enters `processing`, we set
// `webhook_due_at = now() + delay`. The `pollAttempt` server function calls
// the SQL function `finalize_due_payment_attempt` which atomically promotes
// the attempt to `success`, inserts the transaction, debits the wallet, and
// returns the new state — exactly what a real webhook handler would do.

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const SIM_PROCESSING_MS = 3000;

const AuthenticatedInput = z.object({
  authToken: z.string().min(1),
});

const CreateAttemptInput = AuthenticatedInput.extend({
  amount: z.number().positive().max(100_000),
  upiId: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/),
  payeeName: z.string().min(1).max(120),
  note: z.string().max(80).nullable().optional(),
  method: z.enum(["upi", "wallet", "card"]).default("upi"),
  clientRef: z.string().max(120).optional(),
});

const AttemptIdInput = AuthenticatedInput.extend({
  attemptId: z.string().uuid(),
});

export type AttemptStage = "confirm" | "processing" | "success" | "failed" | "cancelled";

export interface AttemptSnapshot {
  id: string;
  stage: AttemptStage;
  amount: number;
  payeeName: string;
  upiId: string;
  note: string | null;
  method: "upi" | "wallet" | "card";
  transactionId: string | null;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: string;
  processingStartedAt: string | null;
  completedAt: string | null;
  webhookDueAt: string | null;
}

type UserClient = ReturnType<typeof createClient<Database>>;

async function authClient(token: string): Promise<{ supabase: UserClient; userId: string } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  return { supabase, userId };
}

function snapshotFromRow(row: Record<string, unknown>): AttemptSnapshot {
  return {
    id: String(row.id),
    stage: row.stage as AttemptStage,
    amount: Number(row.amount),
    payeeName: String(row.payee_name),
    upiId: String(row.upi_id),
    note: (row.note as string | null) ?? null,
    method: (row.method as "upi" | "wallet" | "card") ?? "upi",
    transactionId: (row.transaction_id as string | null) ?? null,
    providerRef: (row.provider_ref as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt: String(row.created_at),
    processingStartedAt: (row.processing_started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    webhookDueAt: (row.webhook_due_at as string | null) ?? null,
  };
}

/** Create a new attempt in the `confirm` stage. Idempotent on `clientRef`. */
export const createAttempt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateAttemptInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; attempt: AttemptSnapshot } | { ok: false; message: string }> => {
    const auth = await authClient(data.authToken);
    if (!auth) return { ok: false, message: "Please sign in again." };
    const { supabase, userId } = auth;

    if (data.clientRef) {
      const { data: existing } = await supabase
        .from("payment_attempts")
        .select("*")
        .eq("user_id", userId)
        .eq("client_ref", data.clientRef)
        .maybeSingle();
      if (existing) return { ok: true, attempt: snapshotFromRow(existing as Record<string, unknown>) };
    }

    const { data: row, error } = await supabase
      .from("payment_attempts")
      .insert({
        user_id: userId,
        amount: data.amount,
        payee_name: data.payeeName,
        upi_id: data.upiId,
        note: data.note ?? null,
        method: data.method,
        stage: "confirm",
        client_ref: data.clientRef ?? null,
      })
      .select("*")
      .single();
    if (error || !row) return { ok: false, message: error?.message ?? "Could not create payment attempt." };
    return { ok: true, attempt: snapshotFromRow(row as Record<string, unknown>) };
  });

/** Promote attempt to `processing` and arm the simulated webhook. */
export const startProcessing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AttemptIdInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; attempt: AttemptSnapshot } | { ok: false; message: string }> => {
    const auth = await authClient(data.authToken);
    if (!auth) return { ok: false, message: "Please sign in again." };
    const { supabase, userId } = auth;

    const dueAt = new Date(Date.now() + SIM_PROCESSING_MS).toISOString();
    const { data: row, error } = await supabase
      .from("payment_attempts")
      .update({
        stage: "processing",
        processing_started_at: new Date().toISOString(),
        webhook_due_at: dueAt,
      })
      .eq("id", data.attemptId)
      .eq("user_id", userId)
      .in("stage", ["confirm", "processing"])
      .select("*")
      .single();
    if (error || !row) return { ok: false, message: error?.message ?? "Attempt not found." };
    return { ok: true, attempt: snapshotFromRow(row as Record<string, unknown>) };
  });

/**
 * Poll an attempt's current state. If it is `processing` and its simulated
 * webhook is due, finalize it (insert transaction, debit balance, mark
 * success). This mimics a real webhook + polling architecture: the UI never
 * owns the success transition — the backend does.
 */
export const pollAttempt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AttemptIdInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; attempt: AttemptSnapshot; newBalance?: number } | { ok: false; message: string }> => {
    const auth = await authClient(data.authToken);
    if (!auth) return { ok: false, message: "Please sign in again." };
    const { supabase, userId } = auth;

    // Try to finalize if due. The RPC is a no-op for non-due / terminal attempts.
    let newBalance: number | undefined;
    const { data: rpc } = await supabase.rpc("finalize_due_payment_attempt", { _attempt_id: data.attemptId });
    if (Array.isArray(rpc) && rpc[0] && typeof (rpc[0] as { new_balance?: number }).new_balance === "number") {
      newBalance = Number((rpc[0] as { new_balance: number }).new_balance);
    }

    const { data: row, error } = await supabase
      .from("payment_attempts")
      .select("*")
      .eq("id", data.attemptId)
      .eq("user_id", userId)
      .single();
    if (error || !row) return { ok: false, message: "Attempt not found." };
    return { ok: true, attempt: snapshotFromRow(row as Record<string, unknown>), newBalance };
  });

/** Cancel a non-terminal attempt (user backed out of Confirm). */
export const cancelAttempt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AttemptIdInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const auth = await authClient(data.authToken);
    if (!auth) return { ok: false, message: "Please sign in again." };
    const { supabase, userId } = auth;
    const { error } = await supabase
      .from("payment_attempts")
      .update({ stage: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.attemptId)
      .eq("user_id", userId)
      .in("stage", ["confirm", "processing"]);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  });

/** Find the most recent in-progress attempt, if any — for resume on app open. */
export const findResumableAttempt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AuthenticatedInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; attempt: AttemptSnapshot | null } | { ok: false; message: string }> => {
    const auth = await authClient(data.authToken);
    if (!auth) return { ok: false, message: "Please sign in again." };
    const { supabase, userId } = auth;
    const { data: row } = await supabase
      .from("payment_attempts")
      .select("*")
      .eq("user_id", userId)
      .in("stage", ["confirm", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { ok: true, attempt: row ? snapshotFromRow(row as Record<string, unknown>) : null };
  });
