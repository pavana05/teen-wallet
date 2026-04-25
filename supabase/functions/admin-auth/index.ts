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
    if (!s || s.invalidated_at || new Date(s.expires_at) < new Date()) return null;
    const { data: a } = await sb.from("admin_users").select("id,email,name,role,status").eq("id", s.admin_id).maybeSingle();
    if (!a || a.status !== "active") return null;
    await sb.from("admin_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
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

    let q = sb.from("profiles").select("id,full_name,phone,dob,kyc_status,onboarding_stage,balance,created_at,aadhaar_last4", { count: "exact" });
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

  // ----- KYC list -----
  if (action === "kyc_list") {
    if (!can(me.role, "viewKyc")) return json({ error: "forbidden" }, 403);
    const status = String(body.status ?? "pending");
    const page = Math.max(1, Number(body.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(body.pageSize ?? 25)));

    let q = sb.from("kyc_submissions").select("*", { count: "exact" });
    if (status && status !== "all") q = q.eq("status", status as any);
    q = q.order("created_at", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    let profileMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await sb.from("profiles").select("id,full_name,phone,dob,kyc_status,aadhaar_last4").in("id", userIds);
      for (const p of profs ?? []) profileMap[(p as any).id] = p;
    }
    const rows = (data ?? []).map((r: any) => ({ ...r, profile: profileMap[r.user_id] || null }));
    return json({ rows, total: count ?? 0, page, pageSize });
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

    const nowIso = new Date().toISOString();
    const { error: e1 } = await sb.from("kyc_submissions")
      .update({ status: decision as any, reason: reason || null, updated_at: nowIso })
      .eq("id", submissionId);
    if (e1) return json({ error: e1.message }, 500);

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
    let ok = 0; let fail = 0;
    for (const uid of userIds) {
      try {
        // Find latest pending submission, if any
        const { data: sub } = await sb.from("kyc_submissions")
          .select("id,status").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (sub) {
          await sb.from("kyc_submissions")
            .update({ status: decision as any, reason: reason || null, updated_at: nowIso })
            .eq("id", (sub as any).id);
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
    return json({ ok: true, success: ok, failed: fail });
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

  return json({ error: "unknown_action" }, 400);
});
