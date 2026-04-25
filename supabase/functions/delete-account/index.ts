// Deletes the authenticated user's account and all their data.
// Uses the SERVICE_ROLE key to call admin.deleteUser, which cascades to public.profiles
// (RLS-protected user-owned tables also get cleaned via explicit delete below).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // Verify caller identity using their JWT
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const userId = u.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Best-effort cleanup of user-owned rows. profiles is removed via deleteUser cascade
    // for the FK-linked tables, but we explicitly clear public tables that reference user_id.
    await Promise.allSettled([
      admin.from("transactions").delete().eq("user_id", userId),
      admin.from("notifications").delete().eq("user_id", userId),
      admin.from("fraud_logs").delete().eq("user_id", userId),
      admin.from("kyc_submissions").delete().eq("user_id", userId),
      admin.from("parental_links").delete().eq("teen_user_id", userId),
      admin.from("profiles").delete().eq("id", userId),
    ]);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
