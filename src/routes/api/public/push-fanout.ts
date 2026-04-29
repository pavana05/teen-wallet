import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// FCM HTTP v1: needs an OAuth2 access token from the service account.
// Service account JSON is stored in FCM_SERVICE_ACCOUNT_JSON.

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claim)
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600),
  };
  return json.access_token;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-webhook-secret",
};

export const Route = createFileRoute("/api/public/push-fanout")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        // Optional shared secret check (set both env + app_settings to enable)
        const expectedSecret = process.env.PUSH_WEBHOOK_SECRET ?? "";
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (expectedSecret && provided && provided !== expectedSecret) {
          return new Response("Unauthorized", { status: 401, headers: CORS });
        }

        let payload: {
          notification_id?: string;
          user_id?: string;
          type?: string;
          title?: string;
          body?: string;
        };
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: CORS });
        }

        if (!payload.notification_id) {
          return new Response("Missing notification_id", { status: 400, headers: CORS });
        }

        // Verify the notification actually exists — prevents spoofed pushes.
        const { data: notif, error: notifErr } = await supabaseAdmin
          .from("notifications")
          .select("id, user_id, type, title, body")
          .eq("id", payload.notification_id)
          .maybeSingle();
        if (notifErr || !notif) {
          return new Response("Notification not found", { status: 404, headers: CORS });
        }
        payload.user_id = notif.user_id;
        payload.title = notif.title;
        payload.body = notif.body ?? "";
        payload.type = notif.type;

        const { data: tokens, error: tokensErr } = await supabaseAdmin
          .from("device_tokens")
          .select("token, platform")
          .eq("user_id", payload.user_id);

        if (tokensErr) {
          console.error("device_tokens lookup failed", tokensErr);
          return new Response("DB error", { status: 500, headers: CORS });
        }
        if (!tokens || tokens.length === 0) {
          return new Response(JSON.stringify({ sent: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        const saRaw = process.env.FCM_SERVICE_ACCOUNT_JSON;
        if (!saRaw) {
          console.error("FCM_SERVICE_ACCOUNT_JSON not configured");
          return new Response("Not configured", { status: 500, headers: CORS });
        }
        let sa: ServiceAccount;
        try {
          sa = JSON.parse(saRaw) as ServiceAccount;
        } catch {
          return new Response("Bad service account JSON", { status: 500, headers: CORS });
        }

        const accessToken = await getAccessToken(sa);
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

        let sent = 0;
        const invalidTokens: string[] = [];

        await Promise.all(
          tokens.map(async (t) => {
            const message = {
              message: {
                token: t.token,
                notification: {
                  title: payload.title,
                  body: payload.body ?? "",
                },
                data: {
                  type: payload.type ?? "general",
                  notification_id: payload.notification_id ?? "",
                },
                android: {
                  priority: "HIGH",
                  notification: { channel_id: "default", sound: "default" },
                },
              },
            };
            try {
              const r = await fetch(fcmUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(message),
              });
              if (r.ok) {
                sent++;
              } else {
                const text = await r.text();
                if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(text)) {
                  invalidTokens.push(t.token);
                } else {
                  console.error("FCM send failed", r.status, text);
                }
              }
            } catch (e) {
              console.error("FCM request error", e);
            }
          })
        );

        if (invalidTokens.length > 0) {
          await supabaseAdmin
            .from("device_tokens")
            .delete()
            .in("token", invalidTokens);
        }

        return new Response(JSON.stringify({ sent }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      },
    },
  },
});
