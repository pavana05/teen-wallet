// Parse UPI deep-link QR strings + paytm-style + raw query params
// Supported inputs:
//   - upi://pay?pa=merchant@upi&pn=Name&am=10.00&cu=INR&tn=note
//   - UPI://PAY?... (case-insensitive scheme)
//   - paytmmp://pay?... or paytm://pay?... (paytm wallet QRs that mirror UPI keys)
//   - bharatpe://pay?...  (some merchant apps)
//   - https://*.bharatpe.com/qr?... and similar deep-links carrying pa/pn/am
//   - "pa=merchant@upi&pn=Name&am=10" (raw query string from a QR)
//   - bare VPA: "merchant@bank"
//
// Returns null when input cannot be coerced into a payable target.
// Use parseUpiQrWithReason() if you need a human-readable reason for failure.

export interface UpiPayload {
  upiId: string;
  payeeName: string;
  amount: number | null;
  note: string | null;
  currency: string;
}

export interface UpiParseResult {
  payload: UpiPayload | null;
  reason: string | null; // null on success
  matched: string | null; // which format matcher accepted it, for debugging
}

const VPA_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i;
const SUPPORTED_SCHEMES = ["upi", "paytmmp", "paytm", "bharatpe", "phonepe", "gpay", "tez"];

function buildPayload(params: URLSearchParams, matched: string): UpiParseResult {
  // Accept either `pa` (UPI standard) or `vpa`/`payeeVpa` (some merchants)
  const pa = params.get("pa") ?? params.get("vpa") ?? params.get("payeeVpa");
  if (!pa) {
    return { payload: null, reason: "Missing payee address (pa)", matched };
  }
  const cleanPa = pa.trim();
  if (!VPA_RE.test(cleanPa)) {
    return { payload: null, reason: `Invalid UPI ID format: "${cleanPa}"`, matched };
  }
  const amRaw = params.get("am") ?? params.get("amount");
  let amount: number | null = null;
  if (amRaw != null && amRaw !== "") {
    const n = Number(amRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { payload: null, reason: `Invalid amount: "${amRaw}"`, matched };
    }
    amount = n;
  }
  const pn = params.get("pn") ?? params.get("payeeName");
  return {
    payload: {
      upiId: cleanPa,
      payeeName: (pn ?? cleanPa.split("@")[0]).trim(),
      amount,
      note: params.get("tn") ?? params.get("note") ?? null,
      currency: params.get("cu") ?? "INR",
    },
    reason: null,
    matched,
  };
}

export function parseUpiQrWithReason(raw: string): UpiParseResult {
  if (!raw) return { payload: null, reason: "Empty QR", matched: null };
  const trimmed = raw.trim();

  // 1) Bare VPA — "merchant@bank"
  if (VPA_RE.test(trimmed)) {
    return {
      payload: {
        upiId: trimmed,
        payeeName: trimmed.split("@")[0],
        amount: null,
        note: null,
        currency: "INR",
      },
      reason: null,
      matched: "bare-vpa",
    };
  }

  // 2) Custom-scheme deep links (upi://, paytmmp://, paytm://, etc.)
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(\?.*)?$/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const query = schemeMatch[3] ?? "";
    if (SUPPORTED_SCHEMES.includes(scheme)) {
      try {
        // URLSearchParams handles "?pa=..." and "" (no params)
        const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
        return buildPayload(params, `${scheme}-scheme`);
      } catch {
        return { payload: null, reason: "Malformed deep-link query", matched: scheme };
      }
    }
    // 3) https/http deep-links from merchant apps that still carry pa/pn/am
    if (scheme === "http" || scheme === "https") {
      try {
        const u = new URL(trimmed);
        if (u.searchParams.get("pa") || u.searchParams.get("vpa")) {
          return buildPayload(u.searchParams, "https-deeplink");
        }
        return { payload: null, reason: "HTTPS QR doesn't contain UPI fields", matched: "https-deeplink" };
      } catch {
        return { payload: null, reason: "Malformed URL", matched: "https-deeplink" };
      }
    }
    return { payload: null, reason: `Unsupported scheme "${scheme}"`, matched: scheme };
  }

  // 4) Raw query string — "pa=...&pn=...&am=..."
  if (/(^|&)(pa|vpa)=/.test(trimmed)) {
    try {
      const params = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed);
      return buildPayload(params, "raw-query");
    } catch {
      return { payload: null, reason: "Malformed query string", matched: "raw-query" };
    }
  }

  return { payload: null, reason: "Not a UPI QR", matched: null };
}

// Backwards-compatible wrapper used across the app.
export function parseUpiQr(raw: string): UpiPayload | null {
  return parseUpiQrWithReason(raw).payload;
}
