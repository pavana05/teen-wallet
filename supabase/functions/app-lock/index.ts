// App Lock backend — handles PIN setup/verification, biometric (WebAuthn) credential
// registration & verification, and lock-out enforcement.
//
// SECURITY:
// - PINs are NEVER stored in plaintext; we hash with PBKDF2-SHA256 (210k iterations).
// - All verification happens server-side with constant-time comparison + rate limiting.
// - After 5 failed attempts → 30s cooldown; 10 → 5m; 15 → 30m. Counter resets on success.
// - Biometric: full WebAuthn attestation + assertion verification using
//   @simplewebauthn/server. The server issues a single-use challenge, stores it
//   bound to the user + purpose with a short TTL, and cryptographically verifies
//   the signed assertion against the registered public key on every unlock.
//   Sign-count is monotonically enforced to detect cloned authenticators.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@10.0.1";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "npm:@simplewebauthn/types@10.0.0";

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
  | "biometric_register_options"
  | "biometric_register_verify"
  | "biometric_auth_options"
  | "biometric_auth_verify"
  | "remove_biometric"
  | "disable"
  | "update_settings";

interface Body {
  action: Action;
  pin?: string;
  current_pin?: string;
  new_pin?: string;
  rp_id?: string;
  origin?: string;
  attestation_response?: RegistrationResponseJSON;
  assertion_response?: AuthenticationResponseJSON;
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

function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function lockoutMsFor(attempts: number): number | null {
  if (attempts >= 15) return 30 * 60_000;
  if (attempts >= 10) return 5 * 60_000;
  if (attempts >= 5) return 30_000;
  return null;
}

// Validate that the rp_id sent by the client is consistent with the request origin.
// The browser already enforces RP ID = same registrable domain as origin, but we
// double-check server-side to prevent a malicious caller from claiming a foreign RP.
function rpIdAllowedForOrigin(rpId: string, origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return false;
    return u.hostname === rpId || u.hostname.endsWith("." + rpId);
  } catch {
    return false;
  }
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

      // ===== Biometric (WebAuthn) — full signature verification =====

      case "biometric_register_options": {
        if (!row?.app_lock_enabled || !row?.pin_hash) {
          return json({ error: "Set up a PIN before enrolling biometric" }, 400);
        }
        if (typeof body.rp_id !== "string" || typeof body.origin !== "string") {
          return json({ error: "rp_id and origin required" }, 400);
        }
        if (!rpIdAllowedForOrigin(body.rp_id, body.origin)) {
          return json({ error: "rp_id does not match origin" }, 400);
        }
        const options = await generateRegistrationOptions({
          rpName: "Teen Wallet",
          rpID: body.rp_id,
          userID: new TextEncoder().encode(userId),
          userName: u.user.email ?? u.user.phone ?? userId,
          userDisplayName: "Teen Wallet User",
          attestationType: "none",
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          supportedAlgorithmIDs: [-7, -257],
          timeout: 60_000,
        });
        await admin.from("user_security").upsert({
          user_id: userId,
          webauthn_challenge: options.challenge,
          webauthn_challenge_purpose: "register",
          webauthn_challenge_expires_at: new Date(now + 5 * 60_000).toISOString(),
        }, { onConflict: "user_id" });
        return json({ options });
      }

      case "biometric_register_verify": {
        if (!row?.webauthn_challenge || row.webauthn_challenge_purpose !== "register") {
          return json({ error: "No active registration challenge" }, 400);
        }
        if (!row.webauthn_challenge_expires_at || new Date(row.webauthn_challenge_expires_at).getTime() < now) {
          return json({ error: "Challenge expired" }, 400);
        }
        if (!body.attestation_response || typeof body.rp_id !== "string" || typeof body.origin !== "string") {
          return json({ error: "Missing attestation_response/rp_id/origin" }, 400);
        }
        if (!rpIdAllowedForOrigin(body.rp_id, body.origin)) {
          return json({ error: "rp_id does not match origin" }, 400);
        }
        let verification;
        try {
          verification = await verifyRegistrationResponse({
            response: body.attestation_response,
            expectedChallenge: row.webauthn_challenge,
            expectedOrigin: body.origin,
            expectedRPID: body.rp_id,
            requireUserVerification: true,
          });
        } catch (e) {
          return json({ error: "Attestation verification failed: " + (e as Error).message }, 401);
        }
        if (!verification.verified || !verification.registrationInfo) {
          return json({ error: "Attestation not verified" }, 401);
        }
        const info = verification.registrationInfo;
        await admin.from("user_security").update({
          biometric_credential_id: bufToB64url(info.credentialID),
          biometric_public_key: bufToB64url(info.credentialPublicKey),
          biometric_sign_count: info.counter ?? 0,
          biometric_transports: body.attestation_response.response?.transports ?? null,
          biometric_aaguid: info.aaguid ?? null,
          webauthn_challenge: null,
          webauthn_challenge_purpose: null,
          webauthn_challenge_expires_at: null,
        }).eq("user_id", userId);
        return json({ ok: true, credential_id: bufToB64url(info.credentialID) });
      }

      case "biometric_auth_options": {
        if (!row?.biometric_credential_id || !row?.biometric_public_key) {
          return json({ error: "Biometric not enrolled" }, 400);
        }
        if (isLockedOut) return json({ error: "Too many attempts", locked_until: row.locked_until }, 429);
        if (typeof body.rp_id !== "string" || typeof body.origin !== "string") {
          return json({ error: "rp_id and origin required" }, 400);
        }
        if (!rpIdAllowedForOrigin(body.rp_id, body.origin)) {
          return json({ error: "rp_id does not match origin" }, 400);
        }
        const options = await generateAuthenticationOptions({
          rpID: body.rp_id,
          userVerification: "required",
          allowCredentials: [{
            id: b64urlToBytes(row.biometric_credential_id),
            type: "public-key",
            transports: row.biometric_transports ?? undefined,
          }],
          timeout: 60_000,
        });
        await admin.from("user_security").update({
          webauthn_challenge: options.challenge,
          webauthn_challenge_purpose: "auth",
          webauthn_challenge_expires_at: new Date(now + 2 * 60_000).toISOString(),
        }).eq("user_id", userId);
        return json({ options });
      }

      case "biometric_auth_verify": {
        if (!row?.biometric_credential_id || !row?.biometric_public_key) {
          return json({ error: "Biometric not enrolled" }, 400);
        }
        if (isLockedOut) return json({ error: "Too many attempts", locked_until: row.locked_until }, 429);
        if (!row.webauthn_challenge || row.webauthn_challenge_purpose !== "auth") {
          return json({ error: "No active auth challenge" }, 400);
        }
        if (!row.webauthn_challenge_expires_at || new Date(row.webauthn_challenge_expires_at).getTime() < now) {
          return json({ error: "Challenge expired" }, 400);
        }
        if (!body.assertion_response || typeof body.rp_id !== "string" || typeof body.origin !== "string") {
          return json({ error: "Missing assertion_response/rp_id/origin" }, 400);
        }
        if (!rpIdAllowedForOrigin(body.rp_id, body.origin)) {
          return json({ error: "rp_id does not match origin" }, 400);
        }
        // The assertion's rawId must match the registered credential.
        if (body.assertion_response.id !== row.biometric_credential_id
            && body.assertion_response.rawId !== row.biometric_credential_id) {
          return json({ error: "Unknown credential" }, 401);
        }

        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response: body.assertion_response,
            expectedChallenge: row.webauthn_challenge,
            expectedOrigin: body.origin,
            expectedRPID: body.rp_id,
            authenticator: {
              credentialID: b64urlToBytes(row.biometric_credential_id),
              credentialPublicKey: b64urlToBytes(row.biometric_public_key),
              counter: Number(row.biometric_sign_count ?? 0),
            },
            requireUserVerification: true,
          });
        } catch (e) {
          // Cryptographic failure — count as a failed attempt + clear challenge.
          const attempts = (row.failed_attempts ?? 0) + 1;
          const cooldown = lockoutMsFor(attempts);
          await admin.from("user_security").update({
            failed_attempts: attempts,
            locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
            webauthn_challenge: null,
            webauthn_challenge_purpose: null,
            webauthn_challenge_expires_at: null,
          }).eq("user_id", userId);
          return json({ error: "Biometric verification failed: " + (e as Error).message }, 401);
        }

        if (!verification.verified) {
          const attempts = (row.failed_attempts ?? 0) + 1;
          const cooldown = lockoutMsFor(attempts);
          await admin.from("user_security").update({
            failed_attempts: attempts,
            locked_until: cooldown ? new Date(now + cooldown).toISOString() : null,
            webauthn_challenge: null,
            webauthn_challenge_purpose: null,
            webauthn_challenge_expires_at: null,
          }).eq("user_id", userId);
          return json({ error: "Biometric verification failed" }, 401);
        }

        const newCounter = verification.authenticationInfo.newCounter;
        // Anti-cloning: counter must strictly increase (unless authenticator reports 0).
        const prevCounter = Number(row.biometric_sign_count ?? 0);
        if (newCounter !== 0 && newCounter <= prevCounter) {
          await admin.from("user_security").update({
            biometric_credential_id: null,
            biometric_public_key: null,
            biometric_sign_count: 0,
            biometric_transports: null,
            biometric_aaguid: null,
            webauthn_challenge: null,
            webauthn_challenge_purpose: null,
            webauthn_challenge_expires_at: null,
          }).eq("user_id", userId);
          return json({ error: "Authenticator counter regressed — biometric removed for safety" }, 401);
        }

        await admin.from("user_security").update({
          failed_attempts: 0,
          locked_until: null,
          biometric_sign_count: newCounter,
          webauthn_challenge: null,
          webauthn_challenge_purpose: null,
          webauthn_challenge_expires_at: null,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "remove_biometric": {
        await admin.from("user_security").update({
          biometric_credential_id: null,
          biometric_public_key: null,
          biometric_sign_count: 0,
          biometric_transports: null,
          biometric_aaguid: null,
          webauthn_challenge: null,
          webauthn_challenge_purpose: null,
          webauthn_challenge_expires_at: null,
        }).eq("user_id", userId);
        return json({ ok: true });
      }

      case "update_settings": {
        const updates: Record<string, unknown> = {};
        if (typeof body.auto_lock_seconds === "number") {
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
          biometric_transports: null,
          biometric_aaguid: null,
          webauthn_challenge: null,
          webauthn_challenge_purpose: null,
          webauthn_challenge_expires_at: null,
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
