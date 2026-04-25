# Sentry Setup Guide (Crash Reporting + Breadcrumbs)

Follow this once, then come back and tell me **"Sentry DSN ready"** — I'll wire up the SDK and add KYC/payment breadcrumbs in the next turn.

---

## 1. Create a Sentry account (free tier is enough to start)

1. Go to https://sentry.io/signup/
2. Sign up with email or GitHub
3. Plan: **Developer (Free)** — 5k errors/month, plenty for launch

---

## 2. Create the project

After login → **+ Create Project**

| Field | Value |
|---|---|
| Platform | **React** (not React Native — we ship a Capacitor WebView) |
| Alert frequency | "Alert me on every new issue" (recommended for launch) |
| Project name | `teen-wallet` |
| Team | default |

Click **Create Project**.

---

## 3. Grab your DSN

Sentry shows it on the next screen. It looks like:

```
https://abc123def456@o1234567.ingest.sentry.io/7654321
```

Copy that whole string. **This is what you'll paste into the secrets form** when I ask for it.

If you miss the screen: **Settings → Projects → teen-wallet → Client Keys (DSN)**.

---

## 4. (Optional but recommended) Configure release tracking

In Sentry → **Settings → Projects → teen-wallet → General Settings**:
- **Environment**: enable "Use environments" → we'll send `production` from the APK and `preview` from web.

In **Alerts → Issue Alerts**, add a rule:
- **WHEN**: A new issue is created
- **IF**: `environment` equals `production`
- **THEN**: Send an email to you

This way preview-build noise doesn't spam you.

---

## 5. (Optional) Source maps for readable stack traces

Without source maps, Sentry stack traces show minified gibberish like `a.b.c is not a function`. To get real file names + line numbers, you'll need to upload source maps as part of your build. I can wire this into `vite.config.ts` once we add the SDK — just mention it when you come back.

You'll need a **Sentry Auth Token** for that step:
- **Settings → Account → API → Auth Tokens → Create New Token**
- Scopes needed: `project:releases`, `org:read`, `project:read`

---

## What I'll do once you have the DSN

When you come back with the DSN (and optionally the auth token), I'll:

1. Install `@sentry/react`
2. Initialise it in `src/lib/native.ts` with the DSN, capturing:
   - Environment (`Capacitor.getPlatform()` — `web` / `android` / `ios`)
   - App version (from `package.json`)
   - User ID (after login, from Supabase session)
3. Add **breadcrumbs** at every important step:
   - `auth.otp_sent`, `auth.otp_verified`
   - `kyc.flow_started`, `kyc.aadhaar_submitted`, `kyc.selfie_captured`, `kyc.submitted`
   - `payment.scan_opened`, `payment.amount_entered`, `payment.fraud_check_passed`, `payment.submitted`, `payment.success`, `payment.failed`
4. Wrap the global error boundary to auto-capture unhandled exceptions
5. Add a `<presentation-add-secret>` for `VITE_SENTRY_DSN`

Total wire-up time: ~3 minutes once you have the DSN.

---

## Cost estimate

- Free tier: **5,000 errors + 10,000 performance events/month** — fine for launch traffic up to ~50k DAU with a stable app.
- If you exceed: $26/month for 50k errors. Most teen wallets sit comfortably in free tier for the first 6 months.
