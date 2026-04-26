// Saved filter views for admin list pages.
//
// Each "view" is just a snapshot of whatever filter object the page is using
// (e.g. { status:"open", rule:"velocity" }) keyed by a user-given name. We
// persist the entire collection per page in localStorage so analysts can
// quickly hop between investigations they care about.
//
// The hook is generic over the page's Filters shape; each surface (Users,
// Transactions, Fraud) supplies its own scope key and current filters.
import { useCallback, useEffect, useState } from "react";

export interface SavedView<F> {
  id: string;
  name: string;
  filters: F;
  createdAt: string;
}

const PREFIX = "tw_admin_saved_views_v1__";

function read<F>(scope: string): SavedView<F>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView<F>[]) : [];
  } catch {
    return [];
  }
}

function write<F>(scope: string, views: SavedView<F>[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + scope, JSON.stringify(views));
    // Notify other components in the same tab listening on this scope.
    window.dispatchEvent(new CustomEvent("tw-saved-views-changed", { detail: scope }));
  } catch {
    /* quota — ignore */
  }
}

export function useSavedViews<F>(scope: string) {
  const [views, setViews] = useState<SavedView<F>[]>(() => read<F>(scope));

  // Stay in sync with other tabs and other components on this scope.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + scope) setViews(read<F>(scope));
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === scope) setViews(read<F>(scope));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("tw-saved-views-changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("tw-saved-views-changed", onCustom as EventListener);
    };
  }, [scope]);

  const save = useCallback((name: string, filters: F) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const next: SavedView<F> = {
      id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      filters,
      createdAt: new Date().toISOString(),
    };
    const cur = read<F>(scope);
    const updated = [next, ...cur].slice(0, 30); // cap to avoid runaway lists
    write(scope, updated);
    setViews(updated);
    return next;
  }, [scope]);

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const updated = read<F>(scope).map((v) => v.id === id ? { ...v, name: trimmed } : v);
    write(scope, updated);
    setViews(updated);
  }, [scope]);

  const remove = useCallback((id: string) => {
    const updated = read<F>(scope).filter((v) => v.id !== id);
    write(scope, updated);
    setViews(updated);
  }, [scope]);

  return { views, save, rename, remove };
}
