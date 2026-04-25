import { Bell, Home as HomeIcon, ScanLine, ShoppingBag, CreditCard, ArrowUpRight, Building2, Wallet, History, Smartphone, Zap, MoreHorizontal, Gift, ArrowDownLeft, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/store";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScanPay } from "@/screens/ScanPay";
import heroScan from "@/assets/home-hero-scan.jpg";

interface Txn {
  id: string;
  amount: number;
  merchant_name: string;
  upi_id: string;
  note: string | null;
  status: "success" | "pending" | "failed";
  created_at: string;
}

export function Home() {
  const { fullName, userId } = useApp();
  const first = fullName?.split(" ")[0] ?? "Alex";
  const [view, setView] = useState<"home" | "scan">("home");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const fetchTxns = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const { data } = await supabase
      .from("transactions")
      .select("id,amount,merchant_name,upi_id,note,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setTxns((data ?? []) as Txn[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void fetchTxns(); }, [fetchTxns]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("home-txns")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` }, () => {
        void fetchTxns();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchTxns]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTxns();
    setTimeout(() => setRefreshing(false), 400);
  }, [fetchTxns]);

  const onTouchStart = (e: React.TouchEvent) => {
    if ((scrollerRef.current?.scrollTop ?? 0) <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.5, 80));
  };
  const onTouchEnd = () => {
    if (pullY > 60) void handleRefresh();
    setPullY(0);
    touchStartY.current = null;
  };

  if (view === "scan") return <ScanPay onBack={() => { setView("home"); void fetchTxns(); }} />;

  return (
    <div className="hp-root flex-1 flex flex-col tw-slide-up pb-32 overflow-y-auto">
      {/* ===== HERO (orange grid bg + scan card image) ===== */}
      <div className="hp-hero relative">
        <div className="hp-hero-bg" />
        <div className="hp-hero-pattern" />
        <div className="hp-hero-spot" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-7">
          <div>
            <p className="text-[17px] font-semibold text-white leading-tight">Hey, {first} <span className="inline-block">👋</span></p>
            <p className="text-[12px] text-white/70 mt-0.5">Good to see you back!</p>
          </div>
          <button aria-label="Notifications" className="hp-bell">
            <Bell className="w-5 h-5 text-white" strokeWidth={1.8} />
            <span className="hp-bell-dot" />
          </button>
        </div>

        {/* Scan hero card */}
        <button onClick={() => setView("scan")} className="hp-scan-card group" aria-label="Tap to scan">
          <img src={heroScan} alt="Tap to scan and pay" className="hp-scan-img" />
        </button>

        {/* Grass to black blend */}
        <div className="hp-hero-fade" />
      </div>

      {/* ===== OFFERS CAROUSEL ===== */}
      <div className="px-5 mt-4 -mt-2">
        <div className="flex gap-3 overflow-x-auto hp-scroll snap-x snap-mandatory pb-1">
          <div className="hp-offer hp-offer-1 snap-start shrink-0">
            <div className="relative z-10">
              <p className="text-white text-[20px] leading-tight font-serif italic">
                Get <span className="font-bold not-italic">20% flat free</span>
              </p>
              <p className="text-white/85 text-[12px] mt-2">On your P2P UPI transactions ✨</p>
            </div>
            <div className="hp-offer-art">🎁</div>
          </div>
          <div className="hp-offer hp-offer-2 snap-start shrink-0">
            <div className="relative z-10">
              <p className="text-white text-[20px] leading-tight font-serif italic">
                <span className="font-bold not-italic">40% off</span>
              </p>
              <p className="text-white/85 text-[12px] mt-2">First recharge cashback 🎉</p>
            </div>
            <div className="hp-offer-art">🎊</div>
          </div>
        </div>
      </div>

      {/* ===== EVERYTHING UPI ===== */}
      <div className="px-5 mt-7">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-[17px] font-semibold tracking-tight">Everything UPI!</h3>
          <button className="text-white/60">›</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <QuickAction icon={ArrowUpRight} label={"Pay\nfriends"} onClick={() => setView("scan")} />
          <QuickAction icon={Building2} label={"To bank &\nself a/c"} />
          <QuickAction icon={Wallet} label={"Check\nbalance"} />
          <QuickAction icon={History} label={"Transaction\nhistory"} />
        </div>
      </div>

      {/* ===== RECHARGES AND BILLS ===== */}
      <div className="px-5 mt-7">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-[17px] font-semibold tracking-tight">Recharges and bills</h3>
          <button className="text-white/60">›</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <RechargeTile icon={Smartphone} label="Recharge" tint="from-indigo-500/40 to-fuchsia-500/30" />
          <RechargeTile icon={CreditCard} label="Credit card bill" tint="from-emerald-500/40 to-teal-500/20" />
          <RechargeTile icon={Zap} label="Utilities" tint="from-violet-500/40 to-purple-600/30" />
          <RechargeTile icon={MoreHorizontal} label="More" tint="from-white/10 to-white/5" />
        </div>
      </div>

      {/* Page dots */}
      <div className="flex items-center justify-center gap-1.5 mt-7">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
        <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
        <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
        <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
      </div>

      {/* ===== FLOATING BOTTOM NAV ===== */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[400px] z-50">
        <div className="flex items-center gap-3">
          <div className="hp-nav flex-1">
            <NavItem icon={HomeIcon} label="Home" active />
            <NavItem icon={Gift} label="Shop" />
            <NavItem icon={CreditCard} label="Card" />
          </div>
          <button onClick={() => setView("scan")} className="hp-scan-fab" aria-label="Scan">
            <ScanLine className="w-6 h-6 text-black" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 group">
      <div className="hp-tile">
        <Icon className="w-6 h-6 text-white/90" strokeWidth={1.6} />
      </div>
      <span className="text-[11px] text-white/70 leading-tight text-center whitespace-pre-line">{label}</span>
    </button>
  );
}

function RechargeTile({ icon: Icon, label, tint }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; tint: string }) {
  return (
    <button className="flex flex-col items-center gap-2">
      <div className={`hp-tile bg-gradient-to-br ${tint}`}>
        <Icon className="w-6 h-6 text-white" strokeWidth={1.7} />
      </div>
      <span className="text-[11px] text-white/70 leading-tight text-center">{label}</span>
    </button>
  );
}

function NavItem({ icon: Icon, label, active }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; active?: boolean }) {
  return (
    <button className={`flex-1 flex flex-col items-center py-2 rounded-full ${active ? "hp-nav-active text-white" : "text-white/55"}`}>
      <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.6} />
      <span className={`text-[11px] mt-0.5 ${active ? "font-semibold" : ""}`}>{label}</span>
    </button>
  );
}
