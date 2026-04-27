import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Tiny in-memory cache + subscriber set, shared across components, so a single
// Realtime channel powers every <img> on the page.
type Slot = { url: string | null; alt: string | null };
const cache = new Map<string, Slot>();
const subs = new Map<string, Set<(s: Slot) => void>>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let bootstrapped = false;

function notify(key: string, slot: Slot) {
  cache.set(key, slot);
  subs.get(key)?.forEach((fn) => fn(slot));
}

async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const { data } = await supabase.from("app_images").select("key,url,alt");
    (data ?? []).forEach((r: any) => notify(r.key, { url: r.url, alt: r.alt }));
  } catch { /* table missing → fall back to defaults */ }
  channel = supabase
    .channel("app_images_pub")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_images" }, (payload: any) => {
      const row = (payload.new ?? payload.old) as { key?: string; url?: string | null; alt?: string | null };
      if (row?.key) notify(row.key, { url: row.url ?? null, alt: row.alt ?? null });
    })
    .subscribe();
}

/**
 * Returns the admin-managed URL/alt for a slot, falling back to the bundled
 * default if the slot has no image yet (or hasn't loaded).
 */
export function useAppImage(key: string, fallbackUrl: string, fallbackAlt = ""): { url: string; alt: string } {
  const [slot, setSlot] = useState<Slot>(() => cache.get(key) ?? { url: null, alt: null });

  useEffect(() => {
    void bootstrap();
    let set = subs.get(key);
    if (!set) { set = new Set(); subs.set(key, set); }
    const fn = (s: Slot) => setSlot(s);
    set.add(fn);
    const cached = cache.get(key);
    if (cached) setSlot(cached);
    return () => { set!.delete(fn); };
  }, [key]);

  return { url: slot.url || fallbackUrl, alt: slot.alt || fallbackAlt };
}
