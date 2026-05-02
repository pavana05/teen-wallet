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

function json(data: unknown, status = 200, cid?: string) {
  // When a request-scoped correlation ID is supplied, attach it both as a header
  // (machine readable, for log correlation) and merge it into the JSON body
  // (UI can copy it). For success bodies it appears as `correlationId`; for error
  // bodies the existing `error` key stays the user-safe code.
  const headers: Record<string, string> = { "Content-Type": "application/json", ...corsHeaders };
  let payload: unknown = data;
  if (cid) {
    headers["X-Correlation-Id"] = cid;
    if (data && typeof data === "object") {
      payload = { ...(data as Record<string, unknown>), correlationId: cid };
    } else {
      payload = { value: data, correlationId: cid };
    }
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function newCid(): string {
  const u = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `tw_${u}`;
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
// In-memory rate limiter (per-isolate; pragmatic v1)
// -----------------------------------------------------------------
type Bucket = { count: number; resetAt: number; blockedUntil?: number };
const RATE_BUCKETS = new Map<string, Bucket>();
function rateCheck(key: string, max: number, windowMs: number, blockMs: number): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const b = RATE_BUCKETS.get(key);
  if (b?.blockedUntil && b.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000) };
  }
  if (!b || b.resetAt < now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > max) {
    b.blockedUntil = now + blockMs;
    return { ok: false, retryAfterSec: Math.ceil(blockMs / 1000) };
  }
  return { ok: true };
}

// -----------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Per-request correlation ID. Generated up-front so even early validation
  // failures (bad method, bad JSON) come back with an ID the user can copy.
  const cid = newCid();

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const ip = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const ua = req.headers.get("user-agent") ?? "unknown";

  // Local helper that shadows the module `json`. Every existing `json(...)` call
  // site inside this handler automatically gets the request correlation ID,
  // and error responses are mirrored to console for log-grep correlation.
  // Hoisted via function-declaration so the early POST guard below can use it.
  function localJson(data: unknown, status = 200): Response {
    if (status >= 400) {
      const errCode = (data as { error?: string } | null)?.error ?? "?";
      console.error(`[admin-auth] ${cid} error="${errCode}" status=${status} ip=${ip}`);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json", ...corsHeaders, "X-Correlation-Id": cid };
    const body = data && typeof data === "object"
      ? { ...(data as Record<string, unknown>), correlationId: cid }
      : { value: data, correlationId: cid };
    return new Response(JSON.stringify(body), { status, headers });
  }
  // Alias as `json` so we don't have to rewrite ~30 existing call sites below.
  const json = localJson;

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

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
      new_value: { ...extra, correlationId: cid } as any,
    });
  }


  // ---------------------------------------------------------------
  // login_password
  // ---------------------------------------------------------------
  if (action === "login_password") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    // Per-IP and per-email rate limit (5/min then 15min block)
    const rl1 = rateCheck(`login:ip:${ip}`, 10, 60_000, 15 * 60_000);
    const rl2 = rateCheck(`login:em:${email}`, 5, 60_000, 15 * 60_000);
    if (!rl1.ok || !rl2.ok) {
      return json({ error: "rate_limited", retryAfterSec: Math.max(rl1.retryAfterSec ?? 0, rl2.retryAfterSec ?? 0) }, 429);
    }
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
  // totp_reset_login — admin lost authenticator. Verify password, reset secret, return fresh enroll QR.
  // ---------------------------------------------------------------
  if (action === "totp_reset_login") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rl = rateCheck(`totpreset:${email}:${ip}`, 3, 60 * 60_000, 60 * 60_000);
    if (!rl.ok) return json({ error: "rate_limited", retryAfterSec: rl.retryAfterSec }, 429);
    if (!emailAllowed(email) || !password) return json({ error: "invalid" }, 400);
    const { data: admin } = await sb.from("admin_users").select("*").eq("email", email).maybeSingle<Admin>();
    if (!admin || !admin.password_hash) return json({ error: "invalid_credentials" }, 401);
    if (admin.status === "disabled") return json({ error: "account_disabled" }, 403);
    const ok = await verifyPassword(password, admin.password_hash);
    if (!ok) {
      await audit(admin.id, email, admin.role, "totp_reset_failed", { reason: "bad_password" });
      return json({ error: "invalid_credentials" }, 401);
    }
    const secret = base32Encode(randomBytes(20));
    await sb.from("admin_users").update({ totp_secret: secret, totp_enrolled: false }).eq("id", admin.id);
    const challengeToken = bytesToHex(randomBytes(32));
    const challengeHash = await sha256Hex("challenge:" + challengeToken);
    await sb.from("admin_sessions").insert({
      admin_id: admin.id, session_token_hash: challengeHash,
      ip_address: ip, user_agent: ua,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const issuer = encodeURIComponent("Teen Wallet Admin");
    const label = encodeURIComponent(admin.email);
    const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
    await audit(admin.id, email, admin.role, "totp_reset_login");
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

  // ---------------------------------------------------------------
  // Authenticated data RPCs (require valid sessionToken)
  // ---------------------------------------------------------------
  async function authenticate(): Promise<{ id: string; email: string; role: string; name: string } | null> {
    const sessionToken = String(body.sessionToken ?? "");
    if (!sessionToken) return null;
    const sessionHash = await sha256Hex("session:" + sessionToken);
    const { data: s } = await sb.from("admin_sessions").select("*").eq("session_token_hash", sessionHash).maybeSingle();
    if (!s) return null;
    if (s.invalidated_at) return null;
    if (new Date(s.expires_at) < new Date()) return null;
    const { data: a } = await sb.from("admin_users").select("id,email,name,role,status").eq("id", s.admin_id).maybeSingle();
    if (!a || a.status !== "active") return null;
    // Slide the expiry window on each successful auth check (rolling 4h session)
    const newExpiry = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    await sb.from("admin_sessions").update({
      last_seen_at: new Date().toISOString(),
      expires_at: newExpiry,
    }).eq("id", s.id);
    return a as any;
  }

  const ROLE_PERMS: Record<string, string[]> = {
    viewUsers: ["super_admin", "operations_manager", "customer_support"],
    manageUsers: ["super_admin", "operations_manager"],
    viewDashboard: ["super_admin", "operations_manager", "compliance_officer", "customer_support", "fraud_analyst", "finance_manager"],
    viewKyc: ["super_admin", "operations_manager", "compliance_officer"],
    decideKyc: ["super_admin", "operations_manager"],
    viewTransactions: ["super_admin", "operations_manager", "finance_manager", "compliance_officer", "fraud_analyst"],
    manageTransactions: ["super_admin", "operations_manager"],
    viewFraud: ["super_admin", "fraud_analyst", "compliance_officer"],
    manageFraud: ["super_admin", "fraud_analyst"],
    viewAuditLog: ["super_admin", "compliance_officer"],
    manageAdmins: ["super_admin"],
    viewReports: ["super_admin", "operations_manager", "customer_support", "compliance_officer"],
    manageReports: ["super_admin", "operations_manager", "customer_support"],
  };
  function can(role: string, perm: string) {
    return (ROLE_PERMS[perm] || []).includes(role);
  }

  const me = await authenticate();
  if (!me) return json({ error: "unauthorized" }, 401);

  // ----- Dashboard stats -----
  if (action === "dashboard_stats") {
    if (!can(me.role, "viewDashboard")) return json({ error: "forbidden" }, 403);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();

    const [users, usersWeek, kycPending, txnsToday, txnsAll, fraudOpen] = await Promise.all([
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      sb.from("profiles").select("id", { count: "exact", head: true }).eq("kyc_status", "pending"),
      sb.from("transactions").select("amount,status,created_at").gte("created_at", startOfToday),
      sb.from("transactions").select("amount,created_at,status").gte("created_at", thirtyDaysAgo),
      sb.from("fraud_logs").select("id,rule_triggered,created_at").is("resolution", null),
    ]);

    const totalUsers = users.count ?? 0;
    const newUsers7d = usersWeek.count ?? 0;
    const txnsTodayList = txnsToday.data ?? [];
    const totalTxnsToday = txnsTodayList.length;
    const totalVolumeToday = txnsTodayList.reduce((acc: number, t: any) => acc + Number(t.amount || 0), 0);
    const successToday = txnsTodayList.filter((t: any) => t.status === "success").length;
    const successRate = totalTxnsToday ? Math.round((successToday / totalTxnsToday) * 1000) / 10 : 100;

    // Active today: distinct users with txn in last 24h
    const { data: activeRows } = await sb
      .from("transactions")
      .select("user_id")
      .gte("created_at", yesterday);
    const activeToday = new Set((activeRows ?? []).map((r: any) => r.user_id)).size;

    // Daily series (30d)
    const txnsAllList = txnsAll.data ?? [];
    const dayBuckets: Record<string, { volume: number; count: number; success: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const k = d.toISOString().slice(0, 10);
      dayBuckets[k] = { volume: 0, count: 0, success: 0 };
    }
    for (const t of txnsAllList) {
      const k = String(t.created_at).slice(0, 10);
      if (!dayBuckets[k]) continue;
      dayBuckets[k].volume += Number(t.amount || 0);
      dayBuckets[k].count += 1;
      if (t.status === "success") dayBuckets[k].success += 1;
    }
    const txnSeries = Object.entries(dayBuckets).map(([date, v]) => ({ date, ...v }));

    // Signups series (30d) split by KYC status
    const { data: signups } = await sb
      .from("profiles")
      .select("created_at,kyc_status")
      .gte("created_at", thirtyDaysAgo);
    const signupBuckets: Record<string, { approved: number; pending: number; other: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const k = d.toISOString().slice(0, 10);
      signupBuckets[k] = { approved: 0, pending: 0, other: 0 };
    }
    for (const u of signups ?? []) {
      const k = String((u as any).created_at).slice(0, 10);
      if (!signupBuckets[k]) continue;
      const s = (u as any).kyc_status;
      if (s === "approved") signupBuckets[k].approved += 1;
      else if (s === "pending") signupBuckets[k].pending += 1;
      else signupBuckets[k].other += 1;
    }
    const signupSeries = Object.entries(signupBuckets).map(([date, v]) => ({ date, ...v }));

    // Fraud breakdown
    const fraudList = fraudOpen.data ?? [];
    const fraudByRule: Record<string, number> = {};
    for (const f of fraudList) {
      const r = (f as any).rule_triggered || "unknown";
      fraudByRule[r] = (fraudByRule[r] || 0) + 1;
    }
    const fraudBreakdown = Object.entries(fraudByRule).map(([rule, count]) => ({ rule, count }));

    return json({
      kpis: {
        totalUsers,
        newUsers7d,
        activeToday,
        kycPending: kycPending.count ?? 0,
        totalTxnsToday,
        totalVolumeToday,
        fraudOpen: fraudList.length,
        successRate,
      },
      txnSeries,
      signupSeries,
      fraudBreakdown,
    });
  }

  // ----- Recent activity feed -----
  if (action === "recent_activity") {
    if (!can(me.role, "viewDashboard")) return json({ error: "forbidden" }, 403);
    const limit = Math.min(Number(body.limit ?? 30), 100);
    const [profiles, txns, kyc, fraud] = await Promise.all([
      sb.from("profiles").select("id,full_name,phone,created_at,kyc_status,onboarding_stage").order("created_at", { ascending: false }).limit(limit),
      sb.from("transactions").select("id,user_id,amount,merchant_name,status,created_at").order("created_at", { ascending: false }).limit(limit),
      sb.from("kyc_submissions").select("id,user_id,status,created_at,updated_at").order("updated_at", { ascending: false }).limit(limit),
      sb.from("fraud_logs").select("id,user_id,rule_triggered,created_at").order("created_at", { ascending: false }).limit(limit),
    ]);
    const items: Array<{ kind: string; ts: string; title: string; subtitle?: string; refId?: string }> = [];
    for (const p of profiles.data ?? []) {
      items.push({ kind: "user_new", ts: (p as any).created_at, title: "New user registered", subtitle: (p as any).full_name || (p as any).phone || (p as any).id, refId: (p as any).id });
    }
    for (const t of txns.data ?? []) {
      items.push({ kind: t.status === "failed" ? "txn_failed" : "txn_done", ts: (t as any).created_at, title: `${t.status === "failed" ? "Transaction failed" : "Transaction"} ₹${Number(t.amount).toFixed(2)}`, subtitle: t.merchant_name, refId: (t as any).id });
    }
    for (const k of kyc.data ?? []) {
      items.push({ kind: `kyc_${(k as any).status}`, ts: (k as any).updated_at || (k as any).created_at, title: `KYC ${(k as any).status}`, subtitle: (k as any).user_id, refId: (k as any).id });
    }
    for (const f of fraud.data ?? []) {
      items.push({ kind: "fraud", ts: (f as any).created_at, title: `Fraud rule: ${(f as any).rule_triggered}`, subtitle: (f as any).user_id, refId: (f as any).id });
    }
    items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return json({ items: items.slice(0, limit) });
  }

  // ----- Users list -----
  if (action === "users_list") {
    if (!can(me.role, "viewUsers")) return json({ error: "forbidden" }, 403);
    const search = String(body.search ?? "").trim();
    const kyc = String(body.kyc ?? "");
    const stage = String(body.stage ?? "");
    const page = Math.max(1, Number(body.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 25)));
    const sortKey = String(body.sortKey ?? "created_at");
    const sortDir = String(body.sortDir ?? "desc") === "asc";

    let q = sb.from("profiles").select("id,full_name,phone,dob,kyc_status,onboarding_stage,balance,created_at,aadhaar_last4,account_locked,account_tag", { count: "exact" });
    if (search) {
      const safe = search.replace(/[%,]/g, "");
      q = q.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,id.ilike.%${safe}%`);
    }
    if (kyc) q = q.eq("kyc_status", kyc as any);
    if (stage) q = q.eq("onboarding_stage", stage as any);
    const allowedSort = ["created_at", "full_name", "balance", "kyc_status"];
    const sk = allowedSort.includes(sortKey) ? sortKey : "created_at";
    q = q.order(sk, { ascending: sortDir });
    q = q.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);

    // get txn counts per user (best-effort, single query)
    const ids = (data ?? []).map((r: any) => r.id);
    let txnCounts: Record<string, number> = {};
    if (ids.length) {
      const { data: tx } = await sb.from("transactions").select("user_id").in("user_id", ids);
      for (const r of tx ?? []) {
        const uid = (r as any).user_id;
        txnCounts[uid] = (txnCounts[uid] || 0) + 1;
      }
    }
    const rows = (data ?? []).map((r: any) => ({ ...r, txn_count: txnCounts[r.id] || 0 }));
    return json({ rows, total: count ?? 0, page, pageSize });
  }

  // ----- User detail -----
  if (action === "user_get") {
    if (!can(me.role, "viewUsers")) return json({ error: "forbidden" }, 403);
    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "missing_userId" }, 400);
    const [profile, txns, kyc, fraud, parental] = await Promise.all([
      sb.from("profiles").select("*").eq("id", userId).maybeSingle(),
      sb.from("transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
      sb.from("kyc_submissions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      sb.from("fraud_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      sb.from("parental_links").select("*").eq("teen_user_id", userId).maybeSingle(),
    ]);
    if (!profile.data) return json({ error: "not_found" }, 404);

    // audit trail for this user
    const { data: auditRows } = await sb
      .from("admin_audit_log")
      .select("id,admin_email,admin_role,action_type,created_at,new_value")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    await audit(me.id, me.email, me.role, "user_view", { target_id: userId });
    return json({
      profile: profile.data,
      transactions: txns.data ?? [],
      kyc: kyc.data ?? [],
      fraud: fraud.data ?? [],
      parental: parental.data ?? null,
      audit: auditRows ?? [],
    });
  }

  // ----- User status mutation (suspend / restore) -----
  if (action === "user_set_kyc") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const userId = String(body.userId ?? "");
    const newStatus = String(body.status ?? "");
    const reason = String(body.reason ?? "");
    if (!userId || !["not_started", "pending", "approved", "rejected"].includes(newStatus)) return json({ error: "invalid" }, 400);
    const { data: before } = await sb.from("profiles").select("kyc_status").eq("id", userId).maybeSingle();
    const { error } = await sb.from("profiles").update({ kyc_status: newStatus as any, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) return json({ error: error.message }, 500);
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "user_set_kyc", target_entity: "profiles", target_id: userId,
      old_value: before as any, new_value: { kyc_status: newStatus, reason } as any,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }

  // ----- KYC list (cursor-based pagination) -----
  // Cursor pagination uses (created_at, id) as a stable composite cursor so that
  // realtime inserts between page loads don't cause duplicate or skipped rows.
  // Backwards-compatible: if `cursor` is omitted, behaves like a fresh first page.
  // Falls back to page-based pagination only if explicitly requested with `usePages: true`.
  if (action === "kyc_list") {
    if (!can(me.role, "viewKyc")) return json({ error: "forbidden" }, 403);
    const status = String(body.status ?? "pending");
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 25)));
    const cursor = body.cursor ? String(body.cursor) : null;       // ISO timestamp of last row's created_at
    const cursorId = body.cursorId ? String(body.cursorId) : null; // tiebreaker for identical timestamps

    // Always count for the current filter so the UI can show "X of Y loaded".
    let q = sb.from("kyc_submissions").select("*", { count: "exact" });
    if (status && status !== "all") q = q.eq("status", status as any);

    // Composite cursor: rows strictly AFTER (created_at, id) in ascending order.
    // We use OR with .gt for a tuple-style comparison: created_at > cursor
    // OR (created_at = cursor AND id > cursorId).
    if (cursor) {
      if (cursorId) {
        q = q.or(`created_at.gt.${cursor},and(created_at.eq.${cursor},id.gt.${cursorId})`);
      } else {
        q = q.gt("created_at", cursor);
      }
    }

    q = q.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(pageSize);
    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    let profileMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await sb.from("profiles").select("id,full_name,phone,dob,kyc_status,aadhaar_last4").in("id", userIds);
      for (const p of profs ?? []) profileMap[(p as any).id] = p;
    }
    const rows = (data ?? []).map((r: any) => ({ ...r, profile: profileMap[r.user_id] || null }));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === pageSize && last ? last.created_at : null;
    const nextCursorId = rows.length === pageSize && last ? last.id : null;
    return json({ rows, total: count ?? 0, pageSize, nextCursor, nextCursorId });
  }

  // ----- KYC signed URLs (selfie + Aadhaar docs) for admin review -----
  if (action === "kyc_signed_urls") {
    if (!can(me.role, "viewKyc")) return json({ error: "forbidden" }, 403);
    const submissionId = String(body.submissionId ?? "");
    if (!submissionId) return json({ error: "invalid" }, 400);
    const { data: sub } = await sb.from("kyc_submissions")
      .select("id,selfie_path,doc_front_path,doc_back_path")
      .eq("id", submissionId).maybeSingle();
    if (!sub) return json({ error: "not_found" }, 404);
    const out: { selfieUrl: string | null; docFrontUrl: string | null; docBackUrl: string | null } = {
      selfieUrl: null, docFrontUrl: null, docBackUrl: null,
    };
    const sign = async (p: string | null) => {
      if (!p) return null;
      const { data } = await sb.storage.from("kyc-docs").createSignedUrl(p, 60 * 10);
      return data?.signedUrl ?? null;
    };
    out.selfieUrl = await sign((sub as any).selfie_path);
    out.docFrontUrl = await sign((sub as any).doc_front_path);
    out.docBackUrl = await sign((sub as any).doc_back_path);
    return json(out);
  }

  // ----- KYC submission action history (timeline of admin decisions) -----
  // Reads admin_audit_log rows targeting this kyc_submissions id and joins to
  // admin_users to surface the reviewer's display name. Returns most recent first.
  if (action === "kyc_history") {
    if (!can(me.role, "viewKyc")) return json({ error: "forbidden" }, 403);
    const submissionId = String(body.submissionId ?? "");
    if (!submissionId) return json({ error: "invalid" }, 400);

    const { data: events, error: hErr } = await sb
      .from("admin_audit_log")
      .select("id,action_type,admin_id,admin_email,admin_role,old_value,new_value,created_at,ip_address")
      .eq("target_entity", "kyc_submissions")
      .eq("target_id", submissionId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (hErr) return json({ error: hErr.message }, 500);

    const adminIds = Array.from(new Set((events ?? []).map((e: any) => e.admin_id).filter(Boolean)));
    let nameMap: Record<string, string> = {};
    if (adminIds.length) {
      const { data: admins } = await sb.from("admin_users").select("id,name").in("id", adminIds);
      for (const a of admins ?? []) nameMap[(a as any).id] = (a as any).name;
    }
    const rows = (events ?? []).map((e: any) => ({
      id: e.id,
      actionType: e.action_type,
      adminId: e.admin_id,
      adminEmail: e.admin_email,
      adminName: e.admin_id ? nameMap[e.admin_id] ?? null : null,
      adminRole: e.admin_role,
      decision: (e.new_value && typeof e.new_value === "object") ? (e.new_value as any).decision ?? null : null,
      reason: (e.new_value && typeof e.new_value === "object") ? (e.new_value as any).reason ?? null : null,
      previousStatus: (e.old_value && typeof e.old_value === "object") ? (e.old_value as any).sub_status ?? null : null,
      ip: e.ip_address ?? null,
      at: e.created_at,
    }));
    return json({ rows });
  }

  // ----- KYC decide (approve / reject / escalate) -----
  if (action === "kyc_decide") {
    if (!can(me.role, "decideKyc")) return json({ error: "forbidden" }, 403);
    const submissionId = String(body.submissionId ?? "");
    const decision = String(body.decision ?? ""); // approved | rejected
    const reason = String(body.reason ?? "");
    if (!submissionId || !["approved", "rejected"].includes(decision)) return json({ error: "invalid" }, 400);

    const { data: sub } = await sb.from("kyc_submissions").select("*").eq("id", submissionId).maybeSingle();
    if (!sub) return json({ error: "not_found" }, 404);

    // Idempotency guard — repeated taps on Approve/Reject should be a no-op once
    // a terminal decision is recorded. Prevents duplicate notifications, duplicate
    // audit rows, and accidental reason overwrites.
    const currentStatus = String((sub as any).status ?? "");
    if (currentStatus === "approved" || currentStatus === "rejected") {
      if (currentStatus === decision) {
        return json({ ok: true, idempotent: true, status: currentStatus });
      }
      // A different terminal decision was already recorded — refuse to flip.
      return json({ error: "already_decided", status: currentStatus }, 409);
    }

    const nowIso = new Date().toISOString();
    // Conditional update — only flip from non-terminal status. If a concurrent
    // request reached the row first, this update affects 0 rows and we bail.
    const { data: updatedRows, error: e1 } = await sb.from("kyc_submissions")
      .update({ status: decision as any, reason: reason || null, updated_at: nowIso })
      .eq("id", submissionId)
      .not("status", "in", "(approved,rejected)")
      .select("id");
    if (e1) return json({ error: e1.message }, 500);
    if (!updatedRows || updatedRows.length === 0) {
      // Lost the race — fetch the now-terminal status and return idempotent.
      const { data: latest } = await sb.from("kyc_submissions").select("status").eq("id", submissionId).maybeSingle();
      return json({ ok: true, idempotent: true, status: (latest as any)?.status ?? currentStatus });
    }

    const { data: beforeProfile } = await sb.from("profiles").select("kyc_status,onboarding_stage").eq("id", (sub as any).user_id).maybeSingle();
    const profileUpdate: Record<string, unknown> = { kyc_status: decision as any, updated_at: nowIso };
    if (decision === "approved") profileUpdate.onboarding_stage = "STAGE_5";
    await sb.from("profiles").update(profileUpdate).eq("id", (sub as any).user_id);

    // Notify user
    await sb.from("notifications").insert({
      user_id: (sub as any).user_id,
      type: decision === "approved" ? "kyc_approved" : "kyc_rejected",
      title: decision === "approved" ? "KYC approved 🎉" : "KYC rejected",
      body: decision === "approved" ? "Your account is now active." : (reason || "Please retry your KYC submission."),
    });

    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "kyc_decide", target_entity: "kyc_submissions", target_id: submissionId,
      old_value: { sub_status: (sub as any).status, profile: beforeProfile } as any,
      new_value: { decision, reason } as any,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }

  // ----- Transactions list -----
  if (action === "transactions_list") {
    if (!can(me.role, "viewTransactions")) return json({ error: "forbidden" }, 403);
    const search = String(body.search ?? "").trim();
    const status = String(body.status ?? "");
    const minAmount = Number(body.minAmount ?? 0);
    const maxAmount = Number(body.maxAmount ?? 0);
    const flagged = body.flagged === true;
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? "");
    const page = Math.max(1, Number(body.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 25)));

    let q = sb.from("transactions").select("*", { count: "exact" });
    if (search) {
      const safe = search.replace(/[%,]/g, "");
      q = q.or(`merchant_name.ilike.%${safe}%,upi_id.ilike.%${safe}%,user_id.ilike.%${safe}%,id.ilike.%${safe}%`);
    }
    if (status) q = q.eq("status", status as any);
    if (minAmount > 0) q = q.gte("amount", minAmount);
    if (maxAmount > 0) q = q.lte("amount", maxAmount);
    if (fromDate) q = q.gte("created_at", fromDate);
    if (toDate) q = q.lte("created_at", toDate);
    if (flagged) q = q.neq("fraud_flags", "[]");
    q = q.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    let profileMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await sb.from("profiles").select("id,full_name,phone").in("id", userIds);
      for (const p of profs ?? []) profileMap[(p as any).id] = p;
    }
    const rows = (data ?? []).map((r: any) => ({ ...r, profile: profileMap[r.user_id] || null }));

    // aggregates over the filtered set (current page only — cheap)
    const totalAmount = rows.reduce((acc: number, r: any) => acc + Number(r.amount || 0), 0);
    const successCount = rows.filter((r: any) => r.status === "success").length;
    return json({ rows, total: count ?? 0, page, pageSize, pageVolume: totalAmount, pageSuccess: successCount });
  }

  // ----- Transaction reverse / mark investigated -----
  if (action === "transaction_reverse") {
    if (!can(me.role, "manageTransactions")) return json({ error: "forbidden" }, 403);
    const txnId = String(body.txnId ?? "");
    const reason = String(body.reason ?? "");
    if (!txnId || !reason) return json({ error: "invalid" }, 400);
    const { data: tx } = await sb.from("transactions").select("*").eq("id", txnId).maybeSingle();
    if (!tx) return json({ error: "not_found" }, 404);
    if ((tx as any).status === "failed") return json({ error: "already_failed" }, 400);

    const { error } = await sb.from("transactions").update({ status: "failed" as any }).eq("id", txnId);
    if (error) return json({ error: error.message }, 500);

    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "transaction_reverse", target_entity: "transactions", target_id: txnId,
      old_value: { status: (tx as any).status } as any,
      new_value: { status: "failed", reason } as any,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }


  // ----- Bulk KYC decide -----
  if (action === "kyc_decide_bulk") {
    if (!can(me.role, "decideKyc")) return json({ error: "forbidden" }, 403);
    const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.filter((x: unknown) => typeof x === "string") : [];
    const decision = String(body.decision ?? "");
    const reason = String(body.reason ?? "");
    if (!userIds.length || !["approved", "rejected"].includes(decision)) return json({ error: "invalid" }, 400);
    if (userIds.length > 200) return json({ error: "too_many" }, 400);

    const nowIso = new Date().toISOString();
    let ok = 0; let fail = 0; let skipped = 0;
    for (const uid of userIds) {
      try {
        // Find latest pending submission, if any
        const { data: sub } = await sb.from("kyc_submissions")
          .select("id,status").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
        // Idempotency — skip users whose latest submission is already in this state
        if (sub && (sub as any).status === decision) { skipped += 1; continue; }
        if (sub && ((sub as any).status === "approved" || (sub as any).status === "rejected")) {
          // Already at a different terminal state — don't flip, count as skipped.
          skipped += 1; continue;
        }
        if (sub) {
          const { data: updatedRows } = await sb.from("kyc_submissions")
            .update({ status: decision as any, reason: reason || null, updated_at: nowIso })
            .eq("id", (sub as any).id)
            .not("status", "in", "(approved,rejected)")
            .select("id");
          if (!updatedRows || updatedRows.length === 0) { skipped += 1; continue; }
        }
        const profileUpdate: Record<string, unknown> = { kyc_status: decision as any, updated_at: nowIso };
        if (decision === "approved") profileUpdate.onboarding_stage = "STAGE_5";
        await sb.from("profiles").update(profileUpdate).eq("id", uid);
        await sb.from("notifications").insert({
          user_id: uid,
          type: decision === "approved" ? "kyc_approved" : "kyc_rejected",
          title: decision === "approved" ? "KYC approved 🎉" : "KYC rejected",
          body: decision === "approved" ? "Your account is now active." : (reason || "Please retry your KYC submission."),
        });
        await sb.from("admin_audit_log").insert({
          admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
          action_type: "kyc_decide_bulk", target_entity: "profiles", target_id: uid,
          new_value: { decision, reason } as any,
          ip_address: ip, user_agent: ua,
        });
        ok += 1;
      } catch { fail += 1; }
    }
    return json({ ok: true, success: ok, failed: fail, skipped });
  }

  // ----- Fraud list -----
  if (action === "fraud_list") {
    if (!can(me.role, "viewFraud")) return json({ error: "forbidden" }, 403);
    const status = String(body.status ?? "open"); // open | resolved | all
    const rule = String(body.rule ?? "");
    const page = Math.max(1, Number(body.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 25)));

    let q = sb.from("fraud_logs").select("*", { count: "exact" });
    if (status === "open") q = q.is("resolution", null);
    else if (status === "resolved") q = q.not("resolution", "is", null);
    if (rule) q = q.eq("rule_triggered", rule);
    q = q.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    const txnIds = Array.from(new Set((data ?? []).map((r: any) => r.transaction_id).filter(Boolean)));
    const profMap: Record<string, any> = {};
    const txnMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await sb.from("profiles").select("id,full_name,phone").in("id", userIds);
      for (const p of profs ?? []) profMap[(p as any).id] = p;
    }
    if (txnIds.length) {
      const { data: txs } = await sb.from("transactions").select("id,amount,merchant_name,upi_id,status").in("id", txnIds);
      for (const t of txs ?? []) txnMap[(t as any).id] = t;
    }
    const rows = (data ?? []).map((r: any) => ({ ...r, profile: profMap[r.user_id] || null, transaction: r.transaction_id ? txnMap[r.transaction_id] || null : null }));

    // Summary aggregates
    const { data: allOpen } = await sb.from("fraud_logs").select("rule_triggered").is("resolution", null);
    const byRule: Record<string, number> = {};
    for (const r of allOpen ?? []) {
      const k = (r as any).rule_triggered || "unknown";
      byRule[k] = (byRule[k] || 0) + 1;
    }
    return json({ rows, total: count ?? 0, page, pageSize, openByRule: byRule, openTotal: (allOpen ?? []).length });
  }

  // ----- Fraud resolve -----
  if (action === "fraud_resolve") {
    if (!can(me.role, "manageFraud")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const resolution = String(body.resolution ?? "");
    if (!id || !resolution) return json({ error: "invalid" }, 400);
    const { data: before } = await sb.from("fraud_logs").select("*").eq("id", id).maybeSingle();
    if (!before) return json({ error: "not_found" }, 404);
    const { error } = await sb.from("fraud_logs").update({ resolution }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "fraud_resolve", target_entity: "fraud_logs", target_id: id,
      old_value: before as any, new_value: { resolution } as any,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }

  // ----- Audit log list -----
  if (action === "audit_log_list") {
    if (!can(me.role, "viewAuditLog")) return json({ error: "forbidden" }, 403);
    const adminEmail = String(body.adminEmail ?? "");
    const actionType = String(body.actionType ?? "");
    const page = Math.max(1, Number(body.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 50)));
    let q = sb.from("admin_audit_log").select("*", { count: "exact" });
    if (adminEmail) q = q.ilike("admin_email", `%${adminEmail}%`);
    if (actionType) q = q.eq("action_type", actionType);
    q = q.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data ?? [], total: count ?? 0, page, pageSize });
  }

  // ----- Settings: list admins -----
  if (action === "admins_list") {
    if (!can(me.role, "manageAdmins")) return json({ error: "forbidden" }, 403);
    const { data } = await sb.from("admin_users")
      .select("id,email,name,role,status,totp_enrolled,last_login_at,last_login_ip,failed_attempts,locked_until,created_at")
      .order("created_at", { ascending: false });
    return json({ rows: data ?? [] });
  }

  // ----- Settings: invite admin (creates pending row) -----
  if (action === "admin_invite") {
    if (!can(me.role, "manageAdmins")) return json({ error: "forbidden" }, 403);
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "");
    const validRoles = ["super_admin", "operations_manager", "compliance_officer", "customer_support", "fraud_analyst", "finance_manager"];
    if (!email || !name || !validRoles.includes(role)) return json({ error: "invalid" }, 400);
    if (!emailAllowed(email)) return json({ error: "email_not_allowed" }, 400);
    const { data: exists } = await sb.from("admin_users").select("id").eq("email", email).maybeSingle();
    if (exists) return json({ error: "already_exists" }, 409);
    const { data: created, error } = await sb.from("admin_users").insert({
      email, name, role: role as any, status: "pending",
    }).select("id,email,name,role,status").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "admin_invite", target_entity: "admin_users", target_id: (created as any)?.id,
      new_value: { email, name, role } as any, ip_address: ip, user_agent: ua,
    });
    return json({ ok: true, admin: created });
  }

  // ----- Settings: update admin (role / status) -----
  if (action === "admin_update") {
    if (!can(me.role, "manageAdmins")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const role = body.role ? String(body.role) : null;
    const status = body.status ? String(body.status) : null;
    if (!id) return json({ error: "invalid" }, 400);
    if (id === me.id && (status === "disabled" || status === "locked")) return json({ error: "cannot_disable_self" }, 400);
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (role) update.role = role;
    if (status) {
      update.status = status;
      if (status === "active") { update.failed_attempts = 0; update.locked_until = null; }
    }
    const { data: before } = await sb.from("admin_users").select("role,status").eq("id", id).maybeSingle();
    const { error } = await sb.from("admin_users").update(update).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "admin_update", target_entity: "admin_users", target_id: id,
      old_value: before as any, new_value: update as any, ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }

  // ----- Settings: reset MY TOTP (re-enroll). Requires fresh password confirmation. -----
  if (action === "totp_reset_self") {
    const password = String(body.password ?? "");
    if (!password) return json({ error: "password_required" }, 400);
    const { data: meRow } = await sb.from("admin_users").select("*").eq("id", me.id).maybeSingle<Admin>();
    if (!meRow || !meRow.password_hash) return json({ error: "invalid" }, 400);
    const ok = await verifyPassword(password, meRow.password_hash);
    if (!ok) return json({ error: "invalid_password" }, 401);
    const secret = base32Encode(randomBytes(20));
    await sb.from("admin_users").update({ totp_secret: secret, totp_enrolled: false }).eq("id", me.id);
    // Issue an enroll challenge
    const challengeToken = bytesToHex(randomBytes(32));
    const challengeHash = await sha256Hex("challenge:" + challengeToken);
    await sb.from("admin_sessions").insert({
      admin_id: me.id, session_token_hash: challengeHash,
      ip_address: ip, user_agent: ua,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const issuer = encodeURIComponent("Teen Wallet Admin");
    const label = encodeURIComponent(meRow.email);
    const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "totp_reset_self", target_entity: "admin_users", target_id: me.id,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true, challengeToken, otpauthUrl, secret });
  }

  // ----- Settings: super_admin force-resets another admin's TOTP -----
  if (action === "totp_reset_admin") {
    if (!can(me.role, "manageAdmins")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    if (!id) return json({ error: "invalid" }, 400);
    await sb.from("admin_users").update({ totp_secret: null, totp_enrolled: false, failed_attempts: 0, locked_until: null }).eq("id", id);
    await sb.from("admin_audit_log").insert({
      admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
      action_type: "totp_reset_admin", target_entity: "admin_users", target_id: id,
      ip_address: ip, user_agent: ua,
    });
    return json({ ok: true });
  }

  // ===============================================================
  // Issue reports (shake-to-report inbox)
  // ===============================================================
  if (action === "reports_list") {
    if (!can(me.role, "viewReports")) return json({ error: "forbidden" }, 403);
    const status = String(body.status ?? "all");           // all | open | resolved
    const category = String(body.category ?? "all");       // all | bug | feature | feedback | general
    const priority = String(body.priority ?? "all");       // all | low | normal | high | urgent
    const assigned = String(body.assigned ?? "all");       // all | mine | unassigned
    const route = String(body.route ?? "").trim();
    const sort = String(body.sort ?? "priority");          // priority | newest | activity
    const limit = Math.min(200, Math.max(10, Number(body.limit ?? 50)));

    // priority sort: urgent → high → normal → low, then by last_activity_at desc
    let q = sb.from("issue_reports")
      .select("id,user_id,category,status,priority,assigned_to_email,last_activity_at,message,route,user_agent,app_version,screenshot_path,camera_photo_path,console_errors,stack_trace,resolved_at,resolved_by_email,created_at", { count: "exact" })
      .limit(limit);

    if (sort === "newest") {
      q = q.order("created_at", { ascending: false });
    } else if (sort === "activity") {
      q = q.order("last_activity_at", { ascending: false });
    } else {
      // priority: order by enum text desc happens to give urgent/normal/low/high — use a CASE via .order on multiple fields
      // Postgres orders enums by their declared order: low(1), normal(2), high(3), urgent(4) → DESC = urgent first
      q = q.order("priority", { ascending: false }).order("last_activity_at", { ascending: false });
    }

    if (status !== "all") q = q.eq("status", status);
    if (category !== "all") q = q.eq("category", category);
    if (priority !== "all") q = q.eq("priority", priority);
    if (assigned === "mine") q = q.eq("assigned_to_email", me.email);
    else if (assigned === "unassigned") q = q.is("assigned_to_email", null);
    if (route) q = q.ilike("route", `%${route}%`);

    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data ?? [], total: count ?? 0 });
  }

  if (action === "reports_get") {
    if (!can(me.role, "viewReports")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    if (!id) return json({ error: "invalid" }, 400);
    const { data: report, error } = await sb.from("issue_reports").select("*").eq("id", id).maybeSingle();
    if (error || !report) return json({ error: "not_found" }, 404);

    const { data: notes } = await sb.from("issue_report_notes")
      .select("id,admin_email,body,created_at")
      .eq("report_id", id)
      .order("created_at", { ascending: true });

    const sign = async (p: string | null) => {
      if (!p) return null;
      const { data } = await sb.storage.from("issue-attachments").createSignedUrl(p, 60 * 10);
      return data?.signedUrl ?? null;
    };
    const screenshotUrl = await sign((report as any).screenshot_path);
    const cameraPhotoUrl = await sign((report as any).camera_photo_path);

    return json({ report, notes: notes ?? [], screenshotUrl, cameraPhotoUrl });
  }

  if (action === "reports_resolve") {
    if (!can(me.role, "manageReports")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const resolved = body.resolved !== false;  // default true
    if (!id) return json({ error: "invalid" }, 400);
    const update: Record<string, unknown> = resolved
      ? { status: "resolved", resolved_at: new Date().toISOString(), resolved_by_email: me.email }
      : { status: "open", resolved_at: null, resolved_by_email: null };
    const { error } = await sb.from("issue_reports").update(update).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, resolved ? "report_resolved" : "report_reopened", { reportId: id });
    return json({ ok: true });
  }

  if (action === "reports_set_priority") {
    if (!can(me.role, "manageReports")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const priority = String(body.priority ?? "");
    if (!id || !["low", "normal", "high", "urgent"].includes(priority)) {
      return json({ error: "invalid" }, 400);
    }
    const { error } = await sb.from("issue_reports").update({ priority }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "report_priority_set", { reportId: id, priority });
    return json({ ok: true });
  }

  if (action === "reports_assign") {
    if (!can(me.role, "manageReports")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const raw = body.assignee;
    const assignee = raw == null || raw === "" ? null : String(raw).trim().toLowerCase().slice(0, 200);
    if (!id) return json({ error: "invalid" }, 400);
    const { error } = await sb.from("issue_reports").update({ assigned_to_email: assignee }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, assignee ? "report_assigned" : "report_unassigned", { reportId: id, assignee });
    return json({ ok: true, assignee });
  }

  if (action === "reports_add_note") {
    if (!can(me.role, "manageReports")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    const text = String(body.body ?? "").trim();
    if (!id || !text) return json({ error: "invalid" }, 400);
    if (text.length > 2000) return json({ error: "too_long" }, 400);
    const { data, error } = await sb.from("issue_report_notes")
      .insert({ report_id: id, admin_email: me.email, body: text })
      .select("id,admin_email,body,created_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "report_note_added", { reportId: id });
    return json({ ok: true, note: data });
  }

  // ----- Users: bulk lock / unlock -----
  // Toggles profiles.account_locked. Audit row per user with optional note.
  if (action === "users_bulk_lock") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.filter((x: unknown) => typeof x === "string") : [];
    const lock = Boolean(body.lock);
    const note = String(body.note ?? "").slice(0, 500);
    if (!userIds.length) return json({ error: "invalid" }, 400);
    if (userIds.length > 200) return json({ error: "too_many" }, 400);

    let ok = 0; let fail = 0;
    for (const uid of userIds) {
      try {
        const { data: before } = await sb.from("profiles").select("account_locked").eq("id", uid).maybeSingle();
        if (!before) { fail += 1; continue; }
        if ((before as any).account_locked === lock) { ok += 1; continue; } // idempotent
        const { error: upErr } = await sb.from("profiles")
          .update({ account_locked: lock, updated_at: new Date().toISOString() })
          .eq("id", uid);
        if (upErr) { fail += 1; continue; }
        await sb.from("admin_audit_log").insert({
          admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
          action_type: lock ? "user_lock" : "user_unlock",
          target_entity: "profiles", target_id: uid,
          old_value: { account_locked: (before as any).account_locked } as any,
          new_value: { account_locked: lock, note } as any,
          ip_address: ip, user_agent: ua,
        });
        ok += 1;
      } catch { fail += 1; }
    }
    return json({ ok: true, success: ok, failed: fail });
  }

  // ----- Users: bulk set account tag (role-like grouping: standard | vip | watchlist) -----
  if (action === "users_bulk_tag") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.filter((x: unknown) => typeof x === "string") : [];
    const tag = String(body.tag ?? "");
    const note = String(body.note ?? "").slice(0, 500);
    const ALLOWED = ["standard", "vip", "watchlist"];
    if (!userIds.length || !ALLOWED.includes(tag)) return json({ error: "invalid" }, 400);
    if (userIds.length > 200) return json({ error: "too_many" }, 400);

    let ok = 0; let fail = 0;
    for (const uid of userIds) {
      try {
        const { data: before } = await sb.from("profiles").select("account_tag").eq("id", uid).maybeSingle();
        if (!before) { fail += 1; continue; }
        if ((before as any).account_tag === tag) { ok += 1; continue; }
        const { error: upErr } = await sb.from("profiles")
          .update({ account_tag: tag, updated_at: new Date().toISOString() })
          .eq("id", uid);
        if (upErr) { fail += 1; continue; }
        await sb.from("admin_audit_log").insert({
          admin_id: me.id, admin_email: me.email, admin_role: me.role as any,
          action_type: "user_tag_change",
          target_entity: "profiles", target_id: uid,
          old_value: { account_tag: (before as any).account_tag } as any,
          new_value: { account_tag: tag, note } as any,
          ip_address: ip, user_agent: ua,
        });
        ok += 1;
      } catch { fail += 1; }
    }
    return json({ ok: true, success: ok, failed: fail });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gender campaigns: targeted notifications + offers/rewards CRUD
  // ─────────────────────────────────────────────────────────────────────────
  if (action === "gender_notify_send") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const target = String(body.target ?? "");
    const title = String(body.title ?? "").trim().slice(0, 120);
    const bodyText = String(body.body ?? "").trim().slice(0, 500);
    if (!["boy", "girl", "all"].includes(target)) return json({ error: "invalid_target" }, 400);
    if (!title) return json({ error: "title_required" }, 400);

    let q = sb.from("profiles").select("id");
    if (target === "boy") q = q.in("gender", ["boy", "male", "Male", "M"]);
    else if (target === "girl") q = q.in("gender", ["girl", "female", "Female", "F"]);
    const { data: users, error: uerr } = await q;
    if (uerr) return json({ error: uerr.message }, 500);

    const rows = (users ?? []).map((u: any) => ({
      user_id: u.id, type: "campaign", title, body: bodyText || null, read: false,
    }));
    if (rows.length) {
      // Chunk inserts to stay under PG payload limits
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error: ierr } = await sb.from("notifications").insert(chunk);
        if (ierr) return json({ error: ierr.message }, 500);
      }
    }
    await audit(me.id, me.email, me.role, "gender_notify_send", { target, sent: rows.length, title });
    return json({ ok: true, sent: rows.length });
  }

  if (action === "gender_offers_list") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const { data, error } = await sb.from("gender_offers").select("*").order("gender_target").order("sort_order");
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data ?? [] });
  }

  if (action === "gender_offers_create" || action === "gender_offers_update") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const payload = {
      gender_target: String(body.gender_target ?? ""),
      eyebrow: String(body.eyebrow ?? "").slice(0, 60),
      headline: String(body.headline ?? "").slice(0, 30),
      emphasis: String(body.emphasis ?? "").slice(0, 30),
      subtitle: String(body.subtitle ?? "").slice(0, 200),
      cta_label: String(body.cta_label ?? "Apply offer").slice(0, 30),
      accent: String(body.accent ?? "neutral"),
      active: Boolean(body.active),
      sort_order: Number(body.sort_order ?? 100),
    };
    if (!["boy", "girl", "all"].includes(payload.gender_target)) return json({ error: "invalid_target" }, 400);
    if (!["boy", "girl", "neutral"].includes(payload.accent)) return json({ error: "invalid_accent" }, 400);
    if (action === "gender_offers_create") {
      const { error } = await sb.from("gender_offers").insert(payload);
      if (error) return json({ error: error.message }, 500);
    } else {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "missing_id" }, 400);
      const { error } = await sb.from("gender_offers").update(payload).eq("id", id);
      if (error) return json({ error: error.message }, 500);
    }
    await audit(me.id, me.email, me.role, action, payload);
    return json({ ok: true });
  }

  if (action === "gender_offers_delete") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    if (!id) return json({ error: "missing_id" }, 400);
    const { error } = await sb.from("gender_offers").delete().eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "gender_offers_delete", { id });
    return json({ ok: true });
  }

  if (action === "gender_rewards_list") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const { data, error } = await sb.from("gender_rewards_rules").select("*").order("gender_target").order("sort_order");
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data ?? [] });
  }

  if (action === "gender_rewards_create" || action === "gender_rewards_update") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const payload = {
      gender_target: String(body.gender_target ?? ""),
      category: String(body.category ?? "").slice(0, 60),
      cashback_pct: Number(body.cashback_pct ?? 0),
      description: String(body.description ?? "").slice(0, 200),
      active: Boolean(body.active),
      sort_order: Number(body.sort_order ?? 100),
    };
    if (!["boy", "girl", "all"].includes(payload.gender_target)) return json({ error: "invalid_target" }, 400);
    if (payload.cashback_pct < 0 || payload.cashback_pct > 100) return json({ error: "invalid_pct" }, 400);
    if (action === "gender_rewards_create") {
      const { error } = await sb.from("gender_rewards_rules").insert(payload);
      if (error) return json({ error: error.message }, 500);
    } else {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "missing_id" }, 400);
      const { error } = await sb.from("gender_rewards_rules").update(payload).eq("id", id);
      if (error) return json({ error: error.message }, 500);
    }
    await audit(me.id, me.email, me.role, action, payload);
    return json({ ok: true });
  }

  if (action === "gender_rewards_delete") {
    if (!can(me.role, "manageUsers")) return json({ error: "forbidden" }, 403);
    const id = String(body.id ?? "");
    if (!id) return json({ error: "missing_id" }, 400);
    const { error } = await sb.from("gender_rewards_rules").delete().eq("id", id);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "gender_rewards_delete", { id });
    return json({ ok: true });
  }

  // ---------------------------------------------------------------
  // App Images library — admin-managed image slots that the app reads
  // at runtime. Anyone signed in as admin can read/write/delete.
  // ---------------------------------------------------------------
  if (action === "app_images_list") {
    const { data, error } = await sb
      .from("app_images")
      .select("*")
      .order("key");
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data ?? [] });
  }

  if (action === "app_images_upsert_meta") {
    // Create or rename a slot WITHOUT changing the image. Used to register
    // a new key (e.g. "promo.banner") with a friendly label/description.
    const key = String(body.key ?? "").trim();
    if (!key || !/^[a-z0-9._-]{1,64}$/.test(key)) return json({ error: "invalid_key" }, 400);
    const label = String(body.label ?? "").slice(0, 80);
    const description = String(body.description ?? "").slice(0, 240) || null;
    const alt = String(body.alt ?? "").slice(0, 200);
    if (!label) return json({ error: "missing_label" }, 400);
    const { error } = await sb
      .from("app_images")
      .upsert({ key, label, description, alt, updated_by_email: me.email }, { onConflict: "key" });
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "app_images_upsert_meta", { key, label });
    return json({ ok: true });
  }

  if (action === "app_images_upload") {
    // Replace the image for a given slot. Body: { key, alt?, fileBase64,
    // contentType, width?, height? }. The slot row is upserted on the way
    // through, so this also creates the slot if it didn't exist yet.
    const key = String(body.key ?? "").trim();
    if (!key || !/^[a-z0-9._-]{1,64}$/.test(key)) return json({ error: "invalid_key" }, 400);
    const contentType = String(body.contentType ?? "");
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowed.includes(contentType)) return json({ error: "unsupported_type" }, 400);
    const b64 = String(body.fileBase64 ?? "");
    if (!b64) return json({ error: "missing_file" }, 400);

    // Decode base64 → Uint8Array (Deno-safe).
    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return json({ error: "invalid_base64" }, 400);
    }
    const MAX_BYTES = 6 * 1024 * 1024; // 6 MB hard cap
    if (bytes.byteLength > MAX_BYTES) return json({ error: "file_too_large" }, 413);

    const ext = contentType === "image/jpeg" ? "jpg"
              : contentType === "image/png" ? "png"
              : contentType === "image/webp" ? "webp"
              : contentType === "image/gif" ? "gif"
              : "svg";
    // Cache-busting filename so a fresh upload doesn't get served from CDN.
    const path = `${key}/${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from("app-images").upload(path, bytes, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: pub } = sb.storage.from("app-images").getPublicUrl(path);
    const url = pub?.publicUrl ?? null;
    if (!url) return json({ error: "no_public_url" }, 500);

    // Existing slot? Preserve label/description; otherwise create fresh.
    const { data: existing } = await sb
      .from("app_images")
      .select("key,label,description,storage_path")
      .eq("key", key)
      .maybeSingle();

    const row = {
      key,
      label: existing?.label ?? (String(body.label ?? "") || key),
      description: existing?.description ?? (String(body.description ?? "") || null),
      url,
      storage_path: path,
      alt: String(body.alt ?? "").slice(0, 200) || (existing as any)?.alt || "",
      width: body.width != null ? Number(body.width) : null,
      height: body.height != null ? Number(body.height) : null,
      bytes: bytes.byteLength,
      content_type: contentType,
      updated_by_email: me.email,
      updated_at: new Date().toISOString(),
    };
    const { error: dbErr } = await sb
      .from("app_images")
      .upsert(row, { onConflict: "key" });
    if (dbErr) return json({ error: dbErr.message }, 500);

    // Best-effort: clean up the previous file so the bucket doesn't bloat.
    if (existing?.storage_path && existing.storage_path !== path) {
      await sb.storage.from("app-images").remove([existing.storage_path]).catch(() => {});
    }

    await audit(me.id, me.email, me.role, "app_images_upload", { key, bytes: bytes.byteLength, contentType });
    return json({ ok: true, url, key });
  }

  if (action === "app_images_clear") {
    // Removes the image (file + url) but keeps the slot entry so it can be
    // re-uploaded later. Use app_images_delete to drop the slot entirely.
    const key = String(body.key ?? "").trim();
    if (!key) return json({ error: "missing_key" }, 400);
    const { data: existing } = await sb
      .from("app_images")
      .select("storage_path")
      .eq("key", key)
      .maybeSingle();
    if (existing?.storage_path) {
      await sb.storage.from("app-images").remove([existing.storage_path]).catch(() => {});
    }
    const { error } = await sb
      .from("app_images")
      .update({ url: null, storage_path: null, bytes: null, width: null, height: null, content_type: null, updated_by_email: me.email })
      .eq("key", key);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "app_images_clear", { key });
    return json({ ok: true });
  }

  if (action === "app_images_delete") {
    const key = String(body.key ?? "").trim();
    if (!key) return json({ error: "missing_key" }, 400);
    const { data: existing } = await sb
      .from("app_images")
      .select("storage_path")
      .eq("key", key)
      .maybeSingle();
    if (existing?.storage_path) {
      await sb.storage.from("app-images").remove([existing.storage_path]).catch(() => {});
    }
    const { error } = await sb.from("app_images").delete().eq("key", key);
    if (error) return json({ error: error.message }, 500);
    await audit(me.id, me.email, me.role, "app_images_delete", { key });
    return json({ ok: true });
  }

  // ===============================================================
  // Admin notifications (in-console bell)
  // ===============================================================
  if (action === "admin_notifications_list") {
    const limit = Math.min(100, Math.max(5, Number(body.limit ?? 30)));
    const { data, error } = await sb
      .from("admin_notifications")
      .select("id,type,priority,title,body,link,read,created_at")
      .eq("admin_id", me.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return json({ error: error.message }, 500);
    const { count } = await sb
      .from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .eq("admin_id", me.id)
      .eq("read", false);
    return json({ items: data ?? [], unread: count ?? 0 });
  }

  if (action === "admin_notifications_mark_read") {
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 200)
      : [];
    let q = sb.from("admin_notifications").update({ read: true }).eq("admin_id", me.id);
    if (ids.length) q = q.in("id", ids);
    const { error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});

