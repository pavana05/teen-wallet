// Tiny hook that mirrors React's useState into localStorage so admin filters,
// search queries, and sort preferences survive navigation and reloads.
import { useCallback, useEffect, useRef, useState } from "react";

export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const initialRef = useRef(initial);
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialRef.current;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initialRef.current;
      const parsed = JSON.parse(raw);
      // Shallow-merge with initial to absorb new fields safely.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(initialRef.current as object), ...parsed } as T;
      }
      return parsed as T;
    } catch {
      return initialRef.current;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / private mode — ignore */
    }
  }, [key, value]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, update];
}
