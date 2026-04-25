import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Wallet, History, Search, Star, ArrowDownLeft, Eye, EyeOff, Copy, Check, ChevronRight, ShieldCheck, Send, IndianRupee, X, Sparkles } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";

export type QuickActionKind = "pay-friends" | "to-bank" | "balance" | "history";

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

export function QuickActionsPanel({ kind, onClose }: Props) {
  const title = useMemo(() => ({
    "pay-friends": "Pay friends",
    "to-bank": "To bank & self a/c",
    "balance": "Check balance",
    "history": "Transaction history",
  }[kind]), [kind]);

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
      </div>
    </div>
  );
}

/* ───────── PAY FRIENDS ───────── */
function PayFriends() {
  const [q, setQ] = useState("");
  const friends = [
    { name: "Aarav Mehta", upi: "aarav@okhdfc", emoji: "🦊", recent: true },
    { name: "Priya Shah", upi: "priya.shah@oksbi", emoji: "🌸", recent: true },
    { name: "Rohan Verma", upi: "rohan@ybl", emoji: "🎮" },
    { name: "Ishita Roy", upi: "ishita.r@okaxis", emoji: "🎧" },
    { name: "Kabir Kapoor", upi: "kabir@paytm", emoji: "🏀" },
    { name: "Meera Iyer", upi: "meera@upi", emoji: "📚" },
    { name: "Dev Patel", upi: "dev.p@okicici", emoji: "🚀" },
    { name: "Nisha Khan", upi: "nisha@ybl", emoji: "🎨" },
  ];
  const filtered = friends.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()) || f.upi.includes(q.toLowerCase()));
  const recents = friends.filter((f) => f.recent);

  return (
    <div className="px-5 pt-2">
      <div className="qa-search">
        <Search className="w-4 h-4 text-white/50" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, UPI ID or phone" className="bg-transparent flex-1 outline-none text-[14px] text-white placeholder:text-white/40" />
      </div>

      <div className="mt-5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3">Recent</p>
        <div className="flex gap-3 overflow-x-auto hp-scroll pb-1">
          {recents.map((f) => (
            <button key={f.upi} className="qa-recent shrink-0">
              <div className="qa-avatar text-[22px]">{f.emoji}</div>
              <p className="text-[11px] text-white/85 mt-2 max-w-[64px] truncate text-center">{f.name.split(" ")[0]}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-3">All contacts</p>
        <div className="space-y-2">
          {filtered.map((f) => (
            <button key={f.upi} className="qa-row group">
              <div className="qa-avatar-sm text-[18px]">{f.emoji}</div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[13px] font-medium text-white truncate">{f.name}</p>
                <p className="text-[11px] text-white/50 truncate">{f.upi}</p>
              </div>
              <Send className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition" />
              <ChevronRight className="w-4 h-4 text-white/40" />
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-[12px] text-white/40 py-8">No contacts match "{q}"</p>
          )}
        </div>
      </div>
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
        <p className="text-[22px] font-semibold text-white mt-2 leading-tight">Send to any<br/>bank account</p>
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
    void supabase.from("transactions").select("amount,status").eq("user_id", userId).eq("status", "success").gte("created_at", since).then(({ data }) => {
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
            <p className="text-[11px] uppercase tracking-[0.14em] text-black/60">Available balance</p>
            <button onClick={() => setHidden((h) => !h)} className="qa-eye">
              {hidden ? <EyeOff className="w-4 h-4 text-black/70" /> : <Eye className="w-4 h-4 text-black/70" />}
            </button>
          </div>
          <div className="flex items-baseline gap-1 mt-3">
            <span className="text-[28px] font-semibold text-black/90 num-mono">₹</span>
            <span className="text-[44px] font-bold text-black tracking-tight num-mono leading-none">
              {hidden ? "•••••" : balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
        Updated {revealedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · Live from your account
      </p>

      <div className="grid grid-cols-2 gap-3 mt-6">
        <div className="qa-stat">
          <p className="text-[11px] text-white/55">This week spent</p>
          <p className="text-[20px] font-semibold text-white num-mono mt-1">₹{recentSpend.toFixed(0)}</p>
          <div className="qa-stat-bar mt-3"><span style={{ width: `${Math.min(100, (recentSpend / 5000) * 100)}%` }} /></div>
        </div>
        <div className="qa-stat">
          <p className="text-[11px] text-white/55">Weekly limit</p>
          <p className="text-[20px] font-semibold text-white num-mono mt-1">₹5,000</p>
          <p className="text-[10px] text-primary mt-3 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Healthy</p>
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

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    void supabase.from("transactions").select("id,amount,merchant_name,upi_id,note,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60).then(({ data }) => {
      setTxns((data ?? []) as Txn[]);
      setLoading(false);
    });
  }, [userId]);

  const filtered = filter === "all" ? txns : txns.filter((t) => t.status === filter);
  const totalSpent = txns.filter((t) => t.status === "success").reduce((a, t) => a + Number(t.amount), 0);

  // group by date
  const groups = filtered.reduce<Record<string, Txn[]>>((acc, t) => {
    const d = new Date(t.created_at);
    const key = d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  return (
    <div className="px-5 pt-2">
      <div className="qa-history-hero">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/55">Total spent · all time</p>
        <p className="text-[34px] font-bold text-white num-mono mt-1 leading-none">
          ₹{totalSpent.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-[12px] text-white/55 mt-2">{txns.length} transactions</p>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto hp-scroll pb-1">
        {(["all", "success", "pending", "failed"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`qa-chip ${filter === f ? "qa-chip-active" : ""}`}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/5 tw-shimmer" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-8 h-8 text-white/20 mx-auto" />
            <p className="text-[13px] text-white/50 mt-3">No {filter === "all" ? "" : filter} transactions</p>
          </div>
        ) : (
          Object.entries(groups).map(([day, items]) => (
            <div key={day} className="mb-5">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/40 mb-2">{day}</p>
              <div className="space-y-2">
                {items.map((t) => <HistoryRow key={t.id} txn={t} />)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({ txn }: { txn: Txn }) {
  const failed = txn.status === "failed";
  const pending = txn.status === "pending";
  const time = new Date(txn.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="qa-row">
      <div className={`qa-row-ico ${failed ? "bg-destructive/15" : pending ? "bg-yellow-400/10" : "bg-primary/15"}`}>
        {failed ? <X className="w-4 h-4 text-destructive" /> : <ArrowDownLeft className={`w-4 h-4 ${pending ? "text-yellow-400" : "text-primary"}`} />}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[13px] font-medium text-white truncate">{txn.merchant_name}</p>
        <p className="text-[11px] text-white/45 truncate">{txn.upi_id} · {time}</p>
      </div>
      <div className="text-right">
        <p className={`text-[14px] font-semibold num-mono ${failed ? "text-destructive line-through" : "text-white"}`}>−₹{Number(txn.amount).toFixed(2)}</p>
        <p className={`text-[10px] uppercase tracking-wider ${pending ? "text-yellow-400/80" : failed ? "text-destructive/80" : "text-primary/80"}`}>{txn.status}</p>
      </div>
    </div>
  );
}
