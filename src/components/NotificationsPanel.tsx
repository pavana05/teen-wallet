import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, X, Bell, BellOff, CheckCheck, Trash2, Zap, ShieldAlert, Gift, ArrowDownLeft, ArrowUpRight, Sparkles, Settings, PartyPopper, Wallet, Sun, AlertTriangle, Clock, XCircle } from "lucide-react";
import { useApp } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

interface Props { onClose: () => void }

const FILTERS = [
  { key: "all", label: "All" },
  { key: "transaction", label: "Payments" },
  { key: "fraud", label: "Security" },
  { key: "offer", label: "Offers" },
] as const;

type FilterKey = typeof FILTERS[number]["key"];

export function NotificationsPanel({ onClose }: Props) {
  const { userId } = useApp();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let mounted = true;
    void supabase
      .from("notifications")
      .select("id,type,title,body,read,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(80)
      .then(({ data }) => {
        if (!mounted) return;
        setNotifs((data ?? []) as Notif[]);
        setLoading(false);
      });

    const ch = supabase
      .channel("notifs-panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        setNotifs((prev) => [payload.new as Notif, ...prev]);
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [userId]);

  const unread = notifs.filter((n) => !n.read).length;

  const filtered = useMemo(() => {
    if (filter === "all") return notifs;
    if (filter === "transaction") {
      // "Payments" chip groups all money-movement notifications
      return notifs.filter((n) =>
        n.type === "transaction" || n.type === "payment_sent" ||
        n.type === "payment_received" || n.type === "payment_pending" ||
        n.type === "payment_failed" || n.type === "low_balance",
      );
    }
    return notifs.filter((n) => n.type === filter);
  }, [notifs, filter]);

  // Group by Today / Yesterday / Earlier
  const groups = useMemo(() => {
    const today: Notif[] = [];
    const yest: Notif[] = [];
    const earlier: Notif[] = [];
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYest = startToday - 86400000;
    for (const n of filtered) {
      const t = new Date(n.created_at).getTime();
      if (t >= startToday) today.push(n);
      else if (t >= startYest) yest.push(n);
      else earlier.push(n);
    }
    return { today, yest, earlier };
  }, [filtered]);

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    if (error) toast.error("Couldn't mark all as read");
    else toast.success("All caught up");
  };

  const markRead = async (id: string) => {
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  const remove = async (id: string) => {
    setNotifs((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  const clearAll = async () => {
    if (!userId || notifs.length === 0) return;
    const ok = confirm("Clear all notifications?");
    if (!ok) return;
    setNotifs([]);
    await supabase.from("notifications").delete().eq("user_id", userId);
    toast.success("Notifications cleared");
  };

  return (
    <div className="qa-root absolute inset-0 z-[60] flex flex-col bg-background overflow-hidden">
      <div className="qa-bg" />
      <div className="qa-grid" />

      {/* header */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-7 pb-2">
        <button onClick={onClose} aria-label="Back" className="qa-icon-btn">
          <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2} />
        </button>
        <div className="flex flex-col items-center">
          <p className="text-[15px] font-semibold text-white tracking-tight">Notifications</p>
          {unread > 0 && <p className="text-[10px] text-primary mt-0.5 font-medium">{unread} unread</p>}
        </div>
        <button onClick={onClose} aria-label="Close" className="qa-icon-btn">
          <X className="w-5 h-5 text-white/80" strokeWidth={2} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto pb-10 qa-enter">
        {/* Hero summary */}
        <div className="px-5">
          <div className="np-hero">
            <div className="np-hero-shine" />
            <div className="relative z-10 flex items-center gap-3">
              <div className="np-hero-ico">
                <Bell className="w-5 h-5 text-black" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-white leading-tight">
                  {unread === 0 ? "You're all caught up" : `${unread} new notification${unread === 1 ? "" : "s"}`}
                </p>
                <p className="text-[11px] text-white/60 mt-0.5">
                  {notifs.length === 0 ? "Nothing yet — your activity will show here." : `${notifs.length} total in your feed`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action bar */}
        {notifs.length > 0 && (
          <div className="px-5 mt-4 flex items-center justify-between">
            <button onClick={markAllRead} disabled={unread === 0} className="np-quick-btn disabled:opacity-40">
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
            <button onClick={clearAll} className="np-quick-btn np-quick-danger">
              <Trash2 className="w-3.5 h-3.5" /> Clear all
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="px-5 mt-4 flex gap-2 overflow-x-auto hp-scroll pb-1">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} className={`qa-chip ${active ? "qa-chip-active" : ""}`}>
                {f.label}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="px-5 mt-5">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px] rounded-2xl bg-white/5 tw-shimmer" />)}
            </div>
          ) : notifs.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <p className="text-center text-[12px] text-white/40 py-10">No {filter} notifications</p>
          ) : (
            <>
              {groups.today.length > 0 && <Group title="Today" items={groups.today} onRead={markRead} onRemove={remove} />}
              {groups.yest.length > 0 && <Group title="Yesterday" items={groups.yest} onRead={markRead} onRemove={remove} />}
              {groups.earlier.length > 0 && <Group title="Earlier" items={groups.earlier} onRead={markRead} onRemove={remove} />}
            </>
          )}
        </div>

        {/* Settings hint */}
        <div className="px-5 mt-8">
          <div className="np-settings">
            <Settings className="w-4 h-4 text-white/55" />
            <div className="flex-1">
              <p className="text-[12px] text-white font-medium">Notification preferences</p>
              <p className="text-[11px] text-white/50">Control what you hear about</p>
            </div>
            <span className="text-white/40 text-[16px]">›</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, items, onRead, onRemove }: { title: string; items: Notif[]; onRead: (id: string) => void; onRemove: (id: string) => void }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 mb-2">{title}</p>
      <div className="space-y-2">
        {items.map((n) => <NotifRow key={n.id} n={n} onRead={onRead} onRemove={onRemove} />)}
      </div>
    </div>
  );
}

function iconFor(type: string) {
  switch (type) {
    case "welcome": return { Icon: PartyPopper, tint: "bg-emerald-500/15 text-emerald-300" };
    case "greeting": return { Icon: Sun, tint: "bg-amber-300/15 text-amber-200" };
    case "payment_received": return { Icon: ArrowDownLeft, tint: "bg-emerald-500/15 text-emerald-300" };
    case "payment_sent":
    case "transaction": return { Icon: ArrowUpRight, tint: "bg-primary/15 text-primary" };
    case "payment_pending": return { Icon: Clock, tint: "bg-sky-400/15 text-sky-300" };
    case "payment_failed": return { Icon: XCircle, tint: "bg-destructive/15 text-destructive" };
    case "low_balance": return { Icon: Wallet, tint: "bg-amber-400/15 text-amber-300" };
    case "fraud": return { Icon: ShieldAlert, tint: "bg-destructive/15 text-destructive" };
    case "issue": return { Icon: AlertTriangle, tint: "bg-rose-400/15 text-rose-300" };
    case "offer": return { Icon: Gift, tint: "bg-fuchsia-500/15 text-fuchsia-300" };
    case "alert": return { Icon: Zap, tint: "bg-yellow-400/15 text-yellow-300" };
    default: return { Icon: Sparkles, tint: "bg-white/10 text-white/80" };
  }
}

function NotifRow({ n, onRead, onRemove }: { n: Notif; onRead: (id: string) => void; onRemove: (id: string) => void }) {
  const { Icon, tint } = iconFor(n.type);
  const time = relativeTime(new Date(n.created_at));
  return (
    <div
      onClick={() => !n.read && onRead(n.id)}
      className={`np-row group ${!n.read ? "np-row-unread" : ""}`}
    >
      {!n.read && <span className="np-row-dot" aria-hidden />}
      <div className={`np-row-ico ${tint}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-[13px] truncate ${!n.read ? "text-white font-semibold" : "text-white/85 font-medium"}`}>{n.title}</p>
          <span className="text-[10px] text-white/40 shrink-0">{time}</span>
        </div>
        {n.body && <p className="text-[11px] text-white/55 truncate mt-0.5">{n.body}</p>}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(n.id); }}
        aria-label="Dismiss"
        className="np-row-x"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="np-empty-ico">
        <BellOff className="w-7 h-7 text-white/40" />
      </div>
      <p className="text-[14px] text-white/75 mt-4 font-medium">No notifications yet</p>
      <p className="text-[12px] text-white/45 mt-1 max-w-[240px]">
        Payments, security alerts and offers will appear here as they happen.
      </p>
    </div>
  );
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
