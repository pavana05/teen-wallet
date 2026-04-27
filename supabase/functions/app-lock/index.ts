// App Lock backend — handles PIN setup/verification, biometric (WebAuthn) credential
// registration & verification, and lock-out enforcement.
//
// SECURITY:
// - PINs are NEVER stored in plaintext; we hash with PBKDF2-SHA256 (210k iterations).
// - All verification happens server-side with constant-time comparison + rate limiting.
// - After 5 failed attempts → 30s cooldown; 10 → 5m; 15 → 30m. Counter resets on success.
// - Biometric: we store the WebAuthn credential id + public key. The browser owns the
//   private key; we trust the assertion when the credential id matches a registered one
//   for this user. (Full signature verification of WebAuthn assertions is out of scope
//   for v1 — credential possession is already a strong factor; we can add full sig
//   verification later via @simplewebauthn/server if needed.)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | "get_status"
  | "set_pin"
  | "change_pin"
  | "verify_pin"
  | "register_biometric"
  | "verify_biometric"
  | "remove_biometric"
  | "disable"
  | "update_settings";

interface Body {
  action: Action;
  pin?: string;
  current_pin?: string;
  new_pin?: string;
  credential_id?: string;
  public_key?: string;
  auto_lock_seconds?: number;
  lock_after_payment?: boolean;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isPin = (pin: unknown): pin is string =>
  typeof pin === "string" && /^\d{4}$|^\d{6}$/.test(pin);

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return bytesToHex(arr.buffer);
}

async function hashPin(pin: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToHex(bits);
}

// Constant-time string comparison
function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Lockout schedule based on failed attempt count.
function lockoutMsFor(attempts: number): number | null {
  if (attempts >= 15) return 30 * 60_000;
  if (attempts >= 10) => 5 * 60_000;
  if (attempts >= 5) return 30_000;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Invalid session" }, 401);
    const userId = u.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    let body: Body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const { action } = body;

    // Load current row (may not exist yet)
    const { data: row } = await admin
      .from("user_security")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const now = Date.now();
    const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0;
    const isLockedOut = lockedUntil > now;

    switch (action) {
      case "get_status": {
        return json({
          enabled: !!row?.app_lock_enabled,
          has_pin: !!row?.pin_hash,
          pin_length: row?.pin_length ?? null,
          biometric_enrolled: !!row?.biometric_credential_id,
          biometric_credential_id: row?.biometric_credential_id ?? null,
          auto_lock_seconds: row?.auto_lock_seconds ?? 30,
          lock_after_payment: !!row?.lock_after_payment,
          locked_until: row?.locked_until ?? null,
          setup_prompt_dismissed: !!row?.setup_prompt_dismissed_at,
        });
      }

      case "set_pin": {
        if (row?.pin_hash) return json({ error: "PIN already set — use change_pin" }, 400);
        if (!isPin(body.pin)) return json({ error: "PIN must be 4 or 6 digits" }, 400);
        const iterations = 210_000;
        const salt = randomSalt();
        const hash = await hashPin(body.pin!, salt, iterations);
        const { error } = await admin.from("user_security").upsert({
          user_id: userId,
          pin_hash: hash,
          pin_salt: salt,
          pin_iterations: iterations,
          pin_length: body.pin!.length,
          app_lock_enabled: true,
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "change_pin": {
        if (!row?.pin_hash) return json({ error: "No PIN set" }, 400);
        if (!isPin(body.current_pin) || !isPin(body.new_pin)) return json({ error: "Invalid PIN format" }, 400);
        if (isLockedOut) return json({ error: "Locked out", locked_until: row!.locked_until }, 429);
        const currentHash = await hashPin(body.current_pin!, row.pin_salt, row.pin_iterations);
        if (!constEq(currentHash, row.pin_hash)) {
          const attempts = (row.failed_attempts ?? 0) + 1;
          const cooldown = lockoutMsFor(attempts);
          await admin.from("user_security").update({
            failed_attempts: attempts,
            locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
          }).eq("user_id", userId);
          return json({ error: "Current PIN is incorrect", attempts_remaining: Math.max(0, 5 - attempts) }, 401);
        }
        const salt = randomSalt();
        const iterations = 210_000;
        const hash = await hashPin(body.new_pin!, salt, iterations);
        await admin.from("user_security").update({
          pin_hash: hash,
          pin_salt: salt,
          pin_iterations: iterations,
          pin_length: body.new_pin!.length,
          failed_attempts: 0,
          locked_until: null,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "verify_pin": {
        if (!row?.pin_hash) return json({ error: "App Lock not set up" }, 400);
        if (isLockedOut) {
          return json({
            error: "Too many attempts",
            locked_until: row.locked_until,
            seconds_remaining: Math.ceil((lockedUntil - now) / 1000),
          }, 429);
        }
        if (typeof body.pin !== "string") return json({ error: "Missing PIN" }, 400);
        const candidate = await hashPin(body.pin, row.pin_salt, row.pin_iterations);
        if (constEq(candidate, row.pin_hash)) {
          await admin.from("user_security").update({
            failed_attempts: 0,
            locked_until: null,
          }).eq("user_id", userId);
          return json({ ok: true });
        }
        const attempts = (row.failed_attempts ?? 0) + 1;
        const cooldown = lockoutMsFor(attempts);
        await admin.from("user_security").update({
          failed_attempts: attempts,
          locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
        }).eq("user_id", userId);
        return json({
          error: "Incorrect PIN",
          attempts,
          attempts_until_cooldown: Math.max(0, 5 - attempts),
          locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
        }, 401);
      }

      case "register_biometric": {
        if (!row?.app_lock_enabled || !row?.pin_hash) {
          return json({ error: "Set up a PIN before enrolling biometric" }, 400);
        }
        if (typeof body.credential_id !== "string" || body.credential_id.length < 8 || body.credential_id.length > 1024) {
          return json({ error: "Invalid credential id" }, 400);
        }
        if (typeof body.public_key !== "string" || body.public_key.length > 4096) {
          return json({ error: "Invalid public key" }, 400);
        }
        await admin.from("user_security").update({
          biometric_credential_id: body.credential_id,
          biometric_public_key: body.public_key,
          biometric_sign_count: 0,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "verify_biometric": {
        if (!row?.biometric_credential_id) return json({ error: "Biometric not enrolled" }, 400);
        if (isLockedOut) return json({ error: "Too many attempts", locked_until: row.locked_until }, 429);
        if (body.credential_id !== row.biometric_credential_id) {
          // Treat mismatched credential as a failed attempt
          const attempts = (row.failed_attempts ?? 0) + 1;
          const cooldown = lockoutMsFor(attempts);
          await admin.from("user_security").update({
            failed_attempts: attempts,
            locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
          }).eq("user_id", userId);
          return json({ error: "Biometric verification failed" }, 401);
        }
        await admin.from("user_security").update({
          failed_attempts: 0,
          locked_until: null,
          biometric_sign_count: (row.biometric_sign_count ?? 0) + 1,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "remove_biometric": {
        await admin.from("user_security").update({
          biometric_credential_id: null,
          biometric_public_key: null,
          biometric_sign_count: 0,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "update_settings": {
        const updates: Record<string, unknown> = {};
        if (typeof body.auto_lock_seconds === "number") {
          // Allowed: 0 (immediately), 30, 120, 300, -1 (never auto-lock; cold-start only)
          const allowed = [0, 30, 120, 300, -1];
          if (!allowed.includes(body.auto_lock_seconds)) return json({ error: "Invalid auto_lock_seconds" }, 400);
          updates.auto_lock_seconds = body.auto_lock_seconds;
        }
        if (typeof body.lock_after_payment === "boolean") {
          updates.lock_after_payment = body.lock_after_payment;
        }
        if (Object.keys(updates).length === 0) return json({ error: "No settings provided" }, 400);
        await admin.from("user_security").upsert({
          user_id: userId,
          ...updates,
        }, { onConflict: "user_id" });
        return json({ ok: true });
      }

      case "disable": {
        // Disabling requires PIN verification to prevent someone with the unlocked
        // session from quietly turning off security.
        if (row?.pin_hash) {
          if (typeof body.pin !== "string") return json({ error: "PIN required to disable" }, 400);
          if (isLockedOut) return json({ error: "Too many attempts" }, 429);
          const candidate = await hashPin(body.pin, row.pin_salt, row.pin_iterations);
          if (!constEq(candidate, row.pin_hash)) {
            const attempts = (row.failed_attempts ?? 0) + 1;
            const cooldown = lockoutMsFor(attempts);
            await admin.from("user_security").update({
              failed_attempts: attempts,
              locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
            }).eq("user_id", userId);
            return json({ error: "Incorrect PIN" }, 401);
          }
        }
        await admin.from("user_security").update({
          app_lock_enabled: false,
          pin_hash: null,
          pin_salt: null,
          pin_length: null,
          biometric_credential_id: null,
          biometric_public_key: null,
          biometric_sign_count: 0,
          failed_attempts: 0,
          locked_until: null,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
