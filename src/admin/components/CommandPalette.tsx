import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, FileCheck2, Wallet, ShieldAlert, Activity, Settings,
  Search, ArrowRight, User as UserIcon, Receipt, LogOut, Copy, Command,
} from "lucide-react";
import { callAdminFn, readAdminSession, clearAdminSession } from "@/admin/lib/adminAuth";

// ── Types ────────────────────────────────────────────────────────────────────
type CmdItem = {
  id: string;
  group: "Navigate" | "Users" | "Transactions" | "Actions";
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  onRun: () => void | Promise<void>;
};

interface UserRow { id: string; full_name: string | null; phone: string | null; kyc_status: string }
interface TxnRow  { id: string; amount: number; merchant_name: string; upi_id: string; status: string; created_at: string }

// Static nav targets (shown when query is empty).
const NAV_TARGETS: Array<{ to: string; label: string; icon: React.ComponentType<{ size?: number }>; shortcut?: string }> = [
  { to: "/admin",              label: "Command Center", icon: LayoutDashboard, shortcut: "g d" },
  { to: "/admin/users",        label: "Users",          icon: Users,           shortcut: "g u" },
  { to: "/admin/kyc",          label: "KYC Queue",      icon: FileCheck2,      shortcut: "g k" },
  { to: "/admin/transactions", label: "Transactions",   icon: Wallet,          shortcut: "g t" },
  { to: "/admin/fraud",        label: "Fraud",          icon: ShieldAlert,     shortcut: "g f" },
  { to: "/admin/diagnostics",  label: "Diagnostics",    icon: Activity },
  { to: "/admin/settings",     label: "Settings",       icon: Settings },
];

export function CommandPalette() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Global hotkeys ────────────────────────────────────────────────────────
  useEffect(() => {
    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const isTyping = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K opens (works even while typing)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      // g+x leaders only fire when not typing in a field and palette closed
      if (open || isTyping(e.target)) return;

      if (pendingG) {
        const map: Record<string, string> = {
          d: "/admin",
          u: "/admin/users",
          k: "/admin/kyc",
          t: "/admin/transactions",
          f: "/admin/fraud",
        };
        const dest = map[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          nav({ to: dest });
        }
        pendingG = false;
        if (gTimer) clearTimeout(gTimer);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        pendingG = true;
        gTimer = setTimeout(() => { pendingG = false; }, 800);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [open, nav]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setUsers([]);
      setTxns([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Debounced server search ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    const term = q.trim();
    if (term.length < 2) { setUsers([]); setTxns([]); setLoading(false); return; }

    debounce.current = setTimeout(async () => {
      const s = readAdminSession();
      if (!s) return;
      setLoading(true);
      try {
        const [u, t] = await Promise.all([
          callAdminFn<{ users: UserRow[] }>({
            action: "users_list", sessionToken: s.sessionToken, search: term, limit: 6, offset: 0,
          }).catch(() => ({ users: [] })),
          callAdminFn<{ transactions: TxnRow[] }>({
            action: "transactions_list", sessionToken: s.sessionToken, search: term, limit: 6, offset: 0,
          }).catch(() => ({ transactions: [] })),
        ]);
        setUsers(u.users ?? []);
        setTxns(t.transactions ?? []);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, open]);

  // ── Build flat item list (memoised) ───────────────────────────────────────
  const items = useMemo<CmdItem[]>(() => {
    const term = q.trim().toLowerCase();
    const out: CmdItem[] = [];

    // Navigate
    NAV_TARGETS
      .filter((n) => !term || n.label.toLowerCase().includes(term))
      .forEach((n) => out.push({
        id: `nav:${n.to}`,
        group: "Navigate",
        label: n.label,
        hint: n.shortcut,
        icon: n.icon,
        onRun: () => { nav({ to: n.to }); setOpen(false); },
      }));

    // Users
    users.forEach((u) => out.push({
      id: `user:${u.id}`,
      group: "Users",
      label: u.full_name || u.phone || u.id.slice(0, 8),
      hint: u.phone ? `${u.phone} · ${u.kyc_status}` : u.kyc_status,
      icon: UserIcon,
      onRun: () => { nav({ to: `/admin/users/${u.id}` as never }); setOpen(false); },
    }));

    // Transactions
    txns.forEach((t) => out.push({
      id: `txn:${t.id}`,
      group: "Transactions",
      label: `₹${Number(t.amount).toFixed(2)} · ${t.merchant_name}`,
      hint: `${t.upi_id} · ${t.status}`,
      icon: Receipt,
      onRun: () => {
        nav({ to: "/admin/transactions" });
        setOpen(false);
        // Surface the txn id in URL hash so the txn page can scroll/highlight if it wants.
        setTimeout(() => { window.location.hash = `txn-${t.id}`; }, 50);
      },
    }));

    // Actions (always available)
    const actions: Array<Pick<CmdItem, "label" | "hint" | "icon" | "onRun"> & { id: string }> = [
      {
        id: "act:copy-token",
        label: "Copy session token",
        hint: "for debugging",
        icon: Copy,
        onRun: async () => {
          const s = readAdminSession();
          if (s) await navigator.clipboard.writeText(s.sessionToken);
          setOpen(false);
        },
      },
      {
        id: "act:logout",
        label: "Logout",
        hint: "End admin session",
        icon: LogOut,
        onRun: async () => {
          const s = readAdminSession();
          if (s) await callAdminFn({ action: "logout", sessionToken: s.sessionToken }).catch(() => {});
          clearAdminSession();
          setOpen(false);
          nav({ to: "/admin/login" });
        },
      },
    ];
    actions
      .filter((a) => !term || a.label.toLowerCase().includes(term))
      .forEach((a) => out.push({ ...a, group: "Actions" }));

    return out;
  }, [q, users, txns, nav]);

  // Reset cursor when item set shrinks
  useEffect(() => { setActive(0); }, [items.length]);

  // Arrow / Enter handlers on input
  const onInputKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.onRun(); }
  }, [items, active]);

  if (!open) return null;

  // Group items in render order
  const groups = items.reduce<Record<string, CmdItem[]>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});
  const groupOrder: CmdItem["group"][] = ["Navigate", "Users", "Transactions", "Actions"];
  let runningIndex = 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(5,5,8,0.72)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          background: "var(--a-surface)",
          border: "1px solid var(--a-border-strong)",
          borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,241,53,0.05)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--a-border)" }}>
          <Search size={16} style={{ color: "var(--a-muted)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search users, transactions, or jump to a page…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--a-text)", fontSize: 14,
            }}
          />
          {loading && <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>…</span>}
          <kbd style={{ fontSize: 10, color: "var(--a-muted)", border: "1px solid var(--a-border)", padding: "2px 6px", borderRadius: 4 }}>ESC</kbd>
        </div>

        <div style={{ maxHeight: "55vh", overflowY: "auto", padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: "var(--a-muted)" }}>
              {q.trim().length < 2 ? "Type at least 2 characters to search" : "No results"}
            </div>
          )}

          {groupOrder.map((g) => {
            const list = groups[g];
            if (!list?.length) return null;
            return (
              <div key={g} style={{ marginBottom: 4 }}>
                <div className="a-label" style={{ padding: "8px 12px 4px" }}>{g}</div>
                {list.map((it) => {
                  const idx = runningIndex++;
                  const isActive = idx === active;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => it.onRun()}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px", borderRadius: 8, border: "none", textAlign: "left",
                        background: isActive ? "var(--a-elevated)" : "transparent",
                        color: "var(--a-text)", cursor: "pointer",
                        borderLeft: isActive ? "2px solid var(--a-accent)" : "2px solid transparent",
                      }}
                    >
                      <it.icon size={14} />
                      <span style={{ flex: 1, fontSize: 13 }}>{it.label}</span>
                      {it.hint && <span className="a-mono" style={{ fontSize: 11, color: "var(--a-muted)" }}>{it.hint}</span>}
                      {isActive && <ArrowRight size={12} style={{ color: "var(--a-accent)" }} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--a-border)", fontSize: 11, color: "var(--a-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span><kbd style={kbdStyle}>↑↓</kbd> navigate</span>
            <span><kbd style={kbdStyle}>↵</kbd> select</span>
            <span><kbd style={kbdStyle}>g</kbd> + <kbd style={kbdStyle}>u/t/k/f/d</kbd> jump</span>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Command size={11} /> K
          </span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10, color: "var(--a-text)",
  border: "1px solid var(--a-border)", padding: "1px 5px", borderRadius: 3,
  fontFamily: "ui-monospace, monospace",
};
