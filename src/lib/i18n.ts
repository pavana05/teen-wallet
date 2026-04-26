// Lightweight Hindi/English label helper + Indian-locale number/date
// formatters. Persists the user's language choice in localStorage so both
// UI and PDF receipts stay consistent across sessions.
//
// Why a hand-rolled module instead of i18next:
//   • <30 strings to translate today
//   • Receipts run server-free with jspdf — no React context available
//   • Zero new deps keeps the bundle slim

export type Lang = "en" | "hi";

const KEY = "tw-lang-v1";

export function getLang(): Lang {
  if (typeof localStorage === "undefined") return "en";
  const v = localStorage.getItem(KEY);
  return v === "hi" ? "hi" : "en";
}

export function setLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* ignore quota */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tw-lang-changed", { detail: l }));
  }
}

// ── Translations ──────────────────────────────────────────────────────────
// Add keys as the receipt / payment surfaces grow. Keep keys short and
// english-as-source so callers stay readable.
const dict = {
  receipt:        { en: "Payment receipt",   hi: "भुगतान रसीद" },
  receiptUpi:     { en: "Payment receipt · UPI", hi: "भुगतान रसीद · UPI" },
  paidTo:         { en: "Paid to",           hi: "प्राप्तकर्ता" },
  upiId:          { en: "UPI ID",            hi: "UPI आईडी" },
  note:           { en: "Note",              hi: "टिप्पणी" },
  dateTime:       { en: "Date & time",       hi: "दिनांक और समय" },
  refId:          { en: "Reference ID",      hi: "रेफरेंस आईडी" },
  paidBy:         { en: "Paid by",           hi: "भुगतानकर्ता" },
  phone:          { en: "Phone",             hi: "फ़ोन" },
  amountPaid:     { en: "Amount paid",       hi: "भुगतान राशि" },
  paidSuccess:    { en: "Paid successfully", hi: "सफलतापूर्वक भुगतान हुआ" },
  awaiting:       { en: "Awaiting confirmation", hi: "पुष्टि की प्रतीक्षा" },
  paymentFailed:  { en: "Payment failed",    hi: "भुगतान विफल" },
  systemGenerated:{ en: "This is a system-generated receipt.", hi: "यह सिस्टम-जनित रसीद है।" },
  brandTag:       { en: "Teen Wallet · Secured by UPI", hi: "टीन वॉलेट · UPI द्वारा सुरक्षित" },
  scanToVerify:   { en: "Scan to verify",    hi: "सत्यापन हेतु स्कैन करें" },
  status:         { en: "Status",            hi: "स्थिति" },
  success:        { en: "SUCCESS",           hi: "सफल" },
  pending:        { en: "PENDING",           hi: "प्रक्रिया में" },
  failed:         { en: "FAILED",            hi: "विफल" },
} as const;

export type I18nKey = keyof typeof dict;

export function t(key: I18nKey, lang: Lang = getLang()): string {
  return dict[key][lang];
}

// ── Number / currency formatting ──────────────────────────────────────────
// Always en-IN locale (1,23,456.78 grouping with Indian lakh/crore). The
// digit script stays Latin in both languages because Indian banking apps
// universally render amounts in Latin digits — switching to Devanagari would
// hurt readability on a payment receipt.
const nfINR = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number): string {
  return `₹${nfINR.format(Number(amount) || 0)}`;
}

/** PDF-safe variant: jsPDF's built-in fonts don't ship the ₹ glyph. */
export function formatINRPdf(amount: number): string {
  return `Rs ${nfINR.format(Number(amount) || 0)}`;
}

// ── Date formatting ───────────────────────────────────────────────────────
// Indian short style: "26 Apr 2026, 03:42 pm". Hindi flips to hi-IN for
// month/weekday names while keeping the same shape.
export function formatDateIN(d: string | Date, lang: Lang = getLang()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
