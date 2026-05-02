/**
 * Offline caching layer.
 *
 * Stores profile, transactions, and KYC status in localStorage so the app
 * can render meaningful data during poor network conditions or brief offline
 * periods. The cache is a read-through layer: fresh data from Supabase
 * always overwrites the cache; stale cache is served when the network fails.
 *
 * Usage:
 *   import { offlineCache } from "@/lib/offlineCache";
 *   // After a successful fetch:
 *   offlineCache.set("profile", profileData);
 *   // When fetch fails, fall back:
 *   const cached = offlineCache.get<Profile>("profile");
 */

const PREFIX = "tw_cache_";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

function key(name: string) {
  return `${PREFIX}${name}`;
}

export const offlineCache = {
  set<T>(name: string, data: T): void {
    if (typeof window === "undefined") return;
    try {
      const entry: CacheEntry<T> = { data, savedAt: Date.now() };
      localStorage.setItem(key(name), JSON.stringify(entry));
    } catch {
      // Quota exceeded — silently ignore; caching is best-effort.
    }
  },

  get<T>(name: string, maxAgeMs = MAX_AGE_MS): T | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(key(name));
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.savedAt > maxAgeMs) {
        localStorage.removeItem(key(name));
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  },

  remove(name: string): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(key(name));
    } catch { /* ignore */ }
  },

  /** Clear all tw_cache_ entries. */
  clearAll(): void {
    if (typeof window === "undefined") return;
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },

  /** Age of cached entry in ms, or null if missing. */
  age(name: string): number | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(key(name));
      if (!raw) return null;
      const entry: CacheEntry<unknown> = JSON.parse(raw);
      return Date.now() - entry.savedAt;
    } catch {
      return null;
    }
  },
};
