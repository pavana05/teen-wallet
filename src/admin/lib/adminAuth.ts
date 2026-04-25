import { useEffect, useState, useCallback, useRef } from "react";

const SESSION_KEY = "tw_admin_session_v1";
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-auth`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type AdminRole =
  | "super_admin"
  | "operations_manager"
  | "compliance_officer"
  | "customer_support"
  | "fraud_analyst"
  | "finance_manager";

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

interface StoredSession {
  sessionToken: string;
  expiresAt: string;
  admin: AdminMe;
}

export function readAdminSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (new Date(parsed.expiresAt) < new Date()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
export function writeAdminSession(s: StoredSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function clearAdminSession() {
  sessionStorage.removeItem(SESSION_KEY);
  _cached = null;
}

export async function callAdminFn<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  // Lazy import to avoid pulling perfBus into modules that don't already use it.
  const { recordRequest } = await import("./perfBus");
  recordRequest(typeof payload.action === "string" ? payload.action : undefined);
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json?.reason as string) || (json?.error as string) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  operations_manager: "Operations Manager",
  compliance_officer: "Compliance Officer",
  customer_support: "Customer Support",
  fraud_analyst: "Fraud Analyst",
  finance_manager: "Finance Manager",
};

export const ROLE_BADGE: Record<AdminRole, string> = {
  super_admin: "bg-red-500/15 text-red-400 border-red-500/30",
  operations_manager: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  compliance_officer: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  customer_support: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  fraud_analyst: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  finance_manager: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

// Permission matrix (UI gating; DB is the source of truth via service-role functions later)
export const PERMS = {
  viewUsers: ["super_admin", "operations_manager", "customer_support"] as AdminRole[],
  manageUsers: ["super_admin", "operations_manager"] as AdminRole[],
  viewAuditLog: ["super_admin", "compliance_officer"] as AdminRole[],
  viewKyc: ["super_admin", "operations_manager", "compliance_officer"] as AdminRole[],
  decideKyc: ["super_admin", "operations_manager"] as AdminRole[],
  viewTransactions: ["super_admin", "operations_manager", "finance_manager", "compliance_officer", "fraud_analyst"] as AdminRole[],
  manageTransactions: ["super_admin", "operations_manager"] as AdminRole[],
  viewFraud: ["super_admin", "fraud_analyst", "compliance_officer"] as AdminRole[],
  manageAdmins: ["super_admin"] as AdminRole[],
  manageSettings: ["super_admin"] as AdminRole[],
  viewFinance: ["super_admin", "finance_manager"] as AdminRole[],
};

export function can(role: AdminRole | undefined, action: keyof typeof PERMS): boolean {
  if (!role) return false;
  return PERMS[action].includes(role);
}

// Module-level cache: dedupes concurrent session verifications across hook
// instances and skips re-verification within VERIFY_TTL_MS.
const VERIFY_TTL_MS = 60_000;
let _cached: { admin: AdminMe; expiresAt: string; at: number } | null = null;
let _inflight: Promise<{ admin: AdminMe; expiresAt: string } | null> | null = null;

async function verifySessionShared(force = false): Promise<{ admin: AdminMe; expiresAt: string } | null> {
  if (!force && _cached && Date.now() - _cached.at < VERIFY_TTL_MS) {
    return { admin: _cached.admin, expiresAt: _cached.expiresAt };
  }
  if (_inflight) return _inflight;
  const s = readAdminSession();
  if (!s) return null;
  _inflight = (async () => {
    try {
      const r = await callAdminFn<{ admin: AdminMe; expiresAt: string }>({
        action: "session",
        sessionToken: s.sessionToken,
      });
      _cached = { admin: r.admin, expiresAt: r.expiresAt, at: Date.now() };
      return r;
    } catch {
      clearAdminSession();
      _cached = null;
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// Hook: verify session, idle timeout, re-check on focus
export function useAdminSession() {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const IDLE_MS = 4 * 60 * 60 * 1000; // 4h

  const verify = useCallback(async (force = false) => {
    const r = await verifySessionShared(force);
    if (r) {
      setAdmin(r.admin);
      setExpiresAt(r.expiresAt);
    } else {
      setAdmin(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void verify(); }, [verify]);

  // Idle logout
  useEffect(() => {
    const reset = () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        clearAdminSession();
        setAdmin(null);
        window.location.href = "/admin/login";
      }, IDLE_MS);
    };
    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const logout = useCallback(async () => {
    const s = readAdminSession();
    if (s) await callAdminFn({ action: "logout", sessionToken: s.sessionToken }).catch(() => {});
    clearAdminSession();
    setAdmin(null);
  }, []);

  return { admin, expiresAt, loading, logout, refresh: verify };
}
