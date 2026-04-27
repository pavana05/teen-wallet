import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Clock, Copy,
  Download, FileText, Hash, Mail, MessageCircle, Phone, Repeat, Share2, Sparkles,
  X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildReceiptSummary, downloadReceiptPdf, shareReceiptPdf, shareReceiptToWhatsApp,
  type ReceiptData,
} from "@/lib/receipt";
import {
  channelLabel, getLastDelivery, recordReceiptDelivery, relativeTime, statusLabel,
  type ReceiptDelivery,
} from "@/lib/receiptDelivery";
import { haptics } from "@/lib/haptics";

export interface TxnLike {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

interface Props {
  txn: TxnLike;
  /** True if this is an incoming credit (refund / cashback / top-up). */
  credit?: boolean;
  /** Wallet balance after this transaction settled (optional). */
  balanceAfter?: number;
  onClose: () => void;
  /** Optional pay-again handler — if omitted the button is hidden. */
  onPayAgain?: (t: TxnLike) => void;
}

function toReceipt(t: TxnLike): ReceiptData {
  return {
    txnId: t.id,
    amount: Number(t.amount),
    payee: t.merchant_name,
    upiId: t.upi_id,
    note: t.note,
    status: t.status,
    createdAt: t.created_at,
  };
}

function fmtINR(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Ultra-premium full-page transaction detail.
 * Renders as a lightbox over the phone shell with a multi-stage entrance:
 *   1) Backdrop fade-in with blur
 *   2) Sheet slide-up from the bottom
 *   3) Hero amount counts up
 *   4) Sections cascade in via staggered fade-up
 */
export function TransactionDetail({ txn, credit = false, balanceAfter, onClose, onPayAgain }: Props) {
  const [copied, setCopied] = useState(false);
  const [lastDelivery, setLastDelivery] = useState<ReceiptDelivery | null>(() => getLastDelivery(txn.id));

  useEffect(() => {
    void haptics.tap();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ReceiptDelivery>).detail;
      if (detail?.txnId === txn.id) setLastDelivery(detail);
    };
    window.addEventListener("tw-receipt-delivery", onChange);
    return () => window.removeEventListener("tw-receipt-delivery", onChange);
  }, [txn.id]);

  // Lock body scroll while the detail is open and close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const logDelivery = (channel: ReceiptDelivery["channel"], status: ReceiptDelivery["status"] = "attempted") => {
    setLastDelivery(recordReceiptDelivery(txn.id, channel, status));
  };

  const created = new Date(txn.created_at);
  const failed = txn.status === "failed";
  const pending = txn.status === "pending";
  const succeeded = txn.status === "success";
  const amt = Number(txn.amount);

  const dateLong = created.toLocaleString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const initials = useMemo(() => {
    const parts = txn.merchant_name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "•";
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }, [txn.merchant_name]);

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(txn.id);
      setCopied(true);
      void haptics.tap();
      toast.success("Reference ID copied");
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  const timeline = useMemo(() => {
    const items: { label: string; sub: string; tone: "ok" | "warn" | "bad" | "muted" }[] = [];
    items.push({ label: "Payment initiated", sub: dateLong, tone: "muted" });
    if (failed) {
      items.push({ label: "Payment failed", sub: "We couldn't complete this payment.", tone: "bad" });
    } else if (pending) {
      items.push({ label: "Awaiting bank confirmation", sub: "The recipient's bank is processing.", tone: "warn" });
    } else {
      items.push({ label: "Routed via UPI", sub: "Sent through the UPI rails.", tone: "muted" });
      items.push({ label: "Payment successful", sub: "Confirmed by the recipient bank.", tone: "ok" });
    }
    return items;
  }, [dateLong, failed, pending]);

  const StatusIcon = succeeded ? CheckCircle2 : pending ? Clock : XCircle;
  const statusTone = succeeded
    ? "text-emerald-300 bg-emerald-400/10 border-emerald-400/30"
    : pending
      ? "text-amber-300 bg-amber-400/10 border-amber-400/30"
      : "text-rose-300 bg-rose-400/10 border-rose-400/30";

  const heroTone = credit
    ? "from-emerald-400/25 via-emerald-400/5 to-transparent"
    : failed
      ? "from-rose-500/25 via-rose-500/5 to-transparent"
      : pending
        ? "from-amber-400/25 via-amber-400/5 to-transparent"
        : "from-[color:var(--premium-accent-glow,rgba(212,197,160,.35))] via-white/5 to-transparent";

  const sign = credit ? "+" : "−";
  const amountTone = credit
    ? "text-emerald-200"
    : failed
      ? "text-rose-300 line-through decoration-rose-400/60"
      : "text-white";

  return (
    <div
      className="td-root absolute inset-0 z-[120] flex flex-col bg-background overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="td-title"
    >
      {/* layered backdrop */}
      <div className="td-bg" aria-hidden />
      <div className={`td-aurora bg-gradient-to-b ${heroTone}`} aria-hidden />
      <div className="td-grid" aria-hidden />
      <div className="td-grain" aria-hidden />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
        <button
          onClick={() => { void haptics.tap(); onClose(); }}
          aria-label="Back to transactions"
          className="td-icon-btn"
        >
          <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
        </button>
        <h1 id="td-title" className="text-[13px] font-semibold text-white/85 tracking-[.18em] uppercase">
          Receipt
        </h1>
        <button onClick={onClose} aria-label="Close" className="td-icon-btn">
          <X className="w-4 h-4 text-white/85" strokeWidth={2} />
        </button>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto pb-10 px-5 td-scroll">
        {/* HERO */}
        <section className="td-hero td-cascade" style={{ ["--td-i" as string]: 0 }}>
          {/* avatar */}
          <div className="relative mx-auto mt-2">
            <div className="td-avatar">
              {credit
                ? <ArrowDownLeft className="w-7 h-7 text-emerald-200" strokeWidth={1.8} />
                : failed
                  ? <X className="w-7 h-7 text-rose-200" strokeWidth={2} />
                  : <span className="text-[18px] font-semibold tracking-wide">{initials}</span>}
            </div>
            <span className={`td-status-ring ${succeeded ? "td-ring-ok" : pending ? "td-ring-warn" : "td-ring-bad"}`} />
          </div>

          <p className="td-eyebrow mt-5">
            {credit ? "Received from" : failed ? "Attempted to" : pending ? "Pending payment to" : "Paid to"}
          </p>
          <h2 className="td-title">{txn.merchant_name}</h2>
          <p className="td-sub num-mono">{txn.upi_id}</p>

          {/* Amount */}
          <div className="td-amount-wrap mt-6">
            <span className={`td-amount-sign ${amountTone}`}>{sign}</span>
            <span className={`td-amount num-mono ${amountTone}`}>
              ₹{fmtINR(Math.abs(amt))}
            </span>
          </div>

          {/* Status pill */}
          <div className={`td-status mt-4 ${statusTone}`}>
            <StatusIcon className="w-3.5 h-3.5" strokeWidth={2.2} />
            <span className="text-[10.5px] font-semibold uppercase tracking-[.18em]">{txn.status}</span>
          </div>

          <p className="td-date mt-3">{dateLong}</p>
        </section>

        {/* Breakdown card */}
        <section className="td-card mt-6 td-cascade" style={{ ["--td-i" as string]: 1 }}>
          <p className="td-card-title">Payment breakdown</p>
          <div className="td-card-body">
            <BreakdownRow label="Subtotal" value={`₹${fmtINR(amt)}`} />
            <BreakdownRow label="Platform fee" value="₹0.00" sub="UPI is free for you" />
            <BreakdownRow label="GST" value="₹0.00" />
            <div className="td-divider" />
            <BreakdownRow
              label={failed ? "Total attempted" : credit ? "Total received" : "Total paid"}
              value={`₹${fmtINR(amt)}`}
              bold
            />
            {typeof balanceAfter === "number" && succeeded && (
              <BreakdownRow label="Wallet balance after" value={`₹${fmtINR(balanceAfter)}`} muted />
            )}
          </div>
        </section>

        {/* Reference ID */}
        <button
          onClick={copyRef}
          className="td-card td-card-btn mt-3 td-cascade"
          style={{ ["--td-i" as string]: 2 }}
          aria-label="Copy reference ID"
        >
          <div className="td-ref-icon">
            <Hash className="w-4 h-4 text-white/80" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="td-card-eyebrow">Reference ID</p>
            <p className="text-[12px] text-white/85 num-mono truncate mt-0.5">{txn.id}</p>
          </div>
          <span className={`td-copy-ind ${copied ? "td-copy-on" : ""}`}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </span>
        </button>

        {/* Note */}
        {txn.note && (
          <section className="td-card mt-3 td-cascade" style={{ ["--td-i" as string]: 3 }}>
            <div className="flex items-start gap-3">
              <div className="td-ref-icon">
                <FileText className="w-4 h-4 text-white/80" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="td-card-eyebrow">Note</p>
                <p className="text-[13px] text-white mt-0.5 break-words leading-relaxed">{txn.note}</p>
              </div>
            </div>
          </section>
        )}

        {/* Timeline */}
        <section className="td-card mt-3 td-cascade" style={{ ["--td-i" as string]: 4 }}>
          <p className="td-card-title flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Timeline
          </p>
          <ol className="relative pl-5 mt-3">
            <span className="td-timeline-rail" aria-hidden />
            {timeline.map((item, i) => (
              <li
                key={i}
                className="relative pb-4 last:pb-0 td-timeline-item"
                style={{ animationDelay: `${480 + i * 90}ms` }}
              >
                <span
                  className={`td-timeline-dot ${
                    item.tone === "ok" ? "td-dot-ok"
                    : item.tone === "bad" ? "td-dot-bad"
                    : item.tone === "warn" ? "td-dot-warn"
                    : "td-dot-muted"
                  }`}
                  aria-hidden
                />
                <p className="text-[13px] text-white font-medium leading-tight">{item.label}</p>
                <p className="text-[11px] text-white/55 mt-0.5">{item.sub}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Receipt actions */}
        {!pending && (
          <section className="mt-5 td-cascade" style={{ ["--td-i" as string]: 5 }}>
            <div className="flex items-center justify-between mb-2">
              <p className="td-section-eyebrow">
                <Sparkles className="w-3 h-3 inline -mt-0.5 mr-1" /> Receipt
              </p>
              {lastDelivery && (
                <p className="text-[10.5px] text-white/55" aria-live="polite">
                  Last:{" "}
                  <span className={lastDelivery.status === "failed" ? "text-rose-300" : "text-emerald-300"}>
                    {channelLabel(lastDelivery.channel)} · {statusLabel(lastDelivery.status)}
                  </span>{" "}
                  · {relativeTime(lastDelivery.attemptedAt)}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ReceiptBtn icon={Download} label="Download PDF" onClick={async () => {
                try { await downloadReceiptPdf(toReceipt(txn)); logDelivery("download", "sent"); toast.success("Receipt downloaded"); }
                catch { logDelivery("download", "failed"); toast.error("Couldn't generate receipt"); }
              }} />
              <ReceiptBtn icon={Share2} label="Share" onClick={async () => {
                try {
                  const shared = await shareReceiptPdf(toReceipt(txn));
                  logDelivery("share", shared ? "sent" : "attempted");
                  if (!shared) toast.success("Receipt downloaded");
                } catch { logDelivery("share", "failed"); toast.error("Share failed"); }
              }} />
              <ReceiptBtn icon={Mail} label="Email" onClick={() => {
                try {
                  const subject = encodeURIComponent(`Payment receipt · ₹${fmtINR(amt)} → ${txn.merchant_name}`);
                  const body = encodeURIComponent(buildReceiptSummary(toReceipt(txn)));
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                  logDelivery("email", "attempted");
                } catch { logDelivery("email", "failed"); }
              }} />
              <ReceiptBtn icon={MessageCircle} label="SMS" onClick={() => {
                try {
                  const body = encodeURIComponent(buildReceiptSummary(toReceipt(txn)));
                  window.location.href = `sms:?body=${body}`;
                  logDelivery("sms", "attempted");
                } catch { logDelivery("sms", "failed"); }
              }} />
              <ReceiptBtn icon={Phone} label="WhatsApp" onClick={async () => {
                try {
                  const result = await shareReceiptToWhatsApp(toReceipt(txn));
                  if (result === "failed") { logDelivery("whatsapp", "failed"); toast.error("Couldn't open WhatsApp"); }
                  else logDelivery("whatsapp", result === "file" ? "sent" : "attempted");
                } catch { logDelivery("whatsapp", "failed"); toast.error("Couldn't open WhatsApp"); }
              }} />
            </div>
          </section>
        )}

        {/* Pay again */}
        {!pending && onPayAgain && !credit && (
          <button
            onClick={() => { void haptics.tap(); onPayAgain(txn); }}
            className="td-cta mt-6 td-cascade"
            style={{ ["--td-i" as string]: 6 }}
          >
            <Repeat className="w-4 h-4" />
            {failed ? "Try this payment again" : `Pay ${txn.merchant_name.split(" ")[0]} again`}
            <ArrowUpRight className="w-4 h-4 opacity-70" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────── subcomponents ───────── */

function BreakdownRow({ label, value, sub, bold, muted }: {
  label: string; value: string; sub?: string; bold?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-start justify-between py-2.5">
      <div className="min-w-0">
        <p className={`text-[13px] ${bold ? "text-white font-semibold" : muted ? "text-white/55" : "text-white/75"}`}>{label}</p>
        {sub && <p className="text-[11px] text-white/40 mt-0.5">{sub}</p>}
      </div>
      <p className={`text-[13px] num-mono ${bold ? "text-white font-semibold" : muted ? "text-white/55" : "text-white/85"}`}>{value}</p>
    </div>
  );
}

function ReceiptBtn({ icon: Icon, label, onClick }: {
  icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="td-receipt-btn">
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}
