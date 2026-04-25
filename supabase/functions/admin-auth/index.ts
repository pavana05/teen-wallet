// Admin authentication edge function.
// Endpoints (POST JSON, action selects behavior):
//   action=login_password   { email, password }
//     -> if status=pending or password_hash null: { stage: "set_password" }
//     -> if totp_enrolled false: { stage: "enroll_totp", challengeToken, otpauthUrl, secret }
//     -> else: { stage: "totp", challengeToken }
//   action=set_password     { email, password }   (only allowed when status=pending)
//     -> { stage: "enroll_totp", challengeToken, otpauthUrl, secret }
//   action=verify_totp      { challengeToken, code }
//     -> { sessionToken, admin: { id, email, name, role } }
//   action=session          { sessionToken }
//     -> { admin } | 401
//   action=logout           { sessionToken }
//     -> { ok: true }
//
// CORS-enabled. Uses service-role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// -----------------------------------------------------------------
// CORS
// -----------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// -----------------------------------------------------------------
// Crypto helpers (WebCrypto)
// -----------------------------------------------------------------
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function pbkdf2Hash(password: string, salt: Uint8Array, iterations = 120_000): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${iterations}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}
async function makePasswordHash(password: string): Promise<string> {
  return pbkdf2Hash(password, randomBytes(16));
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltHex, hashHex] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const computed = await pbkdf2Hash(password, hexToBytes(saltHex), parseInt(iterStr, 10));
    const newHash = computed.split("$")[3];
    if (newHash.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < newHash.length; i++) diff |= newHash.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(buf));
}

// -----------------------------------------------------------------
// TOTP (RFC 6238) — base32 + HMAC-SHA1
// -----------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(b: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of b) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function totpCode(secretB32: string, time = Date.now(), step = 30): Promise<string> {
  const counter = Math.floor(time / 1000 / step);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter & 0xffffffff, false);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24)
    | ((sig[offset + 1] & 0xff) << 16)
    | ((sig[offset + 2] & 0xff) << 8)
    | (sig[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}
async function totpVerify(secretB32: string, code: string, window = 1): Promise<boolean> {
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const c = await totpCode(secretB32, now + w * 30_000);
    if (c === code) return true;
  }
  return false;
}

// -----------------------------------------------------------------
// Validation
// -----------------------------------------------------------------
function emailAllowed(email: string): boolean {
  const e = email.toLowerCase();
  return e.endsWith("@teenwallet.in") || e === "pavana25t@gmail.com";
}
function passwordValid(p: string): { ok: boolean; reason?: string } {
  if (p.length < 12) return { ok: false, reason: "Password must be at least 12 characters" };
  if (!/[A-Z]/.test(p)) return { ok: false, reason: "Must include an uppercase letter" };
  if (!/[a-z]/.test(p)) return { ok: false, reason: "Must include a lowercase letter" };
  if (!/[0-9]/.test(p)) return { ok: false, reason: "Must include a number" };
  if (!/[^A-Za-z0-9]/.test(p)) return { ok: false, reason: "Must include a special character" };
  return { ok: true };
}

// -----------------------------------------------------------------
// Challenge token (short-lived, signed) — stored server-side in admin_sessions w/ purpose=challenge
// -----------------------------------------------------------------
type Admin = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enrolled: boolean;
  failed_attempts: number;
  locked_until: string | null;
};

// -----------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const ip = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = String(body.action ?? "");

  async function audit(adminId: string | null, email: string | null, role: string | null, type: string, extra: Record<string, unknown> = {}) {
    await sb.from("admin_audit_log").insert({
      admin_id: adminId,
      admin_email: email,
      admin_role: role as any,
      action_type: type,
      ip_address: ip,
      user_agent: ua,
      new_value: extra as any,
    });
  }

  // ---------------------------------------------------------------
  // login_password
  // ---------------------------------------------------------------
  if (action === "login_password") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!emailAllowed(email)) {
      await audit(null, email, null, "login_failed", { reason: "email_not_allowed" });
      return json({ error: "invalid_credentials" }, 401);
    }
    const { data: admin } = await sb.from("admin_users").select("*").eq("email", email).maybeSingle<Admin>();
    if (!admin) {
      await audit(null, email, null, "login_failed", { reason: "no_account" });
      return json({ error: "invalid_credentials" }, 401);
    }
    if (admin.status === "disabled") {
      await audit(admin.id, email, admin.role, "login_failed", { reason: "disabled" });
      return json({ error: "account_disabled" }, 403);
    }
    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      await audit(admin.id, email, admin.role, "login_failed", { reason: "locked" });
      return json({ error: "account_locked", until: admin.locked_until }, 423);
    }

    // First-time setup: no password yet
    if (!admin.password_hash || admin.status === "pending") {
      // Allow proceeding only if they POST again with action=set_password
      return json({ stage: "set_password", email });
    }

    const ok = await verifyPassword(password, admin.password_hash);
    if (!ok) {
      const attempts = admin.failed_attempts + 1;
      const update: Record<string, unknown> = { failed_attempts: attempts };
      if (attempts >= 5) {
        update.status = "locked";
        update.locked_until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      } else if (attempts >= 3) {
        update.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await sb.from("admin_users").update(update).eq("id", admin.id);
      await audit(admin.id, email, admin.role, "login_failed", { reason: "bad_password", attempts });
      return json({ error: "invalid_credentials" }, 401);
    }

    // Password OK — reset attempts, issue challenge
    await sb.from("admin_users").update({ failed_attempts: 0, locked_until: null }).eq("id", admin.id);

    // Create a short-lived challenge "session" row (purpose stored via expiry pattern)
    const challengeToken = bytesToHex(randomBytes(32));
    const challengeHash = await sha256Hex("challenge:" + challengeToken);
    await sb.from("admin_sessions").insert({
      admin_id: admin.id,
      session_token_hash: challengeHash,
      ip_address: ip,
      user_agent: ua,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    if (!admin.totp_enrolled || !admin.totp_secret) {
      // Generate fresh TOTP secret
      const secret = base32Encode(randomBytes(20));
      await sb.from("admin_users").update({ totp_secret: secret, totp_enrolled: false }).eq("id", admin.id);
      const issuer = encodeURIComponent("Teen Wallet Admin");
      const label = encodeURIComponent(admin.email);
      const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
      await audit(admin.id, email, admin.role, "totp_enroll_started");
      return json({ stage: "enroll_totp", challengeToken, otpauthUrl, secret });
    }

    await audit(admin.id, email, admin.role, "password_ok");
    return json({ stage: "totp", challengeToken });
  }

  // ---------------------------------------------------------------
  // set_password (only allowed for pending admins)
  // ---------------------------------------------------------------
  if (action === "set_password") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!emailAllowed(email)) return json({ error: "invalid" }, 400);
    const pw = passwordValid(password);
    if (!pw.ok) return json({ error: "weak_password", reason: pw.reason }, 400);

    const { data: admin } = await sb.from("admin_users").select("*").eq("email", email).maybeSingle<Admin>();
    if (!admin) return json({ error: "invalid" }, 400);
    if (admin.password_hash && admin.status !== "pending") {
      return json({ error: "password_already_set" }, 400);
    }

    const hash = await makePasswordHash(password);
    const secret = base32Encode(randomBytes(20));
    await sb.from("admin_users").update({
      password_hash: hash,
      status: "active",
      totp_secret: secret,
      totp_enrolled: false,
      failed_attempts: 0,
      locked_until: null,
    }).eq("id", admin.id);

    const challengeToken = bytesToHex(randomBytes(32));
    const challengeHash = await sha256Hex("challenge:" + challengeToken);
    await sb.from("admin_sessions").insert({
      admin_id: admin.id,
      session_token_hash: challengeHash,
      ip_address: ip,
      user_agent: ua,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    const issuer = encodeURIComponent("Teen Wallet Admin");
    const label = encodeURIComponent(admin.email);
    const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;

    await audit(admin.id, email, admin.role, "password_set");
    return json({ stage: "enroll_totp", challengeToken, otpauthUrl, secret });
  }

  // ---------------------------------------------------------------
  // verify_totp -> issues real session
  // ---------------------------------------------------------------
  if (action === "verify_totp") {
    const challengeToken = String(body.challengeToken ?? "");
    const code = String(body.code ?? "").replace(/\s+/g, "");
    if (!challengeToken || code.length !== 6) return json({ error: "invalid" }, 400);

    const challengeHash = await sha256Hex("challenge:" + challengeToken);
    const { data: ch } = await sb.from("admin_sessions").select("*").eq("session_token_hash", challengeHash).maybeSingle();
    if (!ch || ch.invalidated_at || new Date(ch.expires_at) < new Date()) {
      return json({ error: "challenge_expired" }, 401);
    }
    const { data: admin } = await sb.from("admin_users").select("*").eq("id", ch.admin_id).maybeSingle<Admin>();
    if (!admin || !admin.totp_secret) return json({ error: "invalid" }, 401);

    const ok = await totpVerify(admin.totp_secret, code);
    if (!ok) {
      await audit(admin.id, admin.email, admin.role, "totp_failed");
      return json({ error: "invalid_code" }, 401);
    }

    if (!admin.totp_enrolled) {
      await sb.from("admin_users").update({ totp_enrolled: true }).eq("id", admin.id);
    }
    // Burn the challenge
    await sb.from("admin_sessions").update({ invalidated_at: new Date().toISOString() }).eq("id", ch.id);

    // Single-session: invalidate all prior live sessions for this admin
    await sb.from("admin_sessions")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("admin_id", admin.id)
      .is("invalidated_at", null);

    // Issue real session
    const sessionToken = bytesToHex(randomBytes(32));
    const sessionHash = await sha256Hex("session:" + sessionToken);
    const expiresAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    await sb.from("admin_sessions").insert({
      admin_id: admin.id,
      session_token_hash: sessionHash,
      ip_address: ip,
      user_agent: ua,
      expires_at: expiresAt,
    });
    await sb.from("admin_users").update({
      last_login_at: new Date().toISOString(),
      last_login_ip: ip,
    }).eq("id", admin.id);

    await audit(admin.id, admin.email, admin.role, "login_success");

    return json({
      sessionToken,
      expiresAt,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  }

  // ---------------------------------------------------------------
  // session — verify and refresh idle window
  // ---------------------------------------------------------------
  if (action === "session") {
    const sessionToken = String(body.sessionToken ?? "");
    if (!sessionToken) return json({ error: "no_session" }, 401);
    const sessionHash = await sha256Hex("session:" + sessionToken);
    const { data: s } = await sb.from("admin_sessions").select("*").eq("session_token_hash", sessionHash).maybeSingle();
    if (!s || s.invalidated_at || new Date(s.expires_at) < new Date()) return json({ error: "expired" }, 401);
    const { data: admin } = await sb.from("admin_users").select("id,email,name,role,status").eq("id", s.admin_id).maybeSingle();
    if (!admin || admin.status !== "active") return json({ error: "no_account" }, 401);
    await sb.from("admin_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
    return json({ admin, expiresAt: s.expires_at });
  }

  // ---------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------
  if (action === "logout") {
    const sessionToken = String(body.sessionToken ?? "");
    if (sessionToken) {
      const sessionHash = await sha256Hex("session:" + sessionToken);
      const { data: s } = await sb.from("admin_sessions").select("*").eq("session_token_hash", sessionHash).maybeSingle();
      if (s) {
        await sb.from("admin_sessions").update({ invalidated_at: new Date().toISOString() }).eq("id", s.id);
        await audit(s.admin_id, null, null, "logout");
      }
    }
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
