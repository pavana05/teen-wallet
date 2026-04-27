// PDF receipt generator for completed payments.
// Pulls saved transaction data and emits a clean A6-ish invoice that's easy
// to share via WhatsApp / email. Designed to look like a GPay-style receipt.
//
// Bilingual (en/hi) labels via @/lib/i18n + Indian-locale number formatting.
// Reference ID is also encoded as a QR on the PDF so anyone can scan and
// look it up without typing.
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { formatDateIN, formatINRPdf, getLang, t, type Lang } from "@/lib/i18n";

export interface ReceiptData {
  txnId: string;
  amount: number;
  payee: string;
  upiId: string;
  note?: string | null;
  status: "success" | "pending" | "failed";
  createdAt: string | Date;
  payerName?: string | null;
  payerPhone?: string | null;
}

const LIME = "#C8F135";
const INK = "#0B0B0B";
const MUTED = "#6b7280";

function shortRef(txnId: string) {
  return txnId.replace(/-/g, "").slice(0, 12).toUpperCase();
}

/**
 * Builds a PNG data URL of a QR encoding the reference ID. Sync version
 * works because qrcode supports a callback API; we promisify it.
 * Falls back to null on any failure so the PDF still renders without a QR.
 */
async function buildRefQrDataUrl(refId: string): Promise<string | null> {
  try {
    // QR module colors come from theme tokens (--qr-dark / --qr-light) so any
    // future theme adjustment flows through without touching this file.
    const { qrColors } = await import("@/lib/themeTokens");
    const { dark, light } = qrColors();
    return await QRCode.toDataURL(refId, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark, light },
    });
  } catch {
    return null;
  }
}

interface BuildOpts {
  lang?: Lang;
  qrDataUrl?: string | null;
}

function statusLabel(status: ReceiptData["status"], lang: Lang): string {
  if (status === "success") return t("success", lang);
  if (status === "pending") return t("pending", lang);
  return t("failed", lang);
}

function statusSubLabel(status: ReceiptData["status"], lang: Lang): string {
  if (status === "success") return t("paidSuccess", lang);
  if (status === "pending") return t("awaiting", lang);
  return t("paymentFailed", lang);
}

function buildPdfSync(data: ReceiptData, opts: BuildOpts = {}): jsPDF {
  const lang = opts.lang ?? getLang();

  // 105 × 200mm — receipt-ish portrait, fits one page neatly with QR room.
  const doc = new jsPDF({ unit: "mm", format: [105, 200] });
  const W = 105;
  let y = 0;

  // Header band
  doc.setFillColor(INK);
  doc.rect(0, 0, W, 36, "F");
  doc.setFillColor(LIME);
  doc.circle(14, 18, 5, "F");
  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TW", 14, 19.6, { align: "center" });

  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Teen Wallet", 24, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor("#9ca3af");
  // jsPDF's helvetica only ships Latin glyphs — Devanagari would render as
  // empty boxes. So the receipt header stays English even in `hi` mode and
  // the localised label moves into the body where we draw with Latin text
  // we control. (Full Devanagari support would mean shipping a TTF.)
  doc.text(t("receiptUpi", "en"), 24, 21);

  // Status badge top-right
  const ok = data.status === "success";
  doc.setFillColor(ok ? "#16a34a" : data.status === "pending" ? "#d97706" : "#dc2626");
  doc.roundedRect(W - 30, 11, 24, 9, 2, 2, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  // English-only badge — jsPDF helvetica can't draw Devanagari "सफल".
  doc.text(statusLabel(data.status, "en"), W - 18, 17, { align: "center" });

  y = 46;

  // Big amount (always Latin digits + "Rs " prefix because helvetica lacks ₹)
  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(formatINRPdf(data.amount), W / 2, y, { align: "center" });

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text(statusSubLabel(data.status, "en"), W / 2, y, { align: "center" });

  y += 8;
  doc.setDrawColor("#e5e7eb");
  doc.setLineWidth(0.2);
  doc.line(8, y, W - 8, y);

  y += 7;
  // We render rows with English labels (so the helvetica font can draw them).
  // When `lang === "hi"` we also draw the Hindi label below in a tiny grey
  // line — but ONLY if the chosen font supports the script. Since jsPDF's
  // bundled fonts don't, we keep the secondary label off the PDF and instead
  // expose it in the in-app receipt UI (which uses the system font stack).
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(label, 8, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(value, 60);
    doc.text(lines, W - 8, y, { align: "right" });
    y += Array.isArray(lines) ? Math.max(7, lines.length * 4 + 3) : 7;
  };

  row(t("paidTo", "en"), data.payee || "Unknown");
  row(t("upiId", "en"), data.upiId);
  if (data.note) row(t("note", "en"), data.note);
  row(t("dateTime", "en"), formatDateIN(data.createdAt, lang === "hi" ? "en" : "en"));
  row(t("refId", "en"), shortRef(data.txnId));
  if (data.payerName) row(t("paidBy", "en"), data.payerName);
  if (data.payerPhone) row(t("phone", "en"), data.payerPhone);

  y += 4;
  doc.setDrawColor("#e5e7eb");
  doc.line(8, y, W - 8, y);

  // ── QR block (reference ID) ─────────────────────────────────────────────
  // Skipped if QR generation failed for any reason.
  if (opts.qrDataUrl) {
    y += 6;
    const qrSize = 28;
    const qrX = (W - qrSize) / 2;
    try {
      doc.addImage(opts.qrDataUrl, "PNG", qrX, y, qrSize, qrSize);
    } catch {
      // ignore — addImage can throw on malformed data URL
    }
    y += qrSize + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    doc.text(t("scanToVerify", "en"), W / 2, y, { align: "center" });
    y += 3.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(INK);
    doc.text(shortRef(data.txnId), W / 2, y, { align: "center" });
  }

  // Footer
  const footerY = 192;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(t("systemGenerated", "en"), W / 2, footerY, { align: "center" });
  doc.text(t("brandTag", "en"), W / 2, footerY + 3.5, { align: "center" });

  return doc;
}

/**
 * Async builder that resolves once the QR PNG is rendered. Use this anywhere
 * that can `await`. Callers that need a synchronous code path (e.g. shipping
 * a one-shot util) can still call `buildPdfSync` directly with no QR.
 */
export async function buildReceiptPdf(data: ReceiptData, lang?: Lang): Promise<jsPDF> {
  const qr = await buildRefQrDataUrl(shortRef(data.txnId));
  return buildPdfSync(data, { lang, qrDataUrl: qr });
}

export async function downloadReceiptPdf(data: ReceiptData, lang?: Lang): Promise<void> {
  const doc = await buildReceiptPdf(data, lang);
  doc.save(`TeenWallet-${shortRef(data.txnId)}.pdf`);
}

/**
 * Try Web Share API with a PDF file attached. Falls back to download when the
 * runtime doesn't support file shares (most desktops, Firefox mobile, etc.).
 * Returns true if a share sheet was actually opened.
 */
export async function shareReceiptPdf(data: ReceiptData, lang?: Lang): Promise<boolean> {
  const doc = await buildReceiptPdf(data, lang);
  const blob = doc.output("blob");
  const filename = `TeenWallet-${shortRef(data.txnId)}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const shareText = `${t("receipt", lang ?? getLang())} · ${formatINRPdf(data.amount).replace("Rs ", "₹")} → ${data.payee} · Ref ${shortRef(data.txnId)}`;
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: t("receipt", lang ?? getLang()), text: shareText });
      return true;
    } catch {
      // user dismissed — don't fall back to download
      return false;
    }
  }
  // Fallback: trigger download
  doc.save(filename);
  return false;
}

/**
 * Build a plain-text summary of the receipt for sms:/mailto: bodies.
 * Kept short so SMS doesn't fragment into 3+ messages.
 */
export function buildReceiptSummary(data: ReceiptData, lang: Lang = getLang()): string {
  const lines = [
    `${t("receipt", lang)}: ₹${data.amount.toFixed(2)} → ${data.payee}`,
    `${t("upiId", lang)}: ${data.upiId}`,
    `${t("dateTime", lang)}: ${formatDateIN(data.createdAt, lang)}`,
    `${t("refId", lang)}: ${shortRef(data.txnId)}`,
  ];
  if (data.note) lines.push(`${t("note", lang)}: ${data.note}`);
  return lines.join("\n");
}
