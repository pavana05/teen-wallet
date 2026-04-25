// PDF receipt generator for completed payments.
// Pulls saved transaction data and emits a clean A6-ish invoice that's easy
// to share via WhatsApp / email. Designed to look like a GPay-style receipt.
import { jsPDF } from "jspdf";

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

function fmtDate(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortRef(txnId: string) {
  return txnId.replace(/-/g, "").slice(0, 12).toUpperCase();
}

export function buildReceiptPdf(data: ReceiptData): jsPDF {
  // 105 × 180mm — receipt-ish portrait, fits one page neatly.
  const doc = new jsPDF({ unit: "mm", format: [105, 180] });
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
  doc.text("Payment receipt · UPI", 24, 21);

  // Status badge top-right
  const ok = data.status === "success";
  doc.setFillColor(ok ? "#16a34a" : data.status === "pending" ? "#d97706" : "#dc2626");
  doc.roundedRect(W - 30, 11, 24, 9, 2, 2, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(data.status.toUpperCase(), W - 18, 17, { align: "center" });

  y = 46;

  // Big amount
  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(`Rs ${Number(data.amount).toFixed(2)}`, W / 2, y, { align: "center" });

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED);
  doc.text(ok ? "Paid successfully" : data.status === "pending" ? "Awaiting confirmation" : "Payment failed", W / 2, y, { align: "center" });

  y += 8;
  doc.setDrawColor("#e5e7eb");
  doc.setLineWidth(0.2);
  doc.line(8, y, W - 8, y);

  y += 7;
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

  row("Paid to", data.payee || "Unknown");
  row("UPI ID", data.upiId);
  if (data.note) row("Note", data.note);
  row("Date & time", fmtDate(data.createdAt));
  row("Reference ID", shortRef(data.txnId));
  if (data.payerName) row("Paid by", data.payerName);
  if (data.payerPhone) row("Phone", data.payerPhone);

  y += 4;
  doc.setDrawColor("#e5e7eb");
  doc.line(8, y, W - 8, y);

  // Footer
  y = 168;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text("This is a system-generated receipt.", W / 2, y, { align: "center" });
  y += 3.5;
  doc.text("Teen Wallet · Secured by UPI", W / 2, y, { align: "center" });

  return doc;
}

export function downloadReceiptPdf(data: ReceiptData) {
  const doc = buildReceiptPdf(data);
  doc.save(`TeenWallet-${shortRef(data.txnId)}.pdf`);
}

/**
 * Try Web Share API with a PDF file attached. Falls back to download when the
 * runtime doesn't support file shares (most desktops, Firefox mobile, etc.).
 * Returns true if a share sheet was actually opened.
 */
export async function shareReceiptPdf(data: ReceiptData): Promise<boolean> {
  const doc = buildReceiptPdf(data);
  const blob = doc.output("blob");
  const filename = `TeenWallet-${shortRef(data.txnId)}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Payment receipt", text: `Receipt · ₹${data.amount.toFixed(2)} to ${data.payee}` });
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
