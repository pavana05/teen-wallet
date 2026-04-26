import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Short, copy-friendly correlation ID used to tie a UI error to server logs. */
function newCid(): string {
  const u = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? "";
  const hex = u ? u.replace(/-/g, "").slice(0, 8) : Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `tw_${hex}`;
}

/** Tagged error response that includes the correlation ID in both body and header. */
function errJson(cid: string, error: string, status: number, extra: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.error(`[kyc.verify] ${cid} status=${status} error="${error}"`, extra);
  return new Response(
    JSON.stringify({ error, correlationId: cid, ...extra }),
    { status, headers: { "Content-Type": "application/json", "X-Correlation-Id": cid, ...CORS } },
  );
}

// Server-side selfie validation
function validateSelfieDataUrl(dataUrl: string): { ok: true; bytes: number } | { ok: false; reason: string } {
  if (!dataUrl.startsWith("data:image/")) return { ok: false, reason: "Invalid image format" };
  const base64 = dataUrl.split(",")[1];
  if (!base64) return { ok: false, reason: "Empty image payload" };
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes < 8 * 1024) return { ok: false, reason: "Selfie too small — please retake in better light" };
  if (bytes > 5 * 1024 * 1024) return { ok: false, reason: "Selfie too large (>5MB)" };
  return { ok: true, bytes };
}

/**
 * Real Aadhaar/KYC verification endpoint.
 * In production this would POST to a KYC provider (Digio / IDfy / Karza).
 * For dev we simulate the provider call deterministically and write the
 * status to `kyc_submissions` so the client can poll.
 */
async function callKycProvider(payload: {
  userId: string;
  aadhaarLast4: string;
  selfieBytes: number;
}): Promise<{ providerRef: string; status: "pending" | "approved" | "rejected"; matchScore: number; reason: string | null }> {
  // TODO: Replace with real Digio/IDfy fetch when secrets are configured.
  // const r = await fetch(`${process.env.DIGIO_BASE_URL}/v3/client/kyc/aadhaar`, { ... })
  await new Promise((r) => setTimeout(r, 600));
  const matchScore = 0.78 + Math.random() * 0.2;
  return {
    providerRef: `dgo_${crypto.randomUUID().slice(0, 12)}`,
    status: "pending",
    matchScore: Number(matchScore.toFixed(3)),
    reason: null,
  };
}

export const Route = createFileRoute("/api/kyc/verify")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const cid = newCid();
        try {
          // 1) Authenticate the caller via their Supabase JWT
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!token) return errJson(cid, "Missing auth token", 401);

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const userClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userErr } = await userClient.auth.getUser();
          if (userErr || !userData.user) return errJson(cid, "Unauthorized", 401, { detail: userErr?.message });
          const userId = userData.user.id;

          // 2) Validate body
          const body = (await request.json().catch(() => null)) as
            | {
                selfie?: string;
                width?: number;
                height?: number;
                aadhaarLast4?: string;
                docFrontPath?: string | null;
                docBackPath?: string | null;
              }
            | null;
          if (!body) return errJson(cid, "Invalid JSON", 400);
          if (!body.selfie) return errJson(cid, "Missing selfie", 400);
          if (typeof body.width !== "number" || typeof body.height !== "number")
            return errJson(cid, "Missing canvas dimensions", 400);
          if (body.width < 240 || body.height < 240)
            return errJson(cid, "Selfie resolution too low", 400);
          if (!body.aadhaarLast4 || !/^\d{4}$/.test(body.aadhaarLast4))
            return errJson(cid, "Missing Aadhaar reference", 400);

          const v = validateSelfieDataUrl(body.selfie);
          if (!v.ok) return errJson(cid, v.reason, 400);

          // 2b) Persist selfie image to private storage so admins can review it.
          let selfiePath: string | null = null;
          try {
            const mimeMatch = body.selfie.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
            const mime = mimeMatch?.[1] ?? "image/jpeg";
            const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
            const base64 = body.selfie.split(",")[1] ?? "";
            const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const path = `${userId}/selfie-${Date.now()}.${ext}`;
            const { error: upErr } = await supabaseAdmin.storage
              .from("kyc-docs")
              .upload(path, bin, { upsert: true, contentType: mime });
            if (!upErr) selfiePath = path;
            else console.error(`[kyc.verify] ${cid} selfie upload failed:`, upErr.message);
          } catch (e) {
            console.error(`[kyc.verify] ${cid} selfie upload threw:`, e);
          }

          // 3) Insert pending submission row
          const { data: row, error: insErr } = await supabaseAdmin
            .from("kyc_submissions")
            .insert({
              user_id: userId,
              status: "pending",
              provider: "digio",
              selfie_size_bytes: v.bytes,
              selfie_width: body.width,
              selfie_height: body.height,
              selfie_path: selfiePath,
              doc_front_path: body.docFrontPath ?? null,
              doc_back_path: body.docBackPath ?? null,
            })
            .select("id")
            .single();
          if (insErr || !row) return errJson(cid, "Failed to record submission", 500, { detail: insErr?.message });

          // 4) Call provider (simulated). On error keep status=pending and surface message.
          let provider;
          try {
            provider = await callKycProvider({
              userId,
              aadhaarLast4: body.aadhaarLast4,
              selfieBytes: v.bytes,
            });
          } catch (e) {
            const reason = e instanceof Error ? e.message : "Provider unreachable";
            console.error(`[kyc.verify] ${cid} provider call failed:`, reason);
            await supabaseAdmin
              .from("kyc_submissions")
              .update({
                status: "pending",
                reason: `${reason} [${cid}]`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);
            return new Response(
              JSON.stringify({ submissionId: row.id, status: "pending", reason: "Provider unreachable", correlationId: cid }),
              { status: 202, headers: { "Content-Type": "application/json", "X-Correlation-Id": cid, ...CORS } },
            );
          }

          await supabaseAdmin
            .from("kyc_submissions")
            .update({
              status: provider.status,
              provider_ref: provider.providerRef,
              match_score: provider.matchScore,
              reason: provider.reason,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          await supabaseAdmin
            .from("profiles")
            .update({ kyc_status: provider.status })
            .eq("id", userId);

          return new Response(
            JSON.stringify({
              submissionId: row.id,
              providerRef: provider.providerRef,
              status: provider.status,
              matchScore: provider.matchScore,
              correlationId: cid,
            }),
            { status: 200, headers: { "Content-Type": "application/json", "X-Correlation-Id": cid, ...CORS } },
          );
        } catch (e) {
          return errJson(cid, e instanceof Error ? e.message : "Server error", 500);
        }
      },
    },
  },
});
