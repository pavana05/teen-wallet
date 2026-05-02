import { useEffect, useState, useCallback, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { offlineCache } from "@/lib/offlineCache";
import { haptics } from "@/lib/haptics";
import { Sparkles, X, ExternalLink, ChevronRight } from "lucide-react";

export interface Curation {
  id: string;
  title: string;
  subtitle: string;
  image_url: string | null;
  detail_title: string | null;
  detail_body: string | null;
  detail_cta_label: string | null;
  detail_cta_url: string | null;
  accent_color: string;
  sort_order: number;
}

const CACHE_KEY = "curations_v1";

export const CurationsSection = memo(function CurationsSection() {
  const [items, setItems] = useState<Curation[]>(() => {
    return offlineCache.get<Curation[]>(CACHE_KEY) ?? [];
  });
  const [detail, setDetail] = useState<Curation | null>(null);

  const fetchCurations = useCallback(async () => {
    const { data } = await supabase
      .from("curations")
      .select("id,title,subtitle,image_url,detail_title,detail_body,detail_cta_label,detail_cta_url,accent_color,sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .limit(10);
    if (data && data.length > 0) {
      setItems(data as Curation[]);
      offlineCache.set(CACHE_KEY, data);
    }
  }, []);

  useEffect(() => {
    void fetchCurations();
    const ch = supabase
      .channel("curations_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "curations" }, () => {
        void fetchCurations();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchCurations]);

  if (items.length === 0) return null;

  return (
    <>
      <section aria-label="Curations for you" className="px-5 mt-10">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "#d4c5a0" }} strokeWidth={2} />
          <h3
            className="text-center text-[17px] font-semibold italic"
            style={{
              fontFamily: "'Georgia', 'Times New Roman', serif",
              background: "linear-gradient(135deg, #d4c5a0 0%, #f5ecd7 40%, #c9b896 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.02em",
            }}
          >
            Curations for you
          </h3>
          <Sparkles className="w-3.5 h-3.5" style={{ color: "#d4c5a0" }} strokeWidth={2} />
        </div>

        <div
          className="flex gap-3 overflow-x-auto hp-scroll snap-x snap-mandatory pb-2"
          role="list"
          aria-label="Curated promotions"
        >
          {items.map((c) => (
            <CurationCard key={c.id} item={c} onTap={() => { void haptics.tap(); setDetail(c); }} />
          ))}
        </div>
      </section>

      {detail && <CurationDetail item={detail} onClose={() => setDetail(null)} />}
    </>
  );
});

function CurationCard({ item, onTap }: { item: Curation; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      role="listitem"
      className="snap-start shrink-0 relative overflow-hidden rounded-2xl focus:outline-none group"
      style={{
        width: "72%",
        minWidth: 260,
        maxWidth: 340,
        aspectRatio: "16 / 10",
      }}
      aria-label={`${item.title} — ${item.subtitle}`}
    >
      {/* Background image */}
      {item.image_url ? (
        <img
          src={item.image_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${item.accent_color}30 0%, ${item.accent_color}10 100%)`,
          }}
        />
      )}

      {/* Gradient overlay for text readability */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-4 text-left">
        <h4
          className="text-[18px] font-bold text-white leading-tight drop-shadow-lg"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}
        >
          {item.title}
        </h4>
        {item.subtitle && (
          <p
            className="text-[12px] font-semibold mt-1 tracking-wider uppercase"
            style={{
              color: item.accent_color,
              textShadow: "0 1px 4px rgba(0,0,0,0.4)",
            }}
          >
            {item.subtitle}
          </p>
        )}
      </div>

      {/* Tap indicator */}
      <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRight className="w-3.5 h-3.5 text-white/80" strokeWidth={2.5} />
      </div>
    </button>
  );
}

function CurationDetail({ item, onClose }: { item: Curation; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col tw-slide-up"
      style={{ background: "var(--background, #0a0a0a)" }}
    >
      {/* Hero image */}
      <div className="relative w-full" style={{ height: "45vh", minHeight: 240 }}>
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: `linear-gradient(135deg, ${item.accent_color}40 0%, ${item.accent_color}15 100%)`,
            }}
          />
        )}
        {/* Gradient fade to background */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, var(--background, #0a0a0a) 100%)",
          }}
        />

        {/* Close button */}
        <button
          type="button"
          onClick={() => { void haptics.tap(); onClose(); }}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10"
          aria-label="Go back"
          style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
        >
          <X className="w-4 h-4 text-white" strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 -mt-8 relative z-10">
        <h1
          className="text-[26px] font-bold leading-tight"
          style={{ color: "white" }}
        >
          {item.detail_title || item.title}
        </h1>

        {item.subtitle && (
          <p
            className="text-[13px] font-semibold tracking-wider uppercase mt-2"
            style={{ color: item.accent_color }}
          >
            {item.subtitle}
          </p>
        )}

        {item.detail_body && (
          <div
            className="mt-5 text-[14px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            {item.detail_body.split("\n").map((line, i) => (
              <p key={i} className={i > 0 ? "mt-3" : ""}>{line}</p>
            ))}
          </div>
        )}

        {item.detail_cta_label && (
          <button
            type="button"
            onClick={() => {
              void haptics.success();
              // In-app, cta_url would deep-link to a screen; for now show toast
              if (item.detail_cta_url) {
                // dispatched as a deep link event
                window.dispatchEvent(new CustomEvent("tw:deeplink", { detail: { url: item.detail_cta_url } }));
              }
            }}
            className="mt-8 mb-8 w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-semibold text-[15px]"
            style={{
              background: `linear-gradient(135deg, ${item.accent_color} 0%, ${item.accent_color}cc 100%)`,
              color: "#0a0a0a",
              boxShadow: `0 8px 24px -8px ${item.accent_color}60`,
            }}
          >
            <span>{item.detail_cta_label}</span>
            <ExternalLink className="w-4 h-4" strokeWidth={2} />
          </button>
        )}

        {/* Bottom safe area */}
        <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
      </div>
    </div>
  );
}
