// Temporary in-app debug panel.
// Shows: persisted onboarding stage, supabase session status, current
// resolved route, and the most recent redirect entries. Mounted only in
// development (and when the URL contains `?debug=1`) so production users
// never see it.
//
// The panel is fixed to the bottom-right, collapsed by default, and can
// be dismissed for the rest of the session.

import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/store";
import { readRedirects, clearRedirects, type RedirectEntry } from "@/lib/redirectLog";

const DISMISS_KEY = "tw_debug_panel_dismissed_v1";

function shouldMount(): boolean {
  if (typeof window === "undefined") return false;
  const dev = import.meta.env?.DEV === true;
  const force = (() => {
    try { return new URL(window.location.href).searchParams.get("debug") === "1"; }
    catch { return false; }
  })();
  if (!(dev || force)) return false;
  try { return window.sessionStorage.getItem(DISMISS_KEY) !== "1"; }
  catch { return true; }
}

export function DebugPanel() {
  const [mounted, setMounted] = useState<boolean>(() => shouldMount());
  const [open, setOpen] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<RedirectEntry[]>([]);
  const stage = useApp((s) => s.stage);
  const userId = useApp((s) => s.userId);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Refresh session + redirect log whenever opened or route changes.
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setHasSession(!!data.session);
      } catch {
        if (!cancelled) setHasSession(false);
      }
    })();
    setEntries(readRedirects());
    return () => { cancelled = true; };
  }, [mounted, pathname, open]);

  if (!mounted) return null;

  const dismiss = () => {
    try { window.sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setMounted(false);
  };

  return (
    <div
      className="fixed bottom-3 right-3 z-[2000] text-[11px] font-mono select-none"
      style={{
        background: "rgba(10,10,10,0.85)",
        color: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        padding: open ? 12 : 8,
        maxWidth: 320,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,0.6)",
      }}
      role="region"
      aria-label="Debug panel"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5"
          style={{ color: "inherit" }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8, height: 8, borderRadius: 999,
              background: hasSession ? "#34d399" : "#f87171",
              boxShadow: hasSession ? "0 0 6px #34d399" : "0 0 6px #f87171",
            }}
          />
          <span style={{ opacity: 0.85 }}>debug</span>
          <span style={{ opacity: 0.55 }}>{open ? "▾" : "▸"}</span>
        </button>
        <span style={{ flex: 1 }} />
        {open && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss debug panel"
            style={{ opacity: 0.55 }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Row k="route" v={pathname} />
          <Row k="stage" v={stage} />
          <Row k="userId" v={userId ? `${userId.slice(0, 8)}…` : "—"} />
          <Row k="session" v={hasSession === null ? "…" : hasSession ? "yes" : "no"} />

          <div className="mt-2 flex items-center justify-between" style={{ opacity: 0.7 }}>
            <span>last redirects</span>
            <button
              type="button"
              onClick={() => { clearRedirects(); setEntries([]); }}
              style={{ opacity: 0.7 }}
            >
              clear
            </button>
          </div>
          <div
            className="flex flex-col gap-1 mt-1"
            style={{ maxHeight: 180, overflowY: "auto" }}
          >
            {entries.length === 0 && (
              <div style={{ opacity: 0.5 }}>no redirects logged yet</div>
            )}
            {entries.slice().reverse().map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                style={{
                  borderTop: "1px dashed rgba(255,255,255,0.08)",
                  paddingTop: 4,
                }}
              >
                <div style={{ opacity: 0.85 }}>
                  {new Date(e.ts).toLocaleTimeString()} · {e.from} → {e.to}
                </div>
                <div style={{ opacity: 0.55 }}>
                  stage={e.stage} · session={e.session ? "y" : "n"}
                  {e.reason ? ` · ${e.reason}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ opacity: 0.55 }}>{k}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v ?? "—"}</span>
    </div>
  );
}
