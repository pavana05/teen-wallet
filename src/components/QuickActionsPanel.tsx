import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Wallet,
  History,
  Search,
  Star,
  ArrowDownLeft,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronRight,
  ShieldCheck,
  Send,
  IndianRupee,
  X,
  Sparkles,
  Loader2,
  UserPlus,
  Repeat,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Hash,
  FileText,
  Download,
  Share2,
  Mail,
  MessageCircle,
  Phone,
  AtSign,
  Zap,
  Lock,
} from "lucide-react";
import { haptics } from "@/lib/haptics";
import { downloadReceiptPdf, shareReceiptPdf, buildReceiptSummary, type ReceiptData } from "@/lib/receipt";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { payUpi } from "@/lib/payments.functions";
import { breadcrumb, captureError } from "@/lib/breadcrumbs";
import { toast } from "sonner";

export type QuickActionKind = "pay-friends" | "to-bank" | "balance" | "history" | "send-money";

interface Props {
  kind: QuickActionKind;
  onClose: () => void;
}

interface Txn {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  upi_id: string;
  phone: string | null;
  emoji: string | null;
  verified: boolean;
  last_paid_at: string | null;
}

/**
 * Default starter contacts seeded the first time a user opens "Pay friends"
 * with an empty contact list. Marked unverified — the user has to confirm
 * the UPI ID via a tiny in-flow check before they can pay (see ConfirmPay).
 *
 * Kept local to this module so we don't ship them in the migration data.
 */
const STARTER_CONTACTS: Omit<Contact, "id" | "last_paid_at">[] = [
  { name: "Aarav Mehta", upi_id: "aarav@okhdfc", phone: null, emoji: "🦊", verified: true },
  { name: "Priya Shah", upi_id: "priya.shah@oksbi", phone: null, emoji: "🌸", verified: true },
  { name: "Rohan Verma", upi_id: "rohan@ybl", phone: null, emoji: "🎮", verified: false },
  { name: "Ishita Roy", upi_id: "ishita.r@okaxis", phone: null, emoji: "🎧", verified: false },
];

export function QuickActionsPanel({ kind, onClose }: Props) {
  const title = useMemo(
    () =>
      ({
        "pay-friends": "Pay friends",
        "to-bank": "To bank & self a/c",
        balance: "Check balance",
        history: "Transaction history",
        "send-money": "Send money",
      })[kind],
    [kind],
  );

  return (
    <div className="qa-root absolute inset-0 z-[60] flex flex-col bg-background overflow-hidden">
      {/* gradient atmosphere */}
      <div className="qa-bg" />
      <div className="qa-grid" />

      {/* header */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
        <button onClick={onClose} aria-label="Back" className="qa-icon-btn">
          <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
        </button>
        <p className="text-[15px] font-semibold text-white tracking-tight">{title}</p>
        <button onClick={onClose} aria-label="Close" className="qa-icon-btn">
          <X className="w-5 h-5 text-white/80" strokeWidth={2} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto pb-10 qa-enter">
        {kind === "pay-friends" && <PayFriends />}
        {kind === "to-bank" && <ToBank />}
        {kind === "balance" && <CheckBalance />}
        {kind === "history" && <TxnHistory />}
        {kind === "send-money" && <SendMoney />}
      </div>
    </div>
  );
}

/* ───────── PAY FRIENDS ───────── */
function PayFriends() {
  const { userId } = useApp();
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Contact | null>(null);

  const fetchContacts = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setError(null);
    const { data, error: err } = await supabase
      .from("contacts")
      .select("id,name,upi_id,phone,emoji,verified,last_paid_at")
      .eq("user_id", userId)
      .order("last_paid_at", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true });

    if (err) {
      setError("Couldn't load your contacts. Tap retry to try again.");
      setLoading(false);
      return;
    }

    let list = (data ?? []) as Contact[];

    // Seed starter contacts on first run so the panel doesn't look empty.
    // We insert with `ignoreDuplicates: true` so re-renders are safe.
    if (list.length === 0) {
      const seedRows = STARTER_CONTACTS.map((c) => ({ ...c, user_id: userId }));
      const { data: seeded } = await supabase
        .from("contacts")
        .insert(seedRows)
        .select("id,name,upi_id,phone,emoji,verified,last_paid_at");
      list = (seeded ?? []) as Contact[];
    }

    setContacts(list);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const filtered = contacts.filter((f) => {
    const needle = q.toLowerCase();
    return f.name.toLowerCase().includes(needle) || f.upi_id.toLowerCase().includes(needle);
  });
  const recents = contacts.filter((f) => f.last_paid_at).slice(0, 6);

  // After a successful payment we bump the picked contact's `last_paid_at`
  // to keep the Recent rail in sync with reality.
  const handlePaid = useCallback(
    async (contact: Contact) => {
      if (!userId) return;
      await supabase
        .from("contacts")
        .update({ last_paid_at: new Date().toISOString(), verified: true })
        .eq("id", contact.id);
      await fetchContacts();
    },
    [userId, fetchContacts],
  );

  if (picked) {
    return (
      <ConfirmPay
        contact={picked}
        onCancel={() => setPicked(null)}
        onSuccess={async () => {
          await handlePaid(picked);
          setPicked(null);
        }}
      />
    );
  }

  return (
    <div className="px-5 pt-2">
      <div className="qa-search">
        <Search className="w-4 h-4 text-white/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, UPI ID or phone"
          className="bg-transparent flex-1 outline-none text-[14px] text-white placeholder:text-white/40"
        />
      </div>

      {loading ? (
        <div className="space-y-2 mt-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/5 tw-shimmer" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-center">
          <AlertTriangle className="w-5 h-5 text-destructive mx-auto" />
          <p className="text-[13px] text-white mt-2">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              void fetchContacts();
            }}
            className="qa-cta mt-4"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {recents.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3">Recent</p>
              <div className="flex gap-3 overflow-x-auto hp-scroll pb-1">
                {recents.map((f) => (
                  <button key={f.id} onClick={() => setPicked(f)} className="qa-recent shrink-0">
                    <div className="qa-avatar text-[22px]">{f.emoji ?? "👤"}</div>
                    <p className="text-[11px] text-white/85 mt-2 max-w-[64px] truncate text-center">
                      {f.name.split(" ")[0]}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">All contacts</p>
              <span className="text-[10px] text-white/40">{contacts.length} saved</span>
            </div>
            <div className="space-y-2">
              {filtered.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setPicked(f)}
                  className="qa-row group text-left w-full"
                >
                  <div className="qa-avatar-sm text-[18px]">{f.emoji ?? "👤"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-medium text-white truncate">{f.name}</p>
                      {f.verified && (
                        <span title="Verified UPI ID" className="inline-flex">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/50 truncate">{f.upi_id}</p>
                  </div>
                  <Send className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition" />
                  <ChevronRight className="w-4 h-4 text-white/40" />
                </button>
              ))}
              {filtered.length === 0 && q && (
                <p className="text-center text-[12px] text-white/40 py-8">
                  No contacts match "{q}"
                </p>
              )}
              {filtered.length === 0 && !q && (
                <div className="text-center py-10">
                  <UserPlus className="w-6 h-6 text-white/30 mx-auto" />
                  <p className="text-[13px] text-white/60 mt-3">No contacts yet</p>
                  <p className="text-[11px] text-white/40 mt-1">
                    Pay anyone via Scan & Pay to save them here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────── CONFIRM + PAY (used by Pay friends and Pay-again) ───────── */
function ConfirmPay({
  contact,
  prefillAmount,
  prefillNote,
  onCancel,
  onSuccess,
}: {
  contact: Pick<Contact, "name" | "upi_id" | "emoji" | "verified">;
  prefillAmount?: number;
  prefillNote?: string;
  onCancel: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const { balance, userId } = useApp();
  const [amount, setAmount] = useState<string>(prefillAmount ? String(prefillAmount) : "");
  const [note, setNote] = useState<string>(prefillNote ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amt = Number(amount);
  const valid = amt > 0 && Number.isFinite(amt) && amt <= 100_000;
  const insufficient = valid && amt > balance;

  const handlePay = async () => {
    if (!userId || !valid || insufficient || submitting) return;
    setSubmitting(true);
    setErr(null);
    breadcrumb("payment.payfriends_started", { upiId: contact.upi_id, amount: amt });

    try {
      const res = await payUpi({
        data: {
          amount: amt,
          upiId: contact.upi_id,
          payeeName: contact.name,
          note: note.trim() || null,
        },
      });

      if (!res.ok) {
        setErr(res.message);
        if (res.reason === "insufficient" && typeof res.newBalance === "number") {
          useApp.setState({ balance: res.newBalance });
        }
        breadcrumb("payment.payfriends_failed", { reason: res.reason }, "warning");
        setSubmitting(false);
        return;
      }

      useApp.setState({ balance: res.newBalance });
      breadcrumb("payment.payfriends_success", { txnId: res.txnId, amount: amt });
      toast.success(`₹${amt.toFixed(2)} sent to ${contact.name}`, {
        description: contact.upi_id,
      });
      await onSuccess();
    } catch (e) {
      captureError(e, { where: "QuickActions.ConfirmPay" });
      setErr("Network error — please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-5 pt-2">
      <div className="qa-balance-card !bg-gradient-to-br !from-primary/30 !to-primary/10 !border-primary/30">
        <div className="relative z-10 flex items-center gap-3">
          <div className="qa-avatar text-[24px] !w-12 !h-12">{contact.emoji ?? "👤"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[15px] font-semibold text-white truncate">{contact.name}</p>
              {contact.verified && <ShieldCheck className="w-4 h-4 text-primary shrink-0" />}
            </div>
            <p className="text-[12px] text-white/70 truncate num-mono">{contact.upi_id}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 p-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/50 mb-2">You're paying</p>
        <div className="flex items-baseline gap-1">
          <IndianRupee className="w-6 h-6 text-white" strokeWidth={2.4} />
          <input
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            className="bg-transparent flex-1 outline-none text-[34px] font-bold text-white num-mono leading-none placeholder:text-white/30"
          />
        </div>
        <p className="text-[11px] text-white/50 mt-3">
          Available balance{" "}
          <span className="text-white/80 num-mono">
            ₹
            {balance.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </p>
        {insufficient && (
          <p className="text-[12px] text-destructive mt-2 inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Not enough balance
          </p>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 80))}
          placeholder="Add a note (optional)"
          className="bg-transparent w-full outline-none text-[13px] text-white placeholder:text-white/40"
        />
      </div>

      {err && (
        <div className="mt-4 rounded-xl bg-destructive/15 border border-destructive/30 px-4 py-3 text-[12px] text-white inline-flex items-start gap-2 w-full">
          <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <div className="mt-5 flex gap-3">
        <button
          onClick={onCancel}
          className="qa-cta !bg-white/10 !text-white flex-1"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          onClick={handlePay}
          disabled={!valid || insufficient || submitting}
          className="qa-cta flex-[1.6] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-black" /> Paying…
            </>
          ) : (
            <>
              <Send className="w-4 h-4 text-black" /> Pay ₹{valid ? amt.toFixed(0) : "0"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ───────── SEND MONEY (P2P: phone or UPI ID) ───────── */
// Common UPI handle providers users on Teen Pay actually have. We surface
// these as one-tap suggestions when the user types a 10-digit phone number,
// since UPI doesn't have a public phone→VPA directory the client can hit.
// The user picks the right one and we hand off to the same ConfirmPay flow
// as Pay friends — so all server-side fraud rules + balance checks apply.
const PHONE_VPA_PROVIDERS: { suffix: string; label: string; tint: string }[] = [
  { suffix: "@ybl",     label: "PhonePe",  tint: "from-violet-500/40 to-fuchsia-500/30" },
  { suffix: "@paytm",   label: "Paytm",    tint: "from-sky-500/40 to-blue-600/30" },
  { suffix: "@okaxis",  label: "GPay (Axis)",   tint: "from-rose-500/40 to-orange-500/30" },
  { suffix: "@oksbi",   label: "GPay (SBI)",    tint: "from-emerald-500/40 to-teal-500/30" },
  { suffix: "@okhdfcbank", label: "GPay (HDFC)", tint: "from-indigo-500/40 to-violet-500/30" },
  { suffix: "@okicici", label: "GPay (ICICI)",  tint: "from-orange-500/40 to-rose-500/30" },
];

const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers

type SendTarget = {
  kind: "phone" | "upi";
  raw: string;
  /** Resolved UPI ID once the user picks (phone) or auto (upi) */
  upiId: string;
  payeeName: string;
};

function SendMoney() {
  const { userId } = useApp();
  const [input, setInput] = useState("");
  const [providerPick, setProviderPick] = useState<string | null>(null);
  const [picked, setPicked] = useState<SendTarget | null>(null);
  const [recents, setRecents] = useState<Contact[]>([]);

  // Pull the most-recent paid contacts so the user can re-send in 1 tap
  // without re-typing. Same RLS-scoped table the Pay friends view uses.
  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("contacts")
      .select("id,name,upi_id,phone,emoji,verified,last_paid_at")
      .eq("user_id", userId)
      .not("last_paid_at", "is", null)
      .order("last_paid_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setRecents((data ?? []) as Contact[]));
  }, [userId]);

  const trimmed = input.trim();
  const cleanedDigits = trimmed.replace(/[\s+\-()]/g, "");
  // Strip India country code so "+91 98xxxxxxxx" works naturally
  const phoneCandidate = cleanedDigits.startsWith("91") && cleanedDigits.length === 12
    ? cleanedDigits.slice(2)
    : cleanedDigits;

  const isPhone = PHONE_RE.test(phoneCandidate);
  const isUpi = VPA_RE.test(trimmed);
  const showProviders = isPhone && !isUpi;

  const handleProceed = () => {
    if (isUpi) {
      setPicked({
        kind: "upi",
        raw: trimmed,
        upiId: trimmed.toLowerCase(),
        payeeName: trimmed.split("@")[0],
      });
      return;
    }
    if (isPhone && providerPick) {
      const upiId = `${phoneCandidate}${providerPick}`;
      setPicked({
        kind: "phone",
        raw: phoneCandidate,
        upiId,
        payeeName: phoneCandidate,
      });
    }
  };

  if (picked) {
    return (
      <ConfirmPay
        contact={{
          name: picked.payeeName,
          upi_id: picked.upiId,
          emoji: picked.kind === "phone" ? "📱" : "✉️",
          verified: false, // first-time send → server fraud rules will warn "NEW_MERCHANT"
        }}
        onCancel={() => setPicked(null)}
        onSuccess={async () => {
          // Best-effort: persist the recipient as a contact for next time
          if (userId) {
            await supabase
              .from("contacts")
              .upsert(
                {
                  user_id: userId,
                  name: picked.payeeName,
                  upi_id: picked.upiId,
                  phone: picked.kind === "phone" ? picked.raw : null,
                  emoji: picked.kind === "phone" ? "📱" : "✉️",
                  verified: true,
                  last_paid_at: new Date().toISOString(),
                },
                { onConflict: "user_id,upi_id", ignoreDuplicates: false },
              );
          }
          setPicked(null);
          setInput("");
          setProviderPick(null);
        }}
      />
    );
  }

  return (
    <div className="px-5 pt-2">
      {/* Hero — emphasises speed + safety */}
      <div className="qa-bank-hero">
        <div className="flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-[0.14em]">
          <ShieldCheck className="w-3.5 h-3.5" /> End-to-end encrypted
        </div>
        <p className="text-[22px] font-semibold text-white mt-2 leading-tight">
          Send money in
          <br />
          seconds
        </p>
        <p className="text-[12px] text-white/60 mt-2">
          Phone number or UPI ID · Instant · Free
        </p>
        <div className="qa-bank-shine" />
      </div>

      {/* Input */}
      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-2">
          Recipient
        </p>
        <div className="qa-search">
          {isPhone ? (
            <Phone className="w-4 h-4 text-primary" />
          ) : isUpi ? (
            <AtSign className="w-4 h-4 text-primary" />
          ) : (
            <Search className="w-4 h-4 text-white/50" />
          )}
          <input
            inputMode="email"
            autoComplete="off"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setProviderPick(null);
            }}
            placeholder="Phone number or name@upi"
            className="bg-transparent flex-1 outline-none text-[14px] text-white placeholder:text-white/40"
            aria-label="Recipient phone number or UPI ID"
          />
          {trimmed && (
            <button
              type="button"
              onClick={() => { setInput(""); setProviderPick(null); void haptics.tap(); }}
              aria-label="Clear input"
              className="qa-icon-btn !w-7 !h-7"
            >
              <X className="w-3.5 h-3.5 text-white/70" />
            </button>
          )}
        </div>
        {/* Live validation hints — keep them friendly, not scolding */}
        {trimmed.length > 0 && !isPhone && !isUpi && (
          <p className="text-[11px] text-white/45 mt-2 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-yellow-400/80" />
            Enter a 10-digit phone number or a UPI ID like{" "}
            <span className="num-mono text-white/65">name@bank</span>
          </p>
        )}
        {isUpi && (
          <p className="text-[11px] text-primary mt-2 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" />
            Valid UPI ID — ready to send
          </p>
        )}
        {isPhone && (
          <p className="text-[11px] text-white/55 mt-2">
            Pick the recipient's UPI app to continue
          </p>
        )}
      </div>

      {/* Provider picker — shown only for phone-number flow */}
      {showProviders && (
        <div className="mt-4 grid grid-cols-2 gap-3 qa-enter">
          {PHONE_VPA_PROVIDERS.map((p) => {
            const active = providerPick === p.suffix;
            return (
              <button
                key={p.suffix}
                type="button"
                onClick={() => { setProviderPick(p.suffix); void haptics.select(); }}
                className={`qa-action-card !items-start text-left transition ${
                  active ? "!border-primary/60 !bg-primary/10" : ""
                }`}
                aria-pressed={active}
              >
                <div className={`qa-bank-logo bg-gradient-to-br ${p.tint} !w-9 !h-9 !text-[14px]`}>
                  {p.label.charAt(0)}
                </div>
                <p className="text-[13px] text-white mt-2 font-medium">{p.label}</p>
                <p className="text-[11px] text-white/50 num-mono truncate w-full">
                  {phoneCandidate}{p.suffix}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Primary CTA */}
      <button
        onClick={() => { void haptics.bloom(); handleProceed(); }}
        disabled={!isUpi && !(isPhone && providerPick)}
        className="qa-cta mt-6 w-full disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        <Zap className="w-4 h-4 text-black" />
        Continue to send
      </button>

      {/* Trust strip */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="qa-trust-pill">
          <Lock className="w-3.5 h-3.5 text-primary mx-auto" />
          <p className="text-[10px] text-white/65 mt-1">Bank-grade</p>
        </div>
        <div className="qa-trust-pill">
          <ShieldCheck className="w-3.5 h-3.5 text-primary mx-auto" />
          <p className="text-[10px] text-white/65 mt-1">Fraud-checked</p>
        </div>
        <div className="qa-trust-pill">
          <Zap className="w-3.5 h-3.5 text-primary mx-auto" />
          <p className="text-[10px] text-white/65 mt-1">Instant</p>
        </div>
      </div>

      {/* Recents — 1-tap repeat send */}
      {recents.length > 0 && !trimmed && (
        <div className="mt-7">
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3">
            Send again
          </p>
          <div className="space-y-2">
            {recents.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setPicked({
                    kind: "upi",
                    raw: r.upi_id,
                    upiId: r.upi_id,
                    payeeName: r.name,
                  });
                  void haptics.select();
                }}
                className="qa-row group text-left w-full"
              >
                <div className="qa-avatar-sm text-[18px]">{r.emoji ?? "👤"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-medium text-white truncate">{r.name}</p>
                    {r.verified && <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </div>
                  <p className="text-[11px] text-white/50 truncate num-mono">{r.upi_id}</p>
                </div>
                <Send className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition" />
                <ChevronRight className="w-4 h-4 text-white/40" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── TO BANK / SELF ACCOUNT ───────── */
function ToBank() {
  const banks = [
    { name: "HDFC Bank", acc: "•••• 4521", color: "from-blue-500/40 to-indigo-500/30", logo: "H" },
    { name: "ICICI Bank", acc: "•••• 8830", color: "from-orange-500/40 to-rose-500/30", logo: "I" },
    { name: "SBI", acc: "•••• 1147", color: "from-violet-500/40 to-purple-600/30", logo: "S" },
  ];
  return (
    <div className="px-5 pt-2">
      <div className="qa-bank-hero">
        <div className="flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-[0.14em]">
          <ShieldCheck className="w-3.5 h-3.5" /> Secure transfer
        </div>
        <p className="text-[22px] font-semibold text-white mt-2 leading-tight">
          Send to any
          <br />
          bank account
        </p>
        <p className="text-[12px] text-white/60 mt-2">IMPS · NEFT · RTGS · UPI</p>
        <div className="qa-bank-shine" />
      </div>

      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3">Your accounts</p>
        <div className="space-y-3">
          {banks.map((b) => (
            <button key={b.name} className="qa-bank-card">
              <div className={`qa-bank-logo bg-gradient-to-br ${b.color}`}>{b.logo}</div>
              <div className="flex-1 text-left">
                <p className="text-[14px] font-medium text-white">{b.name}</p>
                <p className="text-[12px] text-white/55 num-mono">{b.acc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-white/40" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button className="qa-action-card">
          <Building2 className="w-5 h-5 text-primary" />
          <p className="text-[13px] text-white mt-2 font-medium">New beneficiary</p>
          <p className="text-[11px] text-white/50">Add account + IFSC</p>
        </button>
        <button className="qa-action-card">
          <Wallet className="w-5 h-5 text-primary" />
          <p className="text-[13px] text-white mt-2 font-medium">Self transfer</p>
          <p className="text-[11px] text-white/50">Between your a/cs</p>
        </button>
      </div>
    </div>
  );
}

/* ───────── CHECK BALANCE ───────── */
function CheckBalance() {
  const { balance, userId } = useApp();
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealedAt] = useState(() => new Date());
  const [recentSpend, setRecentSpend] = useState<number>(0);

  useEffect(() => {
    if (!userId) return;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    void supabase
      .from("transactions")
      .select("amount,status")
      .eq("user_id", userId)
      .eq("status", "success")
      .gte("created_at", since)
      .then(({ data }) => {
        const sum = (data ?? []).reduce((a, t) => a + Number(t.amount), 0);
        setRecentSpend(sum);
      });
  }, [userId]);

  const copyVpa = async () => {
    await navigator.clipboard.writeText("teen.alex@upi");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="px-5 pt-2">
      <div className="qa-balance-card">
        <div className="qa-balance-shine" />
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.14em] text-black/60">
              Available balance
            </p>
            <button onClick={() => setHidden((h) => !h)} className="qa-eye">
              {hidden ? (
                <EyeOff className="w-4 h-4 text-black/70" />
              ) : (
                <Eye className="w-4 h-4 text-black/70" />
              )}
            </button>
          </div>
          <div className="flex items-baseline gap-1 mt-3">
            <span className="text-[28px] font-semibold text-black/90 num-mono">₹</span>
            <span className="text-[44px] font-bold text-black tracking-tight num-mono leading-none">
              {hidden
                ? "•••••"
                : balance.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </span>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-black/55">UPI ID</p>
              <p className="text-[13px] text-black/85 font-medium num-mono">teen.alex@upi</p>
            </div>
            <button onClick={copyVpa} className="qa-copy">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-white/40 mt-4">
        Updated {revealedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} ·
        Live from your account
      </p>

      <div className="grid grid-cols-2 gap-3 mt-6">
        <div className="qa-stat">
          <p className="text-[11px] text-white/55">This week spent</p>
          <p className="text-[20px] font-semibold text-white num-mono mt-1">
            ₹{recentSpend.toFixed(0)}
          </p>
          <div className="qa-stat-bar mt-3">
            <span style={{ width: `${Math.min(100, (recentSpend / 5000) * 100)}%` }} />
          </div>
        </div>
        <div className="qa-stat">
          <p className="text-[11px] text-white/55">Weekly limit</p>
          <p className="text-[20px] font-semibold text-white num-mono mt-1">₹5,000</p>
          <p className="text-[10px] text-primary mt-3 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Healthy
          </p>
        </div>
      </div>

      <button className="qa-cta mt-6">
        <Star className="w-4 h-4 text-black" />
        Set up auto top-up
      </button>
    </div>
  );
}

/* ───────── TRANSACTION HISTORY ───────── */
function TxnHistory() {
  const { userId } = useApp();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [filter, setFilter] = useState<"all" | "success" | "failed" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [openTxn, setOpenTxn] = useState<Txn | null>(null);
  const [payAgainContact, setPayAgainContact] = useState<{
    contact: Pick<Contact, "name" | "upi_id" | "emoji" | "verified">;
    amount: number;
    note: string;
  } | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    void supabase
      .from("transactions")
      .select("id,amount,merchant_name,upi_id,note,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setTxns((data ?? []) as Txn[]);
        setLoading(false);
      });
  }, [userId]);

  const filtered = filter === "all" ? txns : txns.filter((t) => t.status === filter);
  const totalSpent = txns
    .filter((t) => t.status === "success")
    .reduce((a, t) => a + Number(t.amount), 0);

  // group by date
  const groups = filtered.reduce<Record<string, Txn[]>>((acc, t) => {
    const d = new Date(t.created_at);
    const key = d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  // ── Pay-again flow override ──
  // Mounting ConfirmPay replaces the history view. After success / cancel
  // we drop back to the txn list (and reload it so the new payment appears).
  const refreshTxns = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("transactions")
      .select("id,amount,merchant_name,upi_id,note,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    setTxns((data ?? []) as Txn[]);
  }, [userId]);

  if (payAgainContact) {
    return (
      <ConfirmPay
        contact={payAgainContact.contact}
        prefillAmount={payAgainContact.amount}
        prefillNote={payAgainContact.note}
        onCancel={() => setPayAgainContact(null)}
        onSuccess={async () => {
          await refreshTxns();
          setPayAgainContact(null);
        }}
      />
    );
  }

  return (
    <div className="px-5 pt-2">
      <div className="qa-history-hero">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/55">
          Total spent · all time
        </p>
        <p className="text-[34px] font-bold text-white num-mono mt-1 leading-none">
          ₹
          {totalSpent.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-[12px] text-white/55 mt-2">{txns.length} transactions</p>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto hp-scroll pb-1">
        {(["all", "success", "pending", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`qa-chip ${filter === f ? "qa-chip-active" : ""}`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-2xl bg-white/5 tw-shimmer" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-8 h-8 text-white/20 mx-auto" />
            <p className="text-[13px] text-white/50 mt-3">
              No {filter === "all" ? "" : filter} transactions
            </p>
          </div>
        ) : (
          Object.entries(groups).map(([day, items]) => (
            <div key={day} className="mb-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-2">{day}</p>
              <div className="space-y-2">
                {items.map((t) => (
                  <HistoryRow key={t.id} txn={t} onOpen={() => setOpenTxn(t)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {openTxn && (
        <TxnDetailSheet
          txn={openTxn}
          onClose={() => setOpenTxn(null)}
          onPayAgain={(t) => {
            setOpenTxn(null);
            setPayAgainContact({
              contact: {
                name: t.merchant_name,
                upi_id: t.upi_id,
                emoji: "🔁",
                verified: t.status === "success",
              },
              amount: Number(t.amount),
              note: t.note ?? "",
            });
          }}
        />
      )}
    </div>
  );
}

function HistoryRow({ txn, onOpen }: { txn: Txn; onOpen: () => void }) {
  const failed = txn.status === "failed";
  const pending = txn.status === "pending";
  const time = new Date(txn.created_at).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <button onClick={onOpen} className="qa-row w-full text-left">
      <div
        className={`qa-row-ico ${failed ? "bg-destructive/15" : pending ? "bg-yellow-400/10" : "bg-primary/15"}`}
      >
        {failed ? (
          <X className="w-4 h-4 text-destructive" />
        ) : (
          <ArrowDownLeft className={`w-4 h-4 ${pending ? "text-yellow-400" : "text-primary"}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-white truncate">{txn.merchant_name}</p>
        <p className="text-[11px] text-white/45 truncate">
          {txn.upi_id} · {time}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`text-[14px] font-semibold num-mono ${failed ? "text-destructive line-through" : "text-white"}`}
        >
          −₹{Number(txn.amount).toFixed(2)}
        </p>
        <p
          className={`text-[10px] uppercase tracking-wider ${pending ? "text-yellow-400/80" : failed ? "text-destructive/80" : "text-primary/80"}`}
        >
          {txn.status}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-white/30" />
    </button>
  );
}

/* ───────── TXN DETAIL SHEET ───────── */
function TxnDetailSheet({
  txn,
  onClose,
  onPayAgain,
}: {
  txn: Txn;
  onClose: () => void;
  onPayAgain: (t: Txn) => void;
}) {
  const [copied, setCopied] = useState(false);
  const created = new Date(txn.created_at);
  const dateLabel = created.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const failed = txn.status === "failed";
  const pending = txn.status === "pending";
  const amt = Number(txn.amount);

  // Reference ID — surface the full UUID since it's the canonical handle
  // for support / audit. Tap-to-copy.
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(txn.id);
      setCopied(true);
      toast.success("Reference ID copied");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  // Timeline events derived from the transaction status. We don't have a
  // dedicated audit-log table for txns yet, so we synthesize the canonical
  // milestones from `created_at` + `status`. Easy to swap to a real
  // event stream later without changing the UI.
  const timeline = useMemo(() => {
    const items: { label: string; sub: string; tone: "ok" | "warn" | "bad" | "muted" }[] = [];
    items.push({ label: "Payment initiated", sub: dateLabel, tone: "muted" });
    if (failed) {
      items.push({
        label: "Payment failed",
        sub: "We couldn't complete this payment",
        tone: "bad",
      });
    } else if (pending) {
      items.push({
        label: "Awaiting confirmation",
        sub: "The bank is still processing",
        tone: "warn",
      });
    } else {
      items.push({ label: "Sent to bank", sub: "Routed via UPI", tone: "muted" });
      items.push({ label: "Payment successful", sub: "Confirmed by recipient bank", tone: "ok" });
    }
    return items;
  }, [dateLabel, failed, pending]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="qa-sheet w-full max-w-[420px] rounded-t-3xl sm:rounded-3xl bg-background border-t sm:border border-white/10 px-5 pt-5 pb-7 max-h-[88vh] overflow-y-auto"
      >
        {/* drag handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">
              {failed ? "Failed payment" : pending ? "Pending payment" : "Paid to"}
            </p>
            <h3 className="text-[18px] font-semibold text-white truncate mt-1">
              {txn.merchant_name}
            </h3>
            <p className="text-[12px] text-white/55 truncate num-mono">{txn.upi_id}</p>
          </div>
          <button onClick={onClose} className="qa-icon-btn !w-8 !h-8 shrink-0" aria-label="Close">
            <X className="w-4 h-4 text-white/80" />
          </button>
        </div>

        {/* Amount */}
        <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 p-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Amount</p>
          <p
            className={`text-[32px] font-bold num-mono mt-1 leading-none ${failed ? "text-destructive line-through" : "text-white"}`}
          >
            ₹{amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p
            className={`text-[11px] uppercase tracking-wider mt-3 ${pending ? "text-yellow-400/80" : failed ? "text-destructive/80" : "text-primary/80"}`}
          >
            {txn.status}
          </p>
        </div>

        {/* Breakdown */}
        <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 divide-y divide-white/5">
          <Row label="Subtotal" value={`₹${amt.toFixed(2)}`} />
          <Row label="Platform fee" value="₹0.00" sub="UPI is free for you" />
          <Row label="GST" value="₹0.00" />
          <Row
            label={failed ? "Total attempted" : "Total paid"}
            value={`₹${amt.toFixed(2)}`}
            bold
          />
        </div>

        {/* Reference ID */}
        <button
          onClick={copyRef}
          className="mt-4 w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 flex items-center gap-3 text-left active:bg-white/10 transition"
        >
          <div className="qa-row-ico bg-white/10">
            <Hash className="w-4 h-4 text-white/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Reference ID</p>
            <p className="text-[12px] text-white num-mono truncate mt-0.5">{txn.id}</p>
          </div>
          {copied ? (
            <Check className="w-4 h-4 text-primary" />
          ) : (
            <Copy className="w-4 h-4 text-white/50" />
          )}
        </button>

        {/* Note */}
        {txn.note && (
          <div className="mt-3 rounded-2xl bg-white/5 border border-white/10 px-4 py-3 flex items-start gap-3">
            <div className="qa-row-ico bg-white/10">
              <FileText className="w-4 h-4 text-white/80" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Note</p>
              <p className="text-[13px] text-white mt-0.5 break-words">{txn.note}</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3 inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Timeline
          </p>
          <ol className="relative pl-5">
            <span className="absolute left-[7px] top-1 bottom-1 w-px bg-white/10" />
            {timeline.map((item, i) => (
              <li key={i} className="relative pb-4 last:pb-0">
                <span
                  className={`absolute -left-[18px] top-1 w-3 h-3 rounded-full border-2 border-background ${
                    item.tone === "ok"
                      ? "bg-primary"
                      : item.tone === "bad"
                        ? "bg-destructive"
                        : item.tone === "warn"
                          ? "bg-yellow-400"
                          : "bg-white/30"
                  }`}
                />
                <p className="text-[13px] text-white font-medium leading-tight">{item.label}</p>
                <p className="text-[11px] text-white/50 mt-0.5">{item.sub}</p>
              </li>
            ))}
          </ol>
        </div>


        {/* Receipt actions — available for any non-pending payment */}
        {!pending && (
          <div className="mt-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-2">Receipt</p>
            <div className="grid grid-cols-2 gap-2">
              <ReceiptBtn
                icon={Download}
                label="Download PDF"
                onClick={async () => {
                  try {
                    await downloadReceiptPdf(toReceipt(txn));
                    toast.success("Receipt downloaded");
                  } catch { toast.error("Couldn't generate receipt"); }
                }}
              />
              <ReceiptBtn
                icon={Share2}
                label="Share"
                onClick={async () => {
                  try {
                    const shared = await shareReceiptPdf(toReceipt(txn));
                    if (!shared) toast.success("Receipt downloaded");
                  } catch { toast.error("Share failed"); }
                }}
              />
              <ReceiptBtn
                icon={Mail}
                label="Email"
                onClick={() => {
                  const subject = encodeURIComponent(`Payment receipt · ₹${Number(txn.amount).toFixed(2)} → ${txn.merchant_name}`);
                  const body = encodeURIComponent(buildReceiptSummary(toReceipt(txn)));
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }}
              />
              <ReceiptBtn
                icon={MessageCircle}
                label="SMS"
                onClick={() => {
                  const body = encodeURIComponent(buildReceiptSummary(toReceipt(txn)));
                  window.location.href = `sms:?body=${body}`;
                }}
              />
            </div>
          </div>
        )}

        {/* Pay again — only for completed UPI payments */}
        {!pending && (
          <button
            onClick={() => onPayAgain(txn)}
            className="qa-cta mt-6 inline-flex items-center justify-center gap-2"
          >
            <Repeat className="w-4 h-4 text-black" />
            {failed ? "Try this payment again" : `Pay ${txn.merchant_name.split(" ")[0]} again`}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  bold,
}: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className={`text-[13px] ${bold ? "text-white font-semibold" : "text-white/65"}`}>
          {label}
        </p>
        {sub && <p className="text-[10px] text-white/40 mt-0.5">{sub}</p>}
      </div>
      <p className={`text-[13px] num-mono ${bold ? "text-white font-semibold" : "text-white/85"}`}>
        {value}
      </p>
    </div>
  );
}

// Map a row from the transactions table to the receipt PDF shape.
function toReceipt(t: Txn): ReceiptData {
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

function ReceiptBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/5 border border-white/10 px-3 py-2.5 text-[12px] font-medium text-white hover:bg-white/[.08] transition"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

