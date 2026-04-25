// Parse UPI deep-link QR strings: upi://pay?pa=merchant@upi&pn=Name&am=10.00&cu=INR&tn=note
export interface UpiPayload {
  upiId: string;
  payeeName: string;
  amount: number | null;
  note: string | null;
  currency: string;
}

export function parseUpiQr(raw: string): UpiPayload | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("upi://")) {
    // Sometimes QR is just a UPI id like "merchant@bank"
    if (/^[a-z0-9._-]+@[a-z0-9._-]+$/i.test(trimmed)) {
      return { upiId: trimmed, payeeName: trimmed.split("@")[0], amount: null, note: null, currency: "INR" };
    }
    return null;
  }
  try {
    const url = new URL(trimmed.replace("upi://", "https://upi.local/"));
    const pa = url.searchParams.get("pa");
    if (!pa) return null;
    const am = url.searchParams.get("am");
    return {
      upiId: pa,
      payeeName: url.searchParams.get("pn") ?? pa.split("@")[0],
      amount: am ? Number(am) : null,
      note: url.searchParams.get("tn"),
      currency: url.searchParams.get("cu") ?? "INR",
    };
  } catch {
    return null;
  }
}
